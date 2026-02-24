export const REPO_DIR = '/';
export const AUTHOR = {
    name: 'App Builder',
    email: 'builder@localhost'
};

const GIT_LOCK_KEY = 'nanobuild-git-lock-v1';
const GIT_JOURNAL_KEY = 'nanobuild-git-oplog-v1';
const LOCK_LEASE_MS = 15000;
const LOCK_HEARTBEAT_MS = 3000;
const LOCK_WAIT_TIMEOUT_MS = 30000;
const STALE_JOURNAL_MS = 45000;
const OWNER_ID = `git-owner-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

interface LockState {
    ownerId: string;
    opId: string;
    opName: string;
    acquiredAt: number;
    expiresAt: number;
}

interface JournalState {
    ownerId: string;
    opId: string;
    stage: 'start' | 'preflight_done' | 'status_matrix_done' | 'staging_done' | 'commit_done' | 'verify_done';
    message: string;
    updatedAt: number;
}

interface CommitDurableOptions {
    touchedPaths?: string[];
    changedPaths?: string[];
}

export interface CommitDurableResult {
    ok: boolean;
    healed: boolean;
    historyReset: boolean;
    sha?: string;
    reason?: string;
}

type GitWorkerMethod = 'initRepo' | 'commitDurable' | 'getHistory' | 'recoverFromStaleJournal';

interface GitWorkerRequest {
    id: number;
    method: GitWorkerMethod;
    payload?: unknown;
}

interface GitWorkerResponse {
    id: number;
    ok: boolean;
    result?: unknown;
    error?: string;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timerId: number;
}

let coordinatorQueue: Promise<void> = Promise.resolve();
let workerRef: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

function nowMs() {
    return Date.now();
}

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function getStorage(): Storage | null {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

function parseJson<T>(raw: string | null): T | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function readLockState(storage: Storage): LockState | null {
    return parseJson<LockState>(storage.getItem(GIT_LOCK_KEY));
}

function writeLockState(storage: Storage, state: LockState) {
    storage.setItem(GIT_LOCK_KEY, JSON.stringify(state));
}

function clearLockState(storage: Storage, opId: string) {
    const current = readLockState(storage);
    if (!current) return;
    if (current.ownerId === OWNER_ID && current.opId === opId) {
        storage.removeItem(GIT_LOCK_KEY);
    }
}

function readJournal(storage: Storage): JournalState | null {
    return parseJson<JournalState>(storage.getItem(GIT_JOURNAL_KEY));
}

function writeJournal(storage: Storage, state: JournalState) {
    storage.setItem(GIT_JOURNAL_KEY, JSON.stringify(state));
}

function clearJournal(storage: Storage, opId: string) {
    const current = readJournal(storage);
    if (!current) return;
    if (current.ownerId === OWNER_ID && current.opId === opId) {
        storage.removeItem(GIT_JOURNAL_KEY);
    }
}

function stringifyError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}\n${error.stack || ''}`;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export function isRecoverableGitObjectError(error: unknown): boolean {
    const text = stringifyError(error);
    return /NotFoundError|Could not find [0-9a-f]{7,}|_readObject|resolveTree|statusMatrix/i.test(text);
}

function rejectAllPendingRequests(message: string) {
    for (const [id, pending] of pendingRequests.entries()) {
        window.clearTimeout(pending.timerId);
        pending.reject(new Error(message));
        pendingRequests.delete(id);
    }
}

function resetWorkerInstance() {
    if (workerRef) {
        workerRef.terminate();
        workerRef = null;
    }
    rejectAllPendingRequests('Git worker reset.');
}

function ensureWorker(): Worker {
    if (workerRef) return workerRef;

    const worker = new Worker(new URL('../workers/gitWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<GitWorkerResponse>) => {
        const data = event.data;
        if (!data || typeof data.id !== 'number') return;
        const pending = pendingRequests.get(data.id);
        if (!pending) return;
        pendingRequests.delete(data.id);
        window.clearTimeout(pending.timerId);
        if (!data.ok) {
            pending.reject(new Error(data.error || 'Git worker request failed.'));
            return;
        }
        pending.resolve(data.result);
    };
    worker.onerror = (event) => {
        resetWorkerInstance();
        console.error('Git worker crashed', event.message || 'Unknown worker error.');
    };
    worker.onmessageerror = () => {
        resetWorkerInstance();
        console.error('Git worker message channel error.');
    };

    workerRef = worker;
    return worker;
}

async function callWorker<T>(method: GitWorkerMethod, payload: unknown, timeoutMs = 60000): Promise<T> {
    const worker = ensureWorker();
    const id = nextRequestId++;

    return new Promise<T>((resolve, reject) => {
        const timerId = window.setTimeout(() => {
            pendingRequests.delete(id);
            resetWorkerInstance();
            reject(new Error(`Git worker timeout for ${method}.`));
        }, timeoutMs);

        pendingRequests.set(id, { resolve, reject, timerId });
        const request: GitWorkerRequest = { id, method, payload };
        worker.postMessage(request);
    });
}

function makeJournal(opId: string, stage: JournalState['stage'], message: string): JournalState {
    return {
        ownerId: OWNER_ID,
        opId,
        stage,
        message,
        updatedAt: nowMs()
    };
}

async function withCoordinator<T>(task: () => Promise<T>): Promise<T> {
    const next = coordinatorQueue.then(() => task(), () => task());
    coordinatorQueue = next.then(() => undefined, () => undefined);
    return next;
}

async function withLeaseLock<T>(opName: string, task: (opId: string) => Promise<T>): Promise<T> {
    const storage = getStorage();
    if (!storage) {
        return task(`nolock-${Date.now().toString(36)}`);
    }

    const opId = `${opName}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    const deadline = nowMs() + LOCK_WAIT_TIMEOUT_MS;

    while (nowMs() < deadline) {
        const current = readLockState(storage);
        const expired = !current || current.expiresAt <= nowMs();
        const owned = current && current.ownerId === OWNER_ID;
        if (expired || owned) {
            const nextState: LockState = {
                ownerId: OWNER_ID,
                opId,
                opName,
                acquiredAt: nowMs(),
                expiresAt: nowMs() + LOCK_LEASE_MS
            };
            writeLockState(storage, nextState);
            const check = readLockState(storage);
            if (check && check.ownerId === OWNER_ID && check.opId === opId) {
                const heartbeat = window.setInterval(() => {
                    const latest = readLockState(storage);
                    if (!latest || latest.ownerId !== OWNER_ID || latest.opId !== opId) return;
                    writeLockState(storage, {
                        ...latest,
                        expiresAt: nowMs() + LOCK_LEASE_MS
                    });
                }, LOCK_HEARTBEAT_MS);

                try {
                    return await task(opId);
                } finally {
                    window.clearInterval(heartbeat);
                    clearLockState(storage, opId);
                }
            }
        }
        await sleep(100);
    }

    throw new Error('Git lock acquisition timed out.');
}

async function recoverStaleJournalIfNeeded() {
    const storage = getStorage();
    if (!storage) return;
    const journal = readJournal(storage);
    if (!journal) return;
    const stale = nowMs() - journal.updatedAt > STALE_JOURNAL_MS;
    if (!stale) return;

    try {
        await callWorker('recoverFromStaleJournal', {}, 90000);
    } catch {
        // Ignore and proceed; current operation will report failures if any.
    }
    storage.removeItem(GIT_JOURNAL_KEY);
}

/**
 * Initialize a new git repository in the workspace.
 */
export async function initRepo() {
    await withCoordinator(async () => {
        await withLeaseLock('init', async () => {
            await recoverStaleJournalIfNeeded();
            await callWorker('initRepo', {}, 45000);
        });
    });
}

export async function commitAllDurable(message: string, options: CommitDurableOptions = {}): Promise<CommitDurableResult> {
    return withCoordinator(async () => (
        withLeaseLock('commit', async (opId) => {
            await recoverStaleJournalIfNeeded();
            const storage = getStorage();
            if (storage) writeJournal(storage, makeJournal(opId, 'start', message));
            if (storage) writeJournal(storage, makeJournal(opId, 'preflight_done', message));

            try {
                const result = await callWorker<CommitDurableResult>('commitDurable', {
                    message,
                    touchedPaths: options.touchedPaths || [],
                    changedPaths: options.changedPaths || []
                }, 120000);

                if (storage) {
                    writeJournal(storage, makeJournal(opId, 'status_matrix_done', message));
                    writeJournal(storage, makeJournal(opId, 'staging_done', message));
                    writeJournal(storage, makeJournal(opId, 'commit_done', message));
                    writeJournal(storage, makeJournal(opId, 'verify_done', message));
                    clearJournal(storage, opId);
                }
                return result;
            } catch (error) {
                if (storage) clearJournal(storage, opId);
                return {
                    ok: false,
                    healed: false,
                    historyReset: false,
                    reason: stringifyError(error)
                };
            }
        })
    ));
}

/**
 * Stage all files and commit them.
 * Kept for compatibility; internally uses durable commit path.
 */
export async function commitAll(message: string) {
    const result = await commitAllDurable(message);
    if (!result.ok) {
        throw new Error(result.reason || 'Commit failed.');
    }
    return result.sha;
}

export async function getHistory() {
    try {
        return await withCoordinator(async () => (
            withLeaseLock('history', async () => callWorker<any[]>('getHistory', {}, 60000))
        ));
    } catch {
        return [];
    }
}
