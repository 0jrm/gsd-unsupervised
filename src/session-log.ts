import { readFile, appendFile } from 'node:fs/promises';
import { readStateMd } from './state-parser.js';

/** Context passed when invoking the agent for session log entries (goal/phase/plan). */
export interface SessionLogContext {
  goalTitle: string;
  phaseNumber?: number;
  planNumber?: number;
}

/**
 * Session log schema (append-only, one JSON object per line).
 * - timestamp: ISO string
 * - goalTitle: string
 * - phase: command label (e.g. /gsd/execute-plan)
 * - phaseNumber, planNumber: optional; set when in phase/plan loop for crash recovery
 * - sessionId: string | null
 * - command: full command string
 * - status: 'running' | 'done' | 'crashed' | 'timeout'
 * - durationMs, error: optional
 * No in-place edits; append only.
 */
export interface SessionLogEntry {
  timestamp: string;
  goalTitle: string;
  phase: string;
  phaseNumber?: number;
  planNumber?: number;
  sessionId: string | null;
  command: string;
  status: 'running' | 'done' | 'crashed' | 'timeout';
  durationMs?: number;
  error?: string;
}

export async function appendSessionLog(logPath: string, entry: SessionLogEntry): Promise<void> {
  const line = JSON.stringify(entry) + '\n';
  await appendFile(logPath, line, { encoding: 'utf-8', flag: 'a' });
}

export async function readSessionLog(logPath: string): Promise<SessionLogEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const entries: SessionLogEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as SessionLogEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

/**
 * Returns the last entry with status 'running'. Legacy alias for
 * inspectForCrashedSessions when only 'running' is needed.
 */
export async function getLastRunningSession(logPath: string): Promise<SessionLogEntry | null> {
  const entries = await readSessionLog(logPath);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === 'running') {
      return entries[i];
    }
  }
  return null;
}

/**
 * Returns the most recent entry if its status is 'running' or 'crashed', else null.
 * Used for crash recovery to detect an interrupted session. Skips malformed lines.
 */
export async function inspectForCrashedSessions(
  logPath: string,
): Promise<SessionLogEntry | null> {
  const entries = await readSessionLog(logPath);
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1];
  return last.status === 'running' || last.status === 'crashed' ? last : null;
}

/** Resume position for crash recovery; only when unambiguous. */
export interface ResumeFrom {
  phaseNumber: number;
  planNumber: number;
}

/**
 * Computes a deterministic resume point when the last session was crashed or running.
 * Returns null on ambiguity (empty log, goal mismatch, or missing phase/plan).
 * Prefers STATE.md for position; falls back to log entry phaseNumber/planNumber only if both >= 1.
 */
export async function computeResumePoint(
  sessionLogPath: string,
  stateMdPath: string,
  firstPendingGoalTitle: string,
): Promise<ResumeFrom | null> {
  const entry = await inspectForCrashedSessions(sessionLogPath);
  const goalTrim = firstPendingGoalTitle.trim();
  if (!entry || !goalTrim) return null;
  if (entry.goalTitle.trim() !== goalTrim) return null;

  const snapshot = await readStateMd(stateMdPath);
  if (snapshot !== null && snapshot.phaseNumber >= 1 && snapshot.planNumber >= 1) {
    return { phaseNumber: snapshot.phaseNumber, planNumber: snapshot.planNumber };
  }
  const p = entry.phaseNumber;
  const n = entry.planNumber;
  if (p !== undefined && n !== undefined && p >= 1 && n >= 1) {
    return { phaseNumber: p, planNumber: n };
  }
  return null;
}
