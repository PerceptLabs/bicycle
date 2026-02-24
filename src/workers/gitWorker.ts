import git from 'isomorphic-git';
import FS from '@isomorphic-git/lightning-fs';

const fs = new FS('workspace');
const pfs = fs.promises;
const REPO_DIR = '/';
const AUTHOR = {
  name: 'App Builder',
  email: 'builder@localhost'
};
const HEAL_SNAPSHOT_MESSAGE = 'Auto-heal: Rebuilt git metadata from workspace snapshot';

type GitWorkerMethod = 'initRepo' | 'commitDurable' | 'getHistory' | 'recoverFromStaleJournal';

interface GitWorkerRequest {
  id: number;
  method: GitWorkerMethod;
  payload?: any;
}

interface GitWorkerResponse {
  id: number;
  ok: boolean;
  result?: any;
  error?: string;
}

interface CommitDurableResult {
  ok: boolean;
  healed: boolean;
  historyReset: boolean;
  sha?: string;
  reason?: string;
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

function isRecoverableGitObjectError(error: unknown): boolean {
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

function normalizeGitPath(filepath: string): string {
  return filepath.replace(/\\/g, '/').replace(/^\/+/, '');
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

async function stageAllChangesByScan() {
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

async function stageChangedPaths(changedPaths: string[]): Promise<boolean> {
  const unique = Array.from(new Set(changedPaths.map(normalizeGitPath).filter(Boolean)));
  if (unique.length === 0) return false;

  let hasChanges = false;
  for (const filepath of unique) {
    try {
      await pfs.stat(`/${filepath}`);
      await git.add({ fs, dir: REPO_DIR, filepath });
      hasChanges = true;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        try {
          await git.remove({ fs, dir: REPO_DIR, filepath });
          hasChanges = true;
        } catch {
          // Ignore if remove is not needed.
        }
        continue;
      }
      throw error;
    }
  }

  return hasChanges;
}

async function commitStaged(message: string, changedPaths?: string[]): Promise<string | undefined> {
  const hasChanges = Array.isArray(changedPaths)
    ? await stageChangedPaths(changedPaths)
    : await stageAllChangesByScan();
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

async function commitOnce(message: string, changedPaths?: string[]) {
  await ensureRepoInitialized();
  try {
    const head = await git.resolveRef({ fs, dir: REPO_DIR, ref: 'HEAD' });
    if (head) {
      await git.readCommit({ fs, dir: REPO_DIR, oid: head });
    }
  } catch {
    // Empty or fresh repositories may not have a readable HEAD yet.
  }

  const sha = await commitStaged(message, changedPaths);
  await verifyCommitReadable(sha);
  return sha;
}

async function rebuildRepoFromCurrentWorktree() {
  if (await pathExists('/.git')) {
    await removePathRecursive('/.git');
  }
  await git.init({ fs, dir: REPO_DIR });
  await commitStaged(HEAL_SNAPSHOT_MESSAGE);
}

async function commitDurable(message: string, changedPaths: string[]): Promise<CommitDurableResult> {
  try {
    const sha = await commitOnce(message, changedPaths);
    return {
      ok: true,
      healed: false,
      historyReset: false,
      sha
    };
  } catch (error) {
    if (!isRecoverableGitObjectError(error)) {
      return {
        ok: false,
        healed: false,
        historyReset: false,
        reason: stringifyError(error)
      };
    }

    try {
      await rebuildRepoFromCurrentWorktree();
      const retrySha = await commitOnce(message, changedPaths);
      return {
        ok: true,
        healed: true,
        historyReset: true,
        sha: retrySha
      };
    } catch (retryError) {
      return {
        ok: false,
        healed: true,
        historyReset: true,
        reason: stringifyError(retryError)
      };
    }
  }
}

async function getHistory() {
  try {
    return await git.log({ fs, dir: REPO_DIR });
  } catch {
    return [];
  }
}

async function recoverFromStaleJournal() {
  await rebuildRepoFromCurrentWorktree();
  return { ok: true };
}

async function handleRequest(request: GitWorkerRequest): Promise<any> {
  switch (request.method) {
    case 'initRepo':
      await ensureRepoInitialized();
      return { ok: true };
    case 'commitDurable':
      return commitDurable(
        request.payload?.message || 'Update',
        Array.isArray(request.payload?.changedPaths) ? request.payload.changedPaths : []
      );
    case 'getHistory':
      return getHistory();
    case 'recoverFromStaleJournal':
      return recoverFromStaleJournal();
    default:
      throw new Error(`Unsupported git worker method: ${request.method}`);
  }
}

self.onmessage = async (event: MessageEvent<GitWorkerRequest>) => {
  const request = event.data;
  const response: GitWorkerResponse = { id: request.id, ok: true };
  try {
    response.result = await handleRequest(request);
  } catch (error) {
    response.ok = false;
    response.error = stringifyError(error);
  }
  self.postMessage(response);
};
