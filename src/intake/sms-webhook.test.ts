import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ComplexityScore, PendingGoal, RawGoal } from './types.js';

vi.mock('./classifier.js', () => ({
  classifyGoal: vi.fn(),
}));

vi.mock('./goals-writer.js', () => ({
  queueGoal: vi.fn(),
  notifyQueued: vi.fn(),
}));

vi.mock('./clarifier.js', () => ({
  readPendingGoals: vi.fn(),
  resolvePendingGoal: vi.fn(),
  writePendingGoal: vi.fn(),
}));

import { classifyGoal } from './classifier.js';
import { queueGoal, notifyQueued } from './goals-writer.js';
import { readPendingGoals, resolvePendingGoal, writePendingGoal } from './clarifier.js';
import { createStatusApp } from '../status-server.js';

function mkRawGoal(overrides: Partial<RawGoal>): RawGoal {
  return {
    title: overrides.title ?? 'add dark mode',
    body: overrides.body,
    source: overrides.source ?? 'sms',
    projectPath: overrides.projectPath ?? '/proj',
    replyTo: overrides.replyTo,
    receivedAt: overrides.receivedAt ?? '1970-01-01T00:00:00.000Z',
  };
}

function mkComplexity(score: 1 | 2 | 3 | 4 | 5): ComplexityScore {
  return {
    score,
    reasoning: 'x',
    suggestedQuestions: [],
  };
}

function mkPendingGoal(replyTo: string): PendingGoal {
  return {
    id: 'pending-1',
    raw: mkRawGoal({ title: 'dark mode', replyTo, source: 'sms', projectPath: '/proj' }),
    complexity: mkComplexity(3),
    draftSpec: 'old draft',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe('intake/sms-webhook', () => {
  let workspaceRoot: string;
  const from = '+15551234567';
  const goalsPath = 'unused-goals.md';

  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'sms-webhook-'));
    vi.clearAllMocks();
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WEBHOOK_URL;
  });

  afterEach(() => {
    try {
      rmSync(workspaceRoot, { recursive: true });
    } catch {
      // ignore
    }
  });

  function mkApp() {
    const stateMdPath = join(workspaceRoot, 'STATE.md');
    const sessionLogPath = join(workspaceRoot, 'session-log.jsonl');
    return createStatusApp(
      () => ({ running: false }),
      {
        stateMdPath,
        sessionLogPath,
        workspaceRoot,
        webhook: {
          goalsPath,
          workspaceRoot,
          onQueueGoal: vi.fn(),
          getRunningTitles: () => [],
          addTodo: vi.fn().mockResolvedValue('todo-path'),
        },
        logger: logger as any,
      } as any,
    );
  }

  it('POST /webhook/sms: add <goal> with no pending goal queues (score=1)', async () => {
    (classifyGoal as any).mockResolvedValue(mkComplexity(1));
    (readPendingGoals as any).mockResolvedValue([]);

    const app = mkApp();

    const res = await request(app)
      .post('/webhook/sms')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`Body=add dark mode&From=${from}`);

    expect(res.status).toBe(200);
    expect(res.type).toContain('text/xml');
    expect(res.text).toContain('<Response><Message>Queued ✓</Message></Response>');

    expect(classifyGoal).toHaveBeenCalled();
    expect(queueGoal).toHaveBeenCalled();
  });

  it('POST /webhook/sms: YES confirms pending and queues (with resolvePendingGoal)', async () => {
    (readPendingGoals as any).mockResolvedValue([mkPendingGoal(from)]);
    (classifyGoal as any).mockResolvedValue(mkComplexity(3));

    const app = mkApp();

    const res = await request(app)
      .post('/webhook/sms')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`Body=YES&From=${from}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response><Message>Queued ✓</Message></Response>');
    expect(resolvePendingGoal).toHaveBeenCalled();
    expect(queueGoal).toHaveBeenCalled();
  });

  it('POST /webhook/sms: edit draftSpec updates pending and returns “Got it, updated”', async () => {
    (readPendingGoals as any).mockResolvedValue([mkPendingGoal(from)]);

    const app = mkApp();

    const res = await request(app)
      .post('/webhook/sms')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`Body=actually make it only for the settings page&From=${from}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Got it, updated');
    expect(queueGoal).not.toHaveBeenCalled();
    expect(writePendingGoal).toHaveBeenCalled();
  });

  it('Missing TWILIO_AUTH_TOKEN env var proceeds with a logged warning', async () => {
    (classifyGoal as any).mockResolvedValue(mkComplexity(1));
    (readPendingGoals as any).mockResolvedValue([]);

    const app = mkApp();

    const res = await request(app)
      .post('/webhook/sms')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`Body=add dark mode&From=${from}`);

    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('Invalid Twilio signature returns 403 when TWILIO_AUTH_TOKEN is set', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_WEBHOOK_URL = 'http://localhost/webhook/sms';
    (readPendingGoals as any).mockResolvedValue([]);
    (classifyGoal as any).mockResolvedValue(mkComplexity(1));

    const app = mkApp();

    const res = await request(app)
      .post('/webhook/sms')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('X-Twilio-Signature', 'invalid')
      .send(`Body=add dark mode&From=${from}`);

    expect(res.status).toBe(403);
  });
});

