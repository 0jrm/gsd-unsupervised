import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PendingGoal } from './clarifier.js';

vi.mock('./clarifier.js', () => ({
  classifyGoal: vi.fn(),
  clarifyGoal: vi.fn(),
  readPendingGoals: vi.fn(),
  resolvePendingGoal: vi.fn(),
  writePendingGoal: vi.fn(),
}));

vi.mock('./goals-writer.js', () => ({
  queueGoal: vi.fn(),
  notifyQueued: vi.fn(),
}));

import {
  classifyGoal,
  clarifyGoal,
  readPendingGoals,
  resolvePendingGoal,
  writePendingGoal,
} from './clarifier.js';
import { queueGoal } from './goals-writer.js';
import { createStatusApp } from '../status-server.js';

describe('intake/dashboard intake', () => {
  let workspaceRoot: string;
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'dashboard-intake-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function mkPending(id: string): PendingGoal {
    return {
      id,
      raw: {
        title: 'add auth system',
        source: 'dashboard',
        projectPath: workspaceRoot,
        replyTo: undefined,
        receivedAt: new Date().toISOString(),
        body: undefined,
      },
      complexity: { score: 4, reasoning: 'x', suggestedQuestions: [] },
      draftSpec: 'old draft',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  function mkApp(opts?: { dashboardAuthToken?: string }) {
    const stateMdPath = join(workspaceRoot, 'STATE.md');
    const sessionLogPath = join(workspaceRoot, 'session-log.jsonl');
    const goalsPath = join(workspaceRoot, 'goals.md');
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
          addTodo: vi.fn(),
        },
        dashboardAuthToken: opts?.dashboardAuthToken,
        logger: logger as any,
      } as any,
    );
  }

  it('POST /api/goals/intake (score=1): queues and returns {status:queued,title}', async () => {
    (readPendingGoals as any).mockResolvedValue([]);
    (classifyGoal as any).mockResolvedValue({
      score: 1,
      reasoning: 'x',
      suggestedQuestions: [],
    });

    const app = mkApp();
    const res = await request(app)
      .post('/api/goals/intake')
      .send({ title: 'fix typo', body: '' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'queued', title: 'fix typo' });
    expect(queueGoal).toHaveBeenCalled();
  });

  it('POST /api/goals/intake (score=4): returns {status:pending,id,draftSpec,questions}', async () => {
    (readPendingGoals as any).mockResolvedValue([]);
    (classifyGoal as any).mockResolvedValue({
      score: 4,
      reasoning: 'x',
      suggestedQuestions: [],
    });

    (clarifyGoal as any).mockResolvedValue({
      action: 'pending',
      draftSpec: 'new draft spec',
      questions: ['q1', 'q2'],
    });

    (readPendingGoals as any).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        ...mkPending('pending-1'),
        draftSpec: 'new draft spec',
      }]);

    const app = mkApp();
    const res = await request(app)
      .post('/api/goals/intake')
      .send({ title: 'add auth system' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toBe('pending-1');
    expect(res.body.draftSpec).toBe('new draft spec');
    expect(res.body.questions).toEqual(['q1', 'q2']);
  });

  it('POST /api/goals/confirm (confirmed=true): resolves and queues', async () => {
    (readPendingGoals as any).mockResolvedValue([mkPending('pending-1')]);
    (resolvePendingGoal as any).mockResolvedValue(undefined);
    (queueGoal as any).mockResolvedValue(undefined);

    const app = mkApp();
    const res = await request(app)
      .post('/api/goals/confirm')
      .send({ id: 'pending-1', confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'queued' });
    expect(resolvePendingGoal).toHaveBeenCalledWith(workspaceRoot, 'pending-1');
    expect(queueGoal).toHaveBeenCalled();
  });

  it('POST /api/goals/confirm (unknown id): returns 404', async () => {
    (readPendingGoals as any).mockResolvedValue([]);
    const app = mkApp();
    const res = await request(app)
      .post('/api/goals/confirm')
      .send({ id: 'unknown', confirmed: true });

    expect(res.status).toBe(404);
  });

  it('POST /api/goals/confirm (editedSpec): updates pending draft and returns pending', async () => {
    (readPendingGoals as any).mockResolvedValue([mkPending('pending-1')]);
    (resolvePendingGoal as any).mockResolvedValue(undefined);
    (writePendingGoal as any).mockResolvedValue(undefined);

    const app = mkApp();
    const res = await request(app)
      .post('/api/goals/confirm')
      .send({ id: 'pending-1', editedSpec: 'new spec text' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pending', draftSpec: 'new spec text' });
    expect(writePendingGoal).toHaveBeenCalled();
  });

  it('POST /api/goals/intake with dashboardAuthToken: 401 without token, 200 with valid token', async () => {
    (readPendingGoals as any).mockResolvedValue([]);
    (classifyGoal as any).mockResolvedValue({ score: 1, reasoning: 'x', suggestedQuestions: [] });

    const app = mkApp({ dashboardAuthToken: 'secret123' });

    const noAuth = await request(app).post('/api/goals/intake').send({ title: 'fix typo' });
    expect(noAuth.status).toBe(401);
    expect(noAuth.body.error).toContain('token');

    const withAuth = await request(app)
      .post('/api/goals/intake')
      .set('Authorization', 'Bearer secret123')
      .send({ title: 'fix typo' });
    expect(withAuth.status).toBe(200);
    expect(withAuth.body).toEqual({ status: 'queued', title: 'fix typo' });
  });
});

