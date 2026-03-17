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
export async function isWorkingTreeClean(
  workspaceRoot: string,
  options?: { ignorePaths?: string[] },
): Promise<boolean> {
  try {
    const { stdout } = await execFileP('git', ['status', '--porcelain'], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
    });
    const ignore = new Set((options?.ignorePaths ?? []).map(normalizeGitPath));
    const entries = stdout
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);

    if (entries.length === 0) return true;

    for (const line of entries) {
      const paths = extractPorcelainPaths(line).map(normalizeGitPath);
      const allIgnored = paths.length > 0 && paths.every((p) => ignore.has(p));
      if (!allIgnored) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeGitPath(p: string): string {
  // git always reports paths with forward slashes; normalize just in case.
  return p.replace(/\\/g, '/');
}

/**
 * Extracts one or two paths from a `git status --porcelain` line.
 * Handles normal entries: " M path", "?? path", and renames: "R  old -> new".
 */
function extractPorcelainPaths(line: string): string[] {
  // Porcelain v1: first 2 chars are status, then a space, then path(s).
  const rest = line.length >= 4 ? line.slice(3).trim() : line.trim();
  if (rest.includes('->')) {
    const [from, to] = rest.split('->').map((s) => s.trim());
    return [from, to].filter(Boolean);
  }
  return rest ? [rest] : [];
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
