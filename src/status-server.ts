import express, { type Request, type Response } from 'express';
import { readStateMd } from './state-parser.js';
import { readSessionLog } from './session-log.js';
import { getRecentCommits } from './git.js';

export interface StatusPayload {
  running: boolean;
  currentGoal?: string;
  phaseNumber?: number;
  planNumber?: number;
  heartbeat?: string;
}

/** Dashboard-oriented rich payload for GET /api/status. */
export interface DashboardStatusPayload {
  /** Legacy-compatible minimal fields. */
  running: boolean;
  currentGoal?: string;
  phaseNumber?: number;
  planNumber?: number;
  heartbeat?: string;
  /** Current agent session ID (from last session log entry). */
  currentAgentId?: string | null;
  /** Current phase/plan from STATE.md. */
  stateSnapshot?: {
    phaseNumber: number;
    totalPhases: number;
    phaseName: string;
    planNumber: number;
    totalPlans: number;
    status: string;
    lastActivity: string;
    progressPercent: number | null;
  } | null;
  /** Last N session log entries (rolling window). */
  sessionLogEntries?: Array<{
    timestamp: string;
    goalTitle: string;
    phase: string;
    phaseNumber?: number;
    planNumber?: number;
    sessionId: string | null;
    status: string;
  }>;
  /** Last N git commits (hash, message, timestamp). */
  gitFeed?: Array<{ hash: string; message: string; timestamp: string }>;
  /** Placeholder for token/cost tracking (populated later). */
  tokens?: { prompt?: number; completion?: number; total?: number };
  /** Placeholder for cost tracking (populated later). */
  cost?: { amount?: number; currency?: string };
}

export interface StatusServerOptions {
  stateMdPath: string;
  sessionLogPath: string;
  workspaceRoot: string;
  /** Max session log entries in dashboard payload (default 20). */
  sessionLogLimit?: number;
  /** Max git commits in feed (default 10). */
  gitFeedLimit?: number;
}

/**
 * Creates an Express-based HTTP server that serves:
 * - GET / and GET /status: legacy JSON status (same shape as before).
 * - GET /api/status: rich dashboard JSON (agent, goal, phase/plan, state snapshot, session log window, git feed, token/cost placeholders).
 * When options are provided, /api/status is enabled and reads from STATE.md, session-log, and git.
 */
export function createStatusServer(
  port: number,
  getStatus: () => StatusPayload,
  options?: StatusServerOptions,
): { server: import('node:http').Server; close: () => Promise<void> } {
  const app = express();
  const sessionLogLimit = options?.sessionLogLimit ?? 20;
  const gitFeedLimit = options?.gitFeedLimit ?? 10;

  /** Legacy routes: same JSON as before. */
  app.get('/', (_req: Request, res: Response) => {
    res.json(getStatus());
  });
  app.get('/status', (_req: Request, res: Response) => {
    res.json(getStatus());
  });

  /** Dashboard API: rich payload. */
  app.get('/api/status', async (_req: Request, res: Response) => {
    const legacy = getStatus();
    const payload: DashboardStatusPayload = {
      ...legacy,
      tokens: {},
      cost: {},
    };

    if (options) {
      const [stateSnapshot, sessionLogEntries, gitFeed] = await Promise.all([
        readStateMd(options.stateMdPath),
        readSessionLog(options.sessionLogPath).then((entries) =>
          entries.slice(-sessionLogLimit).reverse(),
        ),
        getRecentCommits(options.workspaceRoot, gitFeedLimit),
      ]);

      payload.stateSnapshot = stateSnapshot ?? undefined;
      payload.sessionLogEntries = sessionLogEntries.map((e) => ({
        timestamp: e.timestamp,
        goalTitle: e.goalTitle,
        phase: e.phase,
        phaseNumber: e.phaseNumber,
        planNumber: e.planNumber,
        sessionId: e.sessionId,
        status: e.status,
      }));
      payload.gitFeed = gitFeed;
      const lastEntry = sessionLogEntries[0];
      if (lastEntry) {
        payload.currentAgentId = lastEntry.sessionId;
      }
    }

    res.json(payload);
  });

  const server = app.listen(port);

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { server, close };
}
