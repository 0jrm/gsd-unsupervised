/**
 * Pure computation of resume pointers from session log and STATE.md.
 * Used by the daemon/orchestrator to resume from the last known successful
 * phase/plan when a previous run was interrupted (crashed or running).
 *
 * This module has no side effects: it does not mutate files or start processes.
 */

import path from 'node:path';
import { readSessionLog } from './session-log.js';
import type { SessionLogEntry } from './session-log.js';
import { readStateMd } from './state-parser.js';

/** Resume position for crash recovery. planNumber 0 means "first plan of this phase". */
export interface ResumePointer {
  phaseNumber: number;
  planNumber: number;
}

export interface ComputeResumePointerOpts {
  /** Path to the session log file (JSONL). */
  sessionLogPath: string;
  /** Path to STATE.md. */
  stateMdPath: string;
  /** First pending goal title; only entries matching this goal are considered. */
  goalTitle: string;
}

/**
 * Derives the last known successful execution point from the session log.
 * Returns null when:
 * - Session log or STATE is missing/unreadable
 * - No plan-complete or phase-complete entries exist for the goal
 * - The last entry for the goal is not running/crashed (run completed cleanly)
 * - STATE disagrees with the log in a way that indicates inconsistency (conservative fallback)
 *
 * plan-complete = status 'done' and phase '/gsd/execute-plan' with phaseNumber and planNumber
 * phase-complete = status 'done' and phase '/gsd/plan-phase' with phaseNumber
 *
 * When the last plan-complete is phase X plan Y, the pointer is (X, Y+1) — resume at next plan.
 * When the last phase-complete is phase X (no plan-complete in that phase), the pointer is (X+1, 0) — resume at first plan of next phase.
 * planNumber 0 means "first plan of the indicated phase".
 */
export async function computeResumePointer(
  opts: ComputeResumePointerOpts,
): Promise<ResumePointer | null> {
  const { sessionLogPath, stateMdPath, goalTitle } = opts;
  const goalTrim = goalTitle.trim();
  if (!goalTrim) return null;

  const entries = await readSessionLog(sessionLogPath);
  if (entries.length === 0) return null;

  const stateSnapshot = await readStateMd(stateMdPath);

  // Filter entries for this goal
  const goalEntries = entries.filter((e) => (e.goalTitle ?? '').trim() === goalTrim);
  if (goalEntries.length === 0) return null;

  // Only resume when the last entry for this goal is running or crashed
  const lastForGoal = goalEntries[goalEntries.length - 1];
  if (lastForGoal.status !== 'running' && lastForGoal.status !== 'crashed') {
    return null;
  }

  // Find last plan-complete (done + execute-plan with phaseNumber and planNumber)
  const planComplete = findLastPlanComplete(goalEntries);
  const phaseComplete = findLastPhaseComplete(goalEntries);

  let pointer: ResumePointer | null = null;

  if (planComplete) {
    // Resume at next plan in same phase
    pointer = {
      phaseNumber: planComplete.phaseNumber!,
      planNumber: (planComplete.planNumber ?? 0) + 1,
    };
  } else if (phaseComplete) {
    // Resume at first plan of next phase
    pointer = {
      phaseNumber: (phaseComplete.phaseNumber ?? 0) + 1,
      planNumber: 0,
    };
  }

  if (!pointer) return null;

  // Cross-check STATE: if STATE shows a phase in progress but we have no corresponding
  // completion in the log, favor the more conservative (earlier) pointer
  if (stateSnapshot) {
    const statePhase = stateSnapshot.phaseNumber;
    const statePlan = stateSnapshot.planNumber;
    const statusLower = stateSnapshot.status.toLowerCase();

    // STATE says we're in a phase with plans, but our pointer is ahead — be conservative
    if (
      pointer.phaseNumber > statePhase ||
      (pointer.phaseNumber === statePhase && pointer.planNumber > statePlan && statePlan > 0)
    ) {
      // STATE might be stale; if status suggests "in progress", use STATE as ceiling
      if (
        statusLower.includes('executing') ||
        statusLower.includes('planned') ||
        statusLower.includes('resuming')
      ) {
        if (statePhase < pointer.phaseNumber) {
          pointer = { phaseNumber: statePhase, planNumber: statePlan > 0 ? statePlan : 0 };
        } else if (statePhase === pointer.phaseNumber && statePlan > 0 && pointer.planNumber > statePlan) {
          pointer = { phaseNumber: statePhase, planNumber: statePlan };
        }
      }
    }
  }

  if (pointer.phaseNumber < 1) return null;
  if (pointer.planNumber < 0) return null;

  return pointer;
}

function findLastPlanComplete(entries: SessionLogEntry[]): SessionLogEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (
      e.status === 'done' &&
      e.phase === '/gsd/execute-plan' &&
      typeof e.phaseNumber === 'number' &&
      e.phaseNumber >= 1 &&
      typeof e.planNumber === 'number' &&
      e.planNumber >= 1
    ) {
      return e;
    }
  }
  return null;
}

function findLastPhaseComplete(entries: SessionLogEntry[]): SessionLogEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (
      e.status === 'done' &&
      e.phase === '/gsd/plan-phase' &&
      typeof e.phaseNumber === 'number' &&
      e.phaseNumber >= 1
    ) {
      return e;
    }
  }
  return null;
}
