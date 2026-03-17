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

/** Returns inline HTML for the dashboard (mobile-first, no build). */
function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GSD Autopilot</title>
  <style>
    :root { --bg: #0f0f12; --card: #1a1a1f; --text: #e4e4e7; --muted: #71717a; --accent: #22c55e; --border: #27272a; }
    @media (prefers-color-scheme: light) {
      :root { --bg: #fafafa; --card: #fff; --text: #18181b; --muted: #71717a; --accent: #16a34a; --border: #e4e4e7; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    .container { max-width: 720px; margin: 0 auto; padding: 1rem; }
    header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
    h1 { margin: 0; font-size: 1.25rem; font-weight: 600; }
    .badge { font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 9999px; background: var(--card); color: var(--muted); }
    .badge.running { background: rgba(34,197,94,0.2); color: var(--accent); }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .card h2 { margin: 0 0 0.5rem; font-size: 0.875rem; font-weight: 600; color: var(--muted); }
    .progress-wrap { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin-top: 0.5rem; }
    .progress-bar { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s ease; }
    .git-feed { font-size: 0.8125rem; }
    .git-feed li { list-style: none; padding: 0.35rem 0; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.15rem; }
    .git-feed li:last-child { border-bottom: 0; }
    .git-hash { font-family: ui-monospace, monospace; color: var(--muted); font-size: 0.75rem; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.75rem; }
    .metrics span { font-size: 0.8125rem; color: var(--muted); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>GSD Autopilot</h1>
      <span class="badge" id="status-badge">—</span>
      <span class="badge" id="agent-badge">Agent: —</span>
    </header>
    <section class="card" id="goal-card">
      <h2>Current goal</h2>
      <p id="goal-title" style="margin:0;">—</p>
      <div class="progress-wrap"><div class="progress-bar" id="progress-bar" style="width:0%"></div></div>
      <p id="phase-plan" style="margin:0.5rem 0 0;font-size:0.8125rem;color:var(--muted)">—</p>
    </section>
    <section class="card">
      <h2>Recent commits</h2>
      <ul class="git-feed" id="git-feed"></ul>
    </section>
    <section class="card">
      <h2>Tokens / cost</h2>
      <div class="metrics" id="metrics"><span>—</span></div>
    </section>
  </div>
  <script>
    const API = '/api/status';
    const REFRESH_MS = 10000;

    function render(data) {
      document.getElementById('status-badge').textContent = data.running ? 'Running' : 'Stopped';
      document.getElementById('status-badge').className = 'badge' + (data.running ? ' running' : '');
      document.getElementById('agent-badge').textContent = 'Agent: ' + (data.currentAgentId || '—');
      document.getElementById('goal-title').textContent = data.currentGoal || '—';
      const snap = data.stateSnapshot || null;
      const pct = snap && snap.progressPercent != null ? snap.progressPercent : 0;
      document.getElementById('progress-bar').style.width = pct + '%';
      document.getElementById('phase-plan').textContent = snap
        ? 'Phase ' + snap.phaseNumber + '/' + snap.totalPhases + ' · Plan ' + snap.planNumber + '/' + snap.totalPlans + ' — ' + snap.status
        : '—';
      const feed = document.getElementById('git-feed');
      feed.innerHTML = (data.gitFeed || []).map(function(c) {
        return '<li><span class="git-hash">' + c.hash + '</span> ' + escapeHtml(c.message) + ' <span style="color:var(--muted)">' + c.timestamp + '</span></li>';
      }).join('') || '<li>No commits</li>';
      const t = data.tokens || {};
      const cost = data.cost || {};
      document.getElementById('metrics').innerHTML = ('<span>Tokens: ' + (t.total ?? '—') + '</span><span>Cost: ' + (cost.amount != null ? cost.amount + ' ' + (cost.currency || '') : '—') + '</span>');
    }

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }

    function fetchStatus() {
      fetch(API).then(function(r) { return r.json(); }).then(render).catch(function() {});
    }

    fetchStatus();
    setInterval(fetchStatus, REFRESH_MS);
  </script>
</body>
</html>`;
}

/**
 * Creates an Express-based HTTP server that serves:
 * - GET /: dashboard HTML (when options are provided) or legacy JSON.
 * - GET /status: legacy JSON status (same shape as before).
 * - GET /api/status: rich dashboard JSON (agent, goal, phase/plan, state snapshot, session log window, git feed, token/cost placeholders).
 * When options are provided, / serves the dashboard and /api/status is enabled; otherwise / and /status return legacy JSON.
 */
export function createStatusServer(
  port: number,
  getStatus: () => StatusPayload,
  options?: StatusServerOptions,
): { server: import('node:http').Server; close: () => Promise<void> } {
  const app = express();
  const sessionLogLimit = options?.sessionLogLimit ?? 20;
  const gitFeedLimit = options?.gitFeedLimit ?? 10;

  /** Dashboard at GET / when rich options provided; legacy JSON at GET /status. */
  if (options) {
    app.get('/', (_req: Request, res: Response) => {
      res.type('html').send(getDashboardHtml());
    });
  } else {
    app.get('/', (_req: Request, res: Response) => {
      res.json(getStatus());
    });
  }
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
