import git from 'isomorphic-git';
import { fs, pfs } from './fs';

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
const HEAL_SNAPSHOT_MESSAGE = 'Auto-heal: Rebuilt git metadata from workspace snapshot';
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

export interface CommitDurableResult {
    ok: boolean;
    healed: boolean;
    historyReset: boolean;
    sha?: string;
    reason?: string;
}

let coordinatorQueue: Promise<void> = Promise.resolve();

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

async function pathExists(path: string): Promise<boolean> {
    try {
        await pfs.stat(path);
        return true;
    } catch {
        return false;
    }
}

async function removePathRecursive(path: string): Promise<void> {
    try {
        const entries = await pfs.readdir(path);
        if (Array.isArray(entries)) {
            for (const entry of entries) {
                await removePathRecursive(`${path}/${entry}`);
            }
            await pfs.rmdir(path);
            return;
        }
    } catch {
        // Fall through to unlink attempt.
    }
    try {
        await pfs.unlink(path);
    } catch {
        // Ignore missing paths.
    }
}

async function ensureRepoInitialized() {
    try {
        await git.init({ fs, dir: REPO_DIR });
    } catch {
        // ignore
    }
}

async function statusMatrixSafe() {
    return git.statusMatrix({ fs, dir: REPO_DIR });
}

async function stageAllChanges() {
    const statusMatrix = await statusMatrixSafe();
    let hasChanges = false;

    for (const row of statusMatrix) {
        const filepath = row[0];
        const headStatus = row[1];
        const worktreeStatus = row[2];
        const stageStatus = row[3];

        if (worktreeStatus !== headStatus || worktreeStatus !== stageStatus) {
            hasChanges = true;
            if (worktreeStatus === 0) {
                await git.remove({ fs, dir: REPO_DIR, filepath });
            } else {
                await git.add({ fs, dir: REPO_DIR, filepath });
            }
        }
    }

    return hasChanges;
}

async function commitStaged(message: string): Promise<string | undefined> {
    const hasChanges = await stageAllChanges();
    if (!hasChanges) return undefined;

    return git.commit({
        fs,
        dir: REPO_DIR,
        author: AUTHOR,
        message
    });
}

async function verifyCommitReadable(sha?: string) {
    if (sha) {
        await git.readCommit({ fs, dir: REPO_DIR, oid: sha });
    }
    try {
        const head = await git.resolveRef({ fs, dir: REPO_DIR, ref: 'HEAD' });
        if (head) {
            await git.readCommit({ fs, dir: REPO_DIR, oid: head });
        }
    } catch {
        // Empty repo can have no HEAD.
    }
}

async function rebuildRepoFromCurrentWorktree() {
    if (await pathExists('/.git')) {
        await removePathRecursive('/.git');
    }
    await git.init({ fs, dir: REPO_DIR });
    await commitStaged(HEAL_SNAPSHOT_MESSAGE);
}

async function recoverStaleJournalIfNeeded() {
    const storage = getStorage();
    if (!storage) return;
    const journal = readJournal(storage);
    if (!journal) return;
    const stale = nowMs() - journal.updatedAt > STALE_JOURNAL_MS;
    if (!stale) return;

    if (isRecoverableGitObjectError(new Error(`stale journal at ${journal.stage}`))) {
        try {
            await rebuildRepoFromCurrentWorktree();
        } catch {
            // Ignore and allow normal durable flow to handle failures.
        }
    }
    storage.removeItem(GIT_JOURNAL_KEY);
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

async function commitOnceWithJournal(message: string, opId: string) {
    const storage = getStorage();
    if (storage) writeJournal(storage, makeJournal(opId, 'start', message));

    await ensureRepoInitialized();
    try {
        const head = await git.resolveRef({ fs, dir: REPO_DIR, ref: 'HEAD' });
        if (head) {
            await git.readCommit({ fs, dir: REPO_DIR, oid: head });
        }
    } catch {
        // Empty or fresh repositories may not have a readable HEAD yet.
    }
    if (storage) writeJournal(storage, makeJournal(opId, 'preflight_done', message));

    await statusMatrixSafe();
    if (storage) writeJournal(storage, makeJournal(opId, 'status_matrix_done', message));

    const sha = await commitStaged(message);
    if (storage) {
        writeJournal(storage, makeJournal(opId, 'staging_done', message));
        writeJournal(storage, makeJournal(opId, 'commit_done', message));
    }

    await verifyCommitReadable(sha);
    if (storage) writeJournal(storage, makeJournal(opId, 'verify_done', message));

    return sha;
}

/**
 * Initialize a new git repository in the workspace.
 */
export async function initRepo() {
    await withCoordinator(async () => {
        await withLeaseLock('init', async () => {
            await recoverStaleJournalIfNeeded();
            await ensureRepoInitialized();
        });
    });
}

export async function commitAllDurable(message: string): Promise<CommitDurableResult> {
    return withCoordinator(async () => (
        withLeaseLock('commit', async (opId) => {
            await recoverStaleJournalIfNeeded();
            const storage = getStorage();

            try {
                const sha = await commitOnceWithJournal(message, opId);
                if (storage) clearJournal(storage, opId);
                return {
                    ok: true,
                    healed: false,
                    historyReset: false,
                    sha
                };
            } catch (error) {
                if (!isRecoverableGitObjectError(error)) {
                    if (storage) clearJournal(storage, opId);
                    return {
                        ok: false,
                        healed: false,
                        historyReset: false,
                        reason: stringifyError(error)
                    };
                }

                try {
                    await rebuildRepoFromCurrentWorktree();
                    const retrySha = await commitOnceWithJournal(message, opId);
                    if (storage) clearJournal(storage, opId);
                    return {
                        ok: true,
                        healed: true,
                        historyReset: true,
                        sha: retrySha
                    };
                } catch (retryError) {
                    if (storage) clearJournal(storage, opId);
                    return {
                        ok: false,
                        healed: true,
                        historyReset: true,
                        reason: stringifyError(retryError)
                    };
                }
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
            withLeaseLock('history', async () => git.log({ fs, dir: REPO_DIR }))
        ));
    } catch {
        return [];
    }
}
