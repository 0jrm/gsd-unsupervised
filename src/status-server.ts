import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import express, { type Request, type Response } from 'express';
import { appendPendingGoal } from './goals.js';
import twilio from 'twilio';
import { normalizeSmsInput } from './intake/normalizer.js';
import { classifyGoal } from './intake/classifier.js';
import { clarifyGoal, readPendingGoals, resolvePendingGoal, writePendingGoal } from './intake/clarifier.js';
import { queueGoal } from './intake/goals-writer.js';
import type { PendingGoal } from './intake/types.js';

function escapeTwiML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
import { readStateMd } from './state-parser.js';
import { readSessionLog } from './session-log.js';
import { getRecentCommits } from './git.js';
import { currentLoadInfo, currentLoadInfoAsync } from './resource-governor.js';

/** Schema for .planning/config.json parallelization slice (exposed via /api/config). */
export interface PlanningConfig {
  mode?: string;
  depth?: string;
  parallelization?: {
    enabled?: boolean;
    plan_level?: boolean;
    task_level?: boolean;
    skip_checkpoints?: boolean;
    max_concurrent_agents?: number;
    min_plans_for_parallel?: number;
  };
  gates?: Record<string, boolean>;
  safety?: Record<string, boolean>;
}

export interface StatusPayload {
  running: boolean;
  currentGoal?: string;
  phaseNumber?: number;
  planNumber?: number;
  heartbeat?: string;
  /** Live agent session ID while an agent is running (from daemon). */
  currentAgentId?: string | null;
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
  /** Current system load information (best-effort). */
  systemLoad?: import('./resource-governor.js').LoadInfo & {
    maxCpuFraction?: number;
    maxMemoryFraction?: number;
    maxGpuFraction?: number;
  };
}

/** Optional webhook: add goals/todos via API or Twilio inbound. */
export interface WebhookOptions {
  goalsPath: string;
  workspaceRoot: string;
  /** Callback when a goal is added (persisted to goals.md by route). */
  onQueueGoal: (goal: import('./goals.js').Goal) => void;
  /** Titles of goals currently being executed (for dedup on reload). */
  getRunningTitles: () => string[];
  /** Create a todo file; returns path. */
  addTodo: (title: string, area?: string) => Promise<string>;
}

export interface StatusServerOptions {
  stateMdPath: string;
  sessionLogPath: string;
  workspaceRoot: string;
  /** Path to .planning/config.json for GET/POST /api/config (optional). */
  planningConfigPath?: string;
  /** Max session log entries in dashboard payload (default 20). */
  sessionLogLimit?: number;
  /** Max git commits in feed (default 10). */
  gitFeedLimit?: number;
  /** When set, enables POST /api/goals, POST /api/todos, POST /webhook/twilio. */
  webhook?: WebhookOptions;
  /** Optional logger for port-in-use warning when running without status server. */
  logger?: import('./logger.js').Logger;
}

const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  mode: 'interactive',
  depth: 'standard',
  parallelization: {
    enabled: false,
    plan_level: false,
    task_level: false,
    skip_checkpoints: false,
    max_concurrent_agents: 3,
    min_plans_for_parallel: 2,
  },
};

export async function readPlanningConfig(path: string): Promise<PlanningConfig> {
  if (!existsSync(path)) return { ...DEFAULT_PLANNING_CONFIG };
  try {
    const raw = await readFile(path, 'utf-8');
    const data = JSON.parse(raw) as PlanningConfig;
    return {
      ...DEFAULT_PLANNING_CONFIG,
      ...data,
      parallelization: { ...DEFAULT_PLANNING_CONFIG.parallelization, ...data.parallelization },
    };
  } catch {
    return { ...DEFAULT_PLANNING_CONFIG };
  }
}

async function writePlanningConfig(path: string, config: PlanningConfig): Promise<void> {
  await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
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
    .toggle-wrap { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .toggle { position: relative; width: 44px; height: 24px; background: var(--border); border-radius: 9999px; cursor: pointer; border: none; }
    .toggle.on { background: var(--accent); }
    .toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: #fff; border-radius: 50%; transition: transform 0.2s; }
    .toggle.on::after { transform: translateX(20px); }
    .toggle-label { font-size: 0.875rem; }
    .error-msg { font-size: 0.8125rem; color: #ef4444; margin-top: 0.25rem; }
    .agent-list { list-style: none; margin: 0; padding: 0; }
    .agent-list li { font-size: 0.65rem; line-height: 1.4; padding: 0.15rem 0; display: flex; align-items: center; gap: 0.35rem; }
    .agent-list .agent-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
    .agent-list .agent-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
      <h2>Agent sessions <span class="badge" id="agent-active-badge">0 active</span></h2>
      <ul class="agent-list" id="agent-list"></ul>
    </section>
    <section class="card">
      <h2>Recent commits</h2>
      <ul class="git-feed" id="git-feed"></ul>
    </section>
    <section class="card">
      <h2>Tokens / cost</h2>
      <div class="metrics" id="metrics"><span>—</span></div>
    </section>
    <section class="card" id="config-section">
      <h2>Execution mode</h2>
      <div class="toggle-wrap">
        <button type="button" class="toggle" id="mode-toggle" aria-label="Parallel mode"></button>
        <span class="toggle-label" id="mode-label">Sequential</span>
      </div>
      <p class="error-msg" id="config-error" style="display:none"></p>
    </section>
  </div>
  <script>
    const API = '/api/status';
    const CONFIG_API = '/api/config';
    const REFRESH_MS = 10000;
    var AGENT_COLORS = ['#22c55e','#3b82f6','#a855f7','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16'];

    function progressPercent(snap) {
      if (!snap) return 0;
      if (snap.progressPercent != null) return snap.progressPercent;
      if (snap.totalPhases < 1) return 0;
      var phaseProgress = (snap.phaseNumber - 1) / snap.totalPhases;
      var planProgress = snap.totalPlans > 0
        ? (snap.planNumber / snap.totalPlans) / snap.totalPhases
        : 0;
      return Math.round((phaseProgress + planProgress) * 100);
    }
    function render(data) {
      document.getElementById('status-badge').textContent = data.running ? 'Running' : 'Stopped';
      document.getElementById('status-badge').className = 'badge' + (data.running ? ' running' : '');
      document.getElementById('agent-badge').textContent = 'Agent: ' + (data.currentAgentId || '—');
      document.getElementById('goal-title').textContent = data.currentGoal || '—';
      const snap = data.stateSnapshot || null;
      const pct = progressPercent(snap);
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
      var entries = data.sessionLogEntries || [];
      var activeCount = entries.filter(function(e) { return e.status === 'running'; }).length;
      document.getElementById('agent-active-badge').textContent = activeCount + ' active';
      var listEl = document.getElementById('agent-list');
      listEl.innerHTML = entries.length
        ? entries.map(function(e, i) {
            var name = (e.sessionId || '').trim() ? (e.sessionId.length > 12 ? e.sessionId.slice(0, 12) + '…' : e.sessionId) : (e.goalTitle || '—');
            var color = AGENT_COLORS[i % AGENT_COLORS.length];
            return '<li><span class="agent-dot" style="background:' + color + '"></span><span class="agent-name" style="color:' + color + '">' + escapeHtml(name) + '</span></li>';
          }).join('')
        : '<li class="agent-name" style="color:var(--muted)">No sessions</li>';
    }

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }

    function renderConfig(parallel) {
      var t = document.getElementById('mode-toggle');
      var l = document.getElementById('mode-label');
      t.classList.toggle('on', !!parallel);
      l.textContent = parallel ? 'Parallel' : 'Sequential';
    }

    function fetchStatus() {
      fetch(API).then(function(r) { return r.json(); }).then(render).catch(function() {});
    }

    function fetchConfig() {
      fetch(CONFIG_API).then(function(r) { return r.json(); }).then(function(c) {
        renderConfig(c.parallelization && c.parallelization.enabled);
      }).catch(function() {});
    }

    document.getElementById('mode-toggle').addEventListener('click', function() {
      var errEl = document.getElementById('config-error');
      errEl.style.display = 'none';
      fetch(CONFIG_API).then(function(r) { return r.json(); }).then(function(c) {
        var next = !(c.parallelization && c.parallelization.enabled);
        return fetch(CONFIG_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parallelization: Object.assign({}, c.parallelization || {}, { enabled: next }) }) });
      }).then(function(r) {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      }).then(function(c) {
        renderConfig(c.parallelization && c.parallelization.enabled);
      }).catch(function(e) {
        errEl.textContent = 'Update failed: ' + e.message;
        errEl.style.display = 'block';
      });
    });

    fetchStatus();
    fetchConfig();
    setInterval(fetchStatus, REFRESH_MS);
  </script>
</body>
</html>`;
}

export interface CreateStatusServerResult {
  server: import('node:http').Server | null;
  close: () => Promise<void>;
}

function sendTwiML(res: Response, message: string): void {
  res
    .type('text/xml')
    .send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeTwiML(message)}</Message></Response>`,
    );
}

function registerSmsWebhookRoutes(
  app: import('express').Express,
  webhookOptions: WebhookOptions,
  logger: StatusServerOptions['logger'] | undefined,
): void {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  // If TWILIO_AUTH_TOKEN is set, twilio.webhook() will reject invalid requests (403).
  const signatureMiddleware = authToken ? twilio.webhook() : null;

  app.post(
    '/webhook/sms',
    express.urlencoded({ extended: false }),
    (req: Request, res: Response, next: (err?: unknown) => void) => {
      if (!signatureMiddleware) {
        logger?.warn(
          { env: 'TWILIO_AUTH_TOKEN', hasWebhookUrl: Boolean(process.env.TWILIO_WEBHOOK_URL) },
          'TWILIO_AUTH_TOKEN not set — skipping Twilio signature validation (dev mode)',
        );
        next();
        return;
      }

      signatureMiddleware(req, res, next);
    },
    async (req: Request, res: Response) => {
      const body = typeof req.body?.Body === 'string' ? req.body.Body.trim() : '';
      let from = typeof req.body?.From === 'string' ? req.body.From.trim() : '';
      // `application/x-www-form-urlencoded` decodes `+` as space. Twilio typically sends
      // phone numbers preserving '+' (often URL-encoded as %2B), but we defensively
      // normalize common decoding artifacts.
      from = from.replace(/\s+/g, '');
      if (from && !from.startsWith('+') && /^\d+$/.test(from)) {
        from = `+${from}`;
      }

      const pending = (await readPendingGoals(webhookOptions.workspaceRoot)).find(
        (p) => p.raw.replyTo === from,
      );

      // Conversation flow:
      // - No pending: "add <goal title>" => classify => queue (score 1-2) or create pending (score 3-5)
      // - Pending + YES: confirm => resolve pending => queue goal
      // - Pending + anything else: treat body as edited draft spec => update pending draft => ack
      const upperBody = body.toUpperCase();

      try {
        if (pending && upperBody === 'YES') {
          await resolvePendingGoal(webhookOptions.workspaceRoot, pending.id);
          await queueGoal({
            workspaceRoot: webhookOptions.workspaceRoot,
            title: pending.raw.title,
            successCriteria: [],
            replyTo: from,
          });
          sendTwiML(res, 'Queued ✓');
          return;
        }

        if (pending && upperBody !== 'YES' && body.length > 0) {
          const updated: PendingGoal = { ...pending, draftSpec: body };
          await resolvePendingGoal(webhookOptions.workspaceRoot, pending.id);
          await writePendingGoal(webhookOptions.workspaceRoot, updated);
          sendTwiML(res, 'Got it, updated');
          return;
        }

        // No pending: accept "add <title>".
        const lower = body.toLowerCase();
        let title = '';
        if (lower.startsWith('add ')) {
          title = body.slice(4).trim();
        } else if (lower.startsWith('goal ')) {
          title = body.slice(5).trim();
        } else {
          title = body;
        }

        if (!title) {
          sendTwiML(res, 'Usage: add <goal title> or reply YES to confirm');
          return;
        }

        const rawGoal = normalizeSmsInput(title, from, webhookOptions.workspaceRoot);
        const complexity = await classifyGoal(rawGoal);

        if (complexity.score <= 2) {
          await queueGoal({
            workspaceRoot: webhookOptions.workspaceRoot,
            title: rawGoal.title,
            successCriteria: [],
            replyTo: from,
          });
          sendTwiML(res, 'Queued ✓');
          return;
        }

        const action = await clarifyGoal(rawGoal, complexity, webhookOptions.workspaceRoot);
        if (action.action === 'queued') {
          await queueGoal({
            workspaceRoot: webhookOptions.workspaceRoot,
            title: rawGoal.title,
            successCriteria: [],
            replyTo: from,
          });
          sendTwiML(res, 'Queued ✓');
          return;
        }

        // Pending flow: caller can reply YES to confirm or send edited spec.
        sendTwiML(res, 'Draft received. Reply YES to confirm, or send edits.');
      } catch (err) {
        sendTwiML(res, `Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}

/**
 * Express app factory used by supertest-based webhook tests.
 * - Does not call `app.listen`.
 * - Registers only webhook endpoints needed by the test suite.
 */
export function createStatusApp(
  _getStatus: () => StatusPayload,
  options?: StatusServerOptions,
): import('express').Express {
  const app = express();
  if (options?.webhook) {
    registerSmsWebhookRoutes(app, options.webhook, options.logger);
  }
  return app;
}

/**
 * Creates and starts an Express-based HTTP server. Resolves when listening or when port is in use (non-fatal).
 * - GET /: dashboard HTML (when options are provided) or legacy JSON.
 * - GET /status: legacy JSON status (same shape as before).
 * - GET /api/status: rich dashboard JSON (agent, goal, phase/plan, state snapshot, session log window, git feed, token/cost placeholders).
 * When options are provided, / serves the dashboard and /api/status is enabled; otherwise / and /status return legacy JSON.
 * On EADDRINUSE, returns { server: null, close: no-op } and does not throw; other server errors are thrown.
 */
export async function createStatusServer(
  port: number,
  getStatus: () => StatusPayload,
  options?: StatusServerOptions,
): Promise<CreateStatusServerResult> {
  const app = express();
  const sessionLogLimit = options?.sessionLogLimit ?? 20;
  const gitFeedLimit = options?.gitFeedLimit ?? 10;
  const planningConfigPath = options?.planningConfigPath;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (planningConfigPath) {
    app.get('/api/config', async (_req: Request, res: Response) => {
      try {
        const config = await readPlanningConfig(planningConfigPath);
        res.json(config);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
    app.post('/api/config', async (req: Request, res: Response) => {
      try {
        const body = req.body as Record<string, unknown>;
        if (!body || typeof body !== 'object') {
          res.status(400).json({ error: 'Invalid JSON body' });
          return;
        }
        const current = await readPlanningConfig(planningConfigPath);
        const nextParallelization = body.parallelization;
        if (nextParallelization !== undefined) {
          if (typeof nextParallelization !== 'object' || nextParallelization === null) {
            res.status(400).json({ error: 'parallelization must be an object' });
            return;
          }
          const merged = {
            ...current.parallelization,
            ...nextParallelization,
          };
          if (merged.enabled !== undefined && typeof merged.enabled !== 'boolean') {
            res.status(400).json({ error: 'parallelization.enabled must be a boolean' });
            return;
          }
          current.parallelization = merged;
        }
        await writePlanningConfig(planningConfigPath, current);
        res.json(current);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
  }

  if (options?.webhook) {
    const wh = options.webhook;
    app.post('/api/goals', async (req: Request, res: Response) => {
      try {
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        if (!title) {
          res.status(400).json({ error: 'Missing or invalid title' });
          return;
        }
        const priority =
          typeof req.body.priority === 'number' && Number.isFinite(req.body.priority)
            ? req.body.priority
            : undefined;
        await appendPendingGoal(wh.goalsPath, title, priority);
        const goal = {
          title,
          status: 'pending' as const,
          raw: `- [ ] ${title}${priority != null ? ` [priority:${priority}]` : ''}`,
          priority,
        };
        wh.onQueueGoal(goal);
        res.json({ ok: true, title });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
    app.post('/api/todos', async (req: Request, res: Response) => {
      try {
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        if (!title) {
          res.status(400).json({ error: 'Missing or invalid title' });
          return;
        }
        const area = typeof req.body.area === 'string' ? req.body.area.trim() || 'general' : 'general';
        const filePath = await wh.addTodo(title, area);
        res.json({ ok: true, title, path: filePath });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
    app.post('/webhook/twilio', async (req: Request, res: Response) => {
      const body = typeof req.body?.Body === 'string' ? req.body.Body.trim() : '';
      const lower = body.toLowerCase();
      let reply = '';
      try {
        if (lower.startsWith('add ') || lower.startsWith('goal ')) {
          const title = body.slice(body.toLowerCase().indexOf(' ') + 1).trim();
          if (title) {
            await appendPendingGoal(wh.goalsPath, title);
            const goal = {
              title,
              status: 'pending' as const,
              raw: `- [ ] ${title}`,
            };
            wh.onQueueGoal(goal);
            reply = `Added goal: ${title}`;
          } else {
            reply = 'Usage: add <goal title> or goal <goal title>';
          }
        } else if (lower.startsWith('todo ')) {
          const title = body.slice(5).trim();
          if (title) {
            await wh.addTodo(title);
            reply = `Added todo: ${title}`;
          } else {
            reply = 'Usage: todo <task description>';
          }
        } else {
          reply =
            'Send: add <goal> | goal <goal> | todo <task>. Example: add Complete Phase 4';
        }
      } catch (err) {
        reply = `Error: ${String(err)}`;
      }
      res.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeTwiML(reply)}</Message></Response>`,
      );
    });

    registerSmsWebhookRoutes(app, wh, options.logger);
  }

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
    let systemLoad: DashboardStatusPayload['systemLoad'] = currentLoadInfo();
    if (options?.planningConfigPath) {
      try {
        const raw = await readFile(options.planningConfigPath, 'utf-8');
        const planning = JSON.parse(raw) as Record<string, unknown>;
        const maxCpu = typeof planning.maxCpuFraction === 'number' ? planning.maxCpuFraction : 0.8;
        const maxMem = typeof planning.maxMemoryFraction === 'number' ? planning.maxMemoryFraction : 0.8;
        const maxGpu = typeof planning.maxGpuFraction === 'number' ? planning.maxGpuFraction : undefined;
        systemLoad = await currentLoadInfoAsync({
          maxCpuFraction: maxCpu,
          maxMemoryFraction: maxMem,
          maxGpuFraction: maxGpu,
        });
      } catch {
        // keep sync load info
      }
    }
    const payload: DashboardStatusPayload = {
      ...legacy,
      tokens: {},
      cost: {},
      systemLoad,
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
      if (payload.currentAgentId == null && lastEntry) {
        payload.currentAgentId = lastEntry.sessionId;
      }
    }

    res.json(payload);
  });

  const server = http.createServer(app);

  const result = await new Promise<CreateStatusServerResult>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        options?.logger?.warn(
          { port },
          'Status server port in use — running without status server',
        );
        resolve({ server: null, close: async () => {} });
      } else {
        reject(err);
      }
    });
    server.listen(port, () => {
      resolve({
        server,
        close: (): Promise<void> =>
          new Promise((res, rej) => {
            server.close((e) => (e ? rej(e) : res()));
          }),
      });
    });
  });

  return result;
}
