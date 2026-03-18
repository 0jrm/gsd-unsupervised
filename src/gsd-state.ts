/**
 * Single source of truth for gsd-unsupervised daemon state.
 * Lives at <workspaceRoot>/.gsd/state.json so ./run can resume reliably.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type GsdMode = 'self' | 'project';

export interface GsdState {
  mode: GsdMode;
  /** Project name (e.g. "gsd-unsupervised" or "my-other-app"). */
  project: string;
  /** Agent type: cursor, cn, claude-code, gemini-cli, codex. */
  agent?: string;
  /** Absolute or relative path to workspace root (where .planning/ and goals live). */
  workspaceRoot: string;
  /** Path to goals.md relative to workspaceRoot or absolute. */
  goalsPath: string;
  /** Daemon process ID (set when daemon starts). */
  daemonPid?: number;
  /** ISO timestamp when daemon started. */
  startedAt?: string;
  /** Last completed goal title (for display). */
  lastGoalCompleted?: string;
  /** Progress string e.g. "2/9". */
  progress?: string;
  /** Status server port (e.g. 3000). */
  statusServerPort?: number;
  /** Public dashboard URL from ngrok (ephemeral). */
  ngrokUrl?: string;
  /** ISO timestamp of last heartbeat (for SMS pulse check). */
  lastHeartbeat?: string;
  /** Current goal title while running. */
  currentGoal?: string;
}

const DEFAULT_STATE: Partial<GsdState> = {
  mode: 'self',
  goalsPath: './goals.md',
};

/**
 * Resolve state file path: <workspaceRoot>/.gsd/state.json.
 * If stateDir is provided it's the directory containing state.json.
 */
export function getStatePath(workspaceRoot: string): string {
  return `${workspaceRoot.replace(/\/$/, '')}/.gsd/state.json`;
}

/**
 * Read state from .gsd/state.json in workspaceRoot. Returns null if missing or invalid.
 */
export async function readGsdState(workspaceRoot: string): Promise<GsdState | null> {
  const path = getStatePath(workspaceRoot);
  return readGsdStateFromPath(path, workspaceRoot);
}

/**
 * Read state from an absolute path to state.json. Default workspaceRoot if not in file.
 */
export async function readGsdStateFromPath(
  statePath: string,
  defaultWorkspaceRoot?: string,
): Promise<GsdState | null> {
  if (!existsSync(statePath)) return null;
  const fallbackRoot = defaultWorkspaceRoot ?? dirname(dirname(statePath));
  try {
    const raw = await readFile(statePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      mode: (data.mode === 'project' ? 'project' : 'self') as GsdMode,
      project: typeof data.project === 'string' ? data.project : 'gsd-unsupervised',
      agent: typeof data.agent === 'string' ? data.agent : undefined,
      workspaceRoot: typeof data.workspaceRoot === 'string' ? data.workspaceRoot : fallbackRoot,
      goalsPath: typeof data.goalsPath === 'string' ? data.goalsPath : './goals.md',
      daemonPid: typeof data.daemonPid === 'number' ? data.daemonPid : undefined,
      startedAt: typeof data.startedAt === 'string' ? data.startedAt : undefined,
      lastGoalCompleted: typeof data.lastGoalCompleted === 'string' ? data.lastGoalCompleted : undefined,
      progress: typeof data.progress === 'string' ? data.progress : undefined,
      statusServerPort: typeof data.statusServerPort === 'number' ? data.statusServerPort : undefined,
      ngrokUrl: typeof data.ngrokUrl === 'string' ? data.ngrokUrl : undefined,
      lastHeartbeat: typeof data.lastHeartbeat === 'string' ? data.lastHeartbeat : undefined,
      currentGoal: typeof data.currentGoal === 'string' ? data.currentGoal : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Write state to .gsd/state.json. Creates .gsd/ if needed.
 * Partial update: only provided fields are merged in.
 * If statePath is provided, write there; otherwise use getStatePath(workspaceRoot).
 */
export async function writeGsdState(
  workspaceRoot: string,
  update: Partial<GsdState>,
  statePath?: string,
): Promise<void> {
  const path = statePath ?? getStatePath(workspaceRoot);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const existing = statePath
    ? await readGsdStateFromPath(path, workspaceRoot)
    : await readGsdState(workspaceRoot);
  const merged: GsdState = {
    mode: existing?.mode ?? (DEFAULT_STATE.mode as GsdMode),
    project: existing?.project ?? 'gsd-unsupervised',
    workspaceRoot: existing?.workspaceRoot ?? workspaceRoot,
    goalsPath: existing?.goalsPath ?? DEFAULT_STATE.goalsPath!,
    ...existing,
    ...update,
  };
  await writeFile(path, JSON.stringify(merged, null, 2), 'utf-8');
}
