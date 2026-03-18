import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawGoal } from './types.js';
import type { ComplexityScore } from './types.js';

vi.mock('../agent-runner.js', () => ({
  runAgent: vi.fn(),
}));

import { classifyGoal } from './classifier.js';
import { runAgent } from '../agent-runner.js';

function mkGoal(overrides: Partial<RawGoal>): RawGoal {
  return {
    title: overrides.title ?? 'Untitled',
    source: overrides.source ?? 'cli',
    projectPath: overrides.projectPath ?? '/p',
    receivedAt: overrides.receivedAt ?? '1970-01-01T00:00:00.000Z',
    body: overrides.body,
    replyTo: overrides.replyTo,
  };
}

describe('intake/classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Score 1: short, no scope keywords, no file references', async () => {
    const goal = mkGoal({ title: 'fix typo in readme', body: undefined });
    await expect(classifyGoal(goal)).resolves.toMatchObject<ComplexityScore>({ score: 1 });
  });

  it('Score 2: title contains a single filename', async () => {
    const goal = mkGoal({ title: 'fix bug in src/auth.ts' });
    await expect(classifyGoal(goal)).resolves.toMatchObject<ComplexityScore>({ score: 2 });
  });

  it('Score 4: refactor entire auth system', async () => {
    const goal = mkGoal({ title: 'refactor entire auth system' });
    await expect(classifyGoal(goal)).resolves.toMatchObject<ComplexityScore>({ score: 4 });
  });

  it('Score 5: new project from scratch', async () => {
    const goal = mkGoal({ title: 'new project from scratch' });
    await expect(classifyGoal(goal)).resolves.toMatchObject<ComplexityScore>({ score: 5 });
  });

  it('Score 3: spawns cursor-agent for ambiguous goal titles', async () => {
    const goal = mkGoal({ title: 'add dark mode to dashboard' });

    (runAgent as any).mockResolvedValue({
      success: true,
      output:
        '{"score":3,"reasoning":"moderate scope","suggestedQuestions":["Which components need dark mode?"]}',
    });

    const res = await classifyGoal(goal);

    const calls = (runAgent as any).mock.calls as any[][];
    expect(calls.length).toBe(1);
    const opts = calls[0]?.[0] as any;
    expect(String(opts?.prompt ?? '')).toContain(goal.title);

    expect(res.score).toBe(3);
    expect(res.reasoning).toBe('moderate scope');
    expect(res.suggestedQuestions).toEqual(['Which components need dark mode?']);
  });

  it('Score 3: cursor-agent failure fallback', async () => {
    const goal = mkGoal({ title: 'add dark mode to dashboard' });

    (runAgent as any).mockResolvedValue({
      success: false,
      error: 'nope',
    });

    await expect(classifyGoal(goal)).resolves.toEqual({
      score: 3,
      reasoning: 'classifier unavailable',
      suggestedQuestions: [],
    });
  });
});

