import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

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
