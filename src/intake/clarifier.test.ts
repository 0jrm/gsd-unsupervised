import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComplexityScore, PendingGoal } from './clarifier.js';
import type { RawGoal } from './types.js';

vi.mock('../agent-runner.js', () => ({
  runAgent: vi.fn(),
}));

import { clarifyGoal, readPendingGoals, resolvePendingGoal, expirePendingGoals } from './clarifier.js';
import { runAgent } from '../agent-runner.js';

function mkRawGoal(overrides: Partial<RawGoal>): RawGoal {
  return {
    title: overrides.title ?? 'Untitled',
    body: overrides.body,
    source: overrides.source ?? 'cli',
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

function pendingFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.gsd', 'pending-goals.json');
}

describe('intake/clarifier', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRoot = mkdtempSync(join(tmpdir(), 'clarifier-'));
  });

  it('Score 1-2: passthrough queued without API call or file write', async () => {
    const rawGoal = mkRawGoal({ title: 'fix typo', projectPath: workspaceRoot });
    const runAgentMock = runAgent as any;

    const res1 = await clarifyGoal(rawGoal, mkComplexity(1), workspaceRoot);
    expect(res1).toEqual({ action: 'queued' });
    expect(runAgentMock.mock.calls.length).toBe(0);
    expect(existsSync(pendingFilePath(workspaceRoot))).toBe(false);

    // The file should not exist when score is queued.
    await expect(readPendingGoals(workspaceRoot)).resolves.toEqual([]);

    const res2 = await clarifyGoal(rawGoal, mkComplexity(2), workspaceRoot);
    expect(res2).toEqual({ action: 'queued' });
  });

  it('Score 3: creates pending goal from cursor-agent output', async () => {
    const rawGoal = mkRawGoal({ title: 'add dark mode', projectPath: workspaceRoot });
    const complexity = mkComplexity(3);

    (runAgent as any).mockResolvedValue({
      success: true,
      output: JSON.stringify({
        draftSpec: 'Enable dark mode across the UI and ensure it persists in settings.',
        questions: ['Which screens should support dark mode?'],
      }),
    });

    const res = await clarifyGoal(rawGoal, complexity, workspaceRoot);
    expect(res).toEqual({
      action: 'pending',
      draftSpec: 'Enable dark mode across the UI and ensure it persists in settings.',
      questions: ['Which screens should support dark mode?'],
    });

    const raw = readFileSync(pendingFilePath(workspaceRoot), 'utf-8');
    const parsed = JSON.parse(raw) as PendingGoal[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);

    const pending = parsed[0]!;
    expect(typeof pending.id).toBe('string');
    expect(pending.raw.title).toBe('add dark mode');
    expect(pending.complexity.score).toBe(3);
    expect(pending.draftSpec).toBe(res.draftSpec);
    expect(Number.isNaN(new Date(pending.expiresAt).getTime())).toBe(false);
  });

  it('Score 5: creates pending goal with more questions', async () => {
    const rawGoal = mkRawGoal({ title: 'new dashboard skeleton', projectPath: workspaceRoot });
    const complexity = mkComplexity(5);

    (runAgent as any).mockResolvedValue({
      success: true,
      output: JSON.stringify({
        draftSpec: 'Create a new dashboard skeleton with routes, layout, and basic widgets.',
        questions: ['What sections should be included?', 'Any style preferences?'],
      }),
    });

    const res = await clarifyGoal(rawGoal, complexity, workspaceRoot);
    expect(res.action).toBe('pending');
    expect(res.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('readPendingGoals returns [] when file missing', async () => {
    const pending = await readPendingGoals(workspaceRoot);
    expect(pending).toEqual([]);
  });

  it('resolvePendingGoal removes the entry by id', async () => {
    mkdirSync(join(workspaceRoot, '.gsd'), { recursive: true });
    const goalA: PendingGoal = {
      id: 'A',
      raw: mkRawGoal({ projectPath: workspaceRoot, title: 'A' }),
      complexity: mkComplexity(3),
      draftSpec: 'spec A',
      expiresAt: new Date(Date.now() + 1000_000).toISOString(),
    };
    const goalB: PendingGoal = {
      id: 'B',
      raw: mkRawGoal({ projectPath: workspaceRoot, title: 'B' }),
      complexity: mkComplexity(3),
      draftSpec: 'spec B',
      expiresAt: new Date(Date.now() + 1000_000).toISOString(),
    };
    writeFileSync(pendingFilePath(workspaceRoot), JSON.stringify([goalA, goalB]), 'utf-8');

    await resolvePendingGoal(workspaceRoot, 'A');
    const after = await readPendingGoals(workspaceRoot);
    expect(after.map((p) => p.id)).toEqual(['B']);
  });

  it('expirePendingGoals removes entries where expiresAt is in the past', async () => {
    mkdirSync(join(workspaceRoot, '.gsd'), { recursive: true });
    const goalA: PendingGoal = {
      id: 'A',
      raw: mkRawGoal({ projectPath: workspaceRoot, title: 'A' }),
      complexity: mkComplexity(3),
      draftSpec: 'spec A',
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
    };
    const goalB: PendingGoal = {
      id: 'B',
      raw: mkRawGoal({ projectPath: workspaceRoot, title: 'B' }),
      complexity: mkComplexity(3),
      draftSpec: 'spec B',
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    };
    writeFileSync(pendingFilePath(workspaceRoot), JSON.stringify([goalA, goalB]), 'utf-8');

    await expirePendingGoals(workspaceRoot);
    const after = await readPendingGoals(workspaceRoot);
    expect(after.map((p) => p.id)).toEqual(['B']);
  });

  afterEach(() => {
    try {
      rmSync(workspaceRoot, { recursive: true });
    } catch {
      // ignore
    }
  });
});

