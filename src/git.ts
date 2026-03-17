import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit, type LogResult } from 'simple-git';

const execFileP = promisify(execFile);

/** One commit in the feed for dashboard/API. */
export interface CommitEntry {
  hash: string;
  message: string;
  timestamp: string;
}

/**
 * Returns true if git working tree has no uncommitted changes (clean).
 * Runs `git status --porcelain` in workspaceRoot; empty output = clean.
 */
export async function isWorkingTreeClean(workspaceRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileP('git', ['status', '--porcelain'], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
    });
    return stdout.trim().length === 0;
  } catch {
    return false;
  }
}

/**
 * Creates a checkpoint commit: git add -A && git commit -m message.
 * Use when autoCheckpoint is true and tree is dirty before execute-plan.
 */
export async function createCheckpoint(workspaceRoot: string, message: string): Promise<void> {
  await execFileP('git', ['add', '-A'], { cwd: workspaceRoot });
  await execFileP('git', ['commit', '-m', message], { cwd: workspaceRoot });
}

/**
 * Returns the last N commits (hash, message, timestamp) for dashboard/API.
 * Uses simple-git. Returns [] on error or not a git repo.
 */
export async function getRecentCommits(
  workspaceRoot: string,
  limit: number = 10,
): Promise<CommitEntry[]> {
  try {
    const git = simpleGit(workspaceRoot);
    const log: LogResult = await git.log({ maxCount: limit });
    return log.all.map((c) => ({
      hash: c.hash,
      message: c.message,
      timestamp: typeof c.date === 'string' ? c.date : (c.date as Date).toISOString(),
    }));
  } catch {
    return [];
  }
}
