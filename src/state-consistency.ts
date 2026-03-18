/**
 * Cross-checks STATE.md, .gsd/state.json, and session log for consistency.
 * Used at daemon startup to refuse proceeding when state is fragmented.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.js';
import { readStateMd } from './state-parser.js';
import { readGsdState } from './gsd-state.js';
import { readSessionLog } from './session-log.js';

export interface ConsistencyReport {
  consistent: boolean;
  warnings: string[];
  suggestedAction: 'proceed' | 'resume' | 'reset';
}

const HEARTBEAT_FILENAME = 'heartbeat.txt';

/**
 * Validates consistency across STATE.md, .gsd/state.json, and session log.
 * - Inconsistent if STATE.md phase differs from session log last phaseNumber by more than 1.
 * - Inconsistent if session log shows 'running' but no heartbeat file exists.
 * Returns a report with suggestedAction: proceed | resume | reset.
 */
export async function validateStateConsistency(
  workspaceRoot: string,
  logger: Logger,
  options?: { sessionLogPath?: string },
): Promise<ConsistencyReport> {
  const warnings: string[] = [];
  const stateMdPath = path.join(workspaceRoot, '.planning', 'STATE.md');
  const sessionLogPath =
    options?.sessionLogPath ??
    path.resolve(workspaceRoot, 'session-log.jsonl');

  const [stateSnapshot, gsdState, entries] = await Promise.all([
    readStateMd(stateMdPath),
    readGsdState(workspaceRoot),
    readSessionLog(sessionLogPath),
  ]);

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

  // Session log says "running" but heartbeat missing or stale
  if (lastEntry?.status === 'running') {
    const heartbeatPath = path.join(workspaceRoot, '.planning', HEARTBEAT_FILENAME);
    if (!existsSync(heartbeatPath)) {
      warnings.push('Session log has status "running" but .planning/heartbeat.txt does not exist');
    }
  }

  // Phase drift: STATE.md vs last session log phase
  const logPhase = lastEntry?.phaseNumber;
  if (typeof logPhase === 'number' && stateSnapshot) {
    const statePhase = stateSnapshot.phaseNumber;
    const phaseDiff = Math.abs(statePhase - logPhase);
    if (phaseDiff > 1) {
      warnings.push(
        `STATE.md phase (${statePhase}) differs from session log last phaseNumber (${logPhase}) by more than 1`,
      );
    }
  }

  const hasRunningWithoutHeartbeat = warnings.some((w) =>
    w.includes('heartbeat'),
  );
  const hasPhaseDrift = warnings.some((w) =>
    w.includes('differs from session log'),
  );

  let suggestedAction: ConsistencyReport['suggestedAction'] = 'proceed';
  if (hasRunningWithoutHeartbeat || hasPhaseDrift) {
    suggestedAction = 'reset';
  } else if (warnings.length > 0) {
    suggestedAction = 'resume';
  }

  const consistent = warnings.length === 0;

  if (gsdState?.daemonPid != null && !consistent) {
    logger.debug(
      { daemonPid: gsdState.daemonPid, warnings },
      'State consistency check found issues',
    );
  }

  return {
    consistent,
    warnings,
    suggestedAction,
  };
}
