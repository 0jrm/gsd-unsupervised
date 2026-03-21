import path from 'node:path';
import { readGsdState } from './gsd-state.js';

export interface DaemonHealth {
  running: boolean;
  reason: string;
  statePath: string;
  daemonPid?: number;
  lastHeartbeat?: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getDaemonHealth(
  workspaceRoot: string,
  options?: { heartbeatMaxAgeMs?: number; nowMs?: number },
): Promise<DaemonHealth> {
  const heartbeatMaxAgeMs = options?.heartbeatMaxAgeMs ?? 90_000;
  const nowMs = options?.nowMs ?? Date.now();
  const statePath = path.join(workspaceRoot, '.gsd', 'state.json');
  const state = await readGsdState(workspaceRoot);

  if (!state) {
    return {
      running: false,
      reason: 'missing-state',
      statePath,
    };
  }

  if (typeof state.daemonPid !== 'number' || !isProcessAlive(state.daemonPid)) {
    return {
      running: false,
      reason: 'pid-not-running',
      statePath,
      daemonPid: state.daemonPid,
      lastHeartbeat: state.lastHeartbeat,
    };
  }

  if (!state.lastHeartbeat) {
    return {
      running: false,
      reason: 'missing-heartbeat',
      statePath,
      daemonPid: state.daemonPid,
    };
  }

  const lastHeartbeatMs = new Date(state.lastHeartbeat).getTime();
  if (Number.isNaN(lastHeartbeatMs) || nowMs - lastHeartbeatMs > heartbeatMaxAgeMs) {
    return {
      running: false,
      reason: 'stale-heartbeat',
      statePath,
      daemonPid: state.daemonPid,
      lastHeartbeat: state.lastHeartbeat,
    };
  }

  return {
    running: true,
    reason: 'healthy',
    statePath,
    daemonPid: state.daemonPid,
    lastHeartbeat: state.lastHeartbeat,
  };
}
