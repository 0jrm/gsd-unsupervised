import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';

vi.mock('./classifier.js', () => ({
  classifyGoal: vi.fn(),
}));
vi.mock('./clarifier.js', () => ({
  clarifyGoal: vi.fn(),
}));
vi.mock('./goals-writer.js', () => ({
  queueGoal: vi.fn(),
  notifyQueued: vi.fn(),
}));
vi.mock('../init-wizard.js', () => ({
  runInit: vi.fn(),
}));

import { classifyGoal } from './classifier.js';
import { clarifyGoal } from './clarifier.js';
import { queueGoal } from './goals-writer.js';
import { runInit } from '../init-wizard.js';

vi.mock('node:fs/promises', () => {
  return {
    mkdir: vi.fn(),
  };
});

vi.mock('node:child_process', () => {
  return {
    execFile: vi.fn(),
    spawn: vi.fn(),
  };
});

import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';

function captureConsole() {
  const out: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => out.push(args.join(' ')));
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => out.push(args.join(' ')));
  return { out, logSpy, warnSpy };
}

describe('intake/CLI add-goal and new-project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default successful execFile: immediately invoke callback.
    (execFile as any).mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      if (typeof cb === 'function') cb(null, { stdout: '' });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('add-goal "fix auth bug" (score=1): queues immediately and prints Queued', async () => {
    const { addGoalCommand } = await import('./cli-commands.js');
    (classifyGoal as any).mockResolvedValue({ score: 1, reasoning: '', suggestedQuestions: [] });
    (clarifyGoal as any).mockResolvedValue({ action: 'queued' });
    (queueGoal as any).mockResolvedValue(undefined);

    const cap = captureConsole();

    await addGoalCommand({
      title: 'fix auth bug',
      projectPath: '/proj',
      body: undefined,
      replyTo: undefined,
    });

    expect(queueGoal).toHaveBeenCalledTimes(1);
    expect(cap.out.join('\n')).toContain('Queued: fix auth bug');
  });

  it('add-goal "fix auth bug" (score=3 pending): prints draft spec and question, consumes YES from stdin', async () => {
    const { addGoalCommand } = await import('./cli-commands.js');
    (classifyGoal as any).mockResolvedValue({ score: 3, reasoning: '', suggestedQuestions: ['q'] });
    (clarifyGoal as any).mockResolvedValue({
      action: 'pending',
      draftSpec: 'Draft spec...',
      questions: ['Q?'],
    });
    (queueGoal as any).mockResolvedValue(undefined);

    const cap = captureConsole();

    // Provide YES for the confirmation prompt.
    const stdin = new PassThrough();
    stdin.end('YES\n');

    await addGoalCommand(
      {
        title: 'fix auth bug',
        projectPath: '/proj',
        body: undefined,
        replyTo: undefined,
      },
      { stdin: stdin as any },
    );

    const combined = cap.out.join('\n');
    expect(combined).toContain('Draft spec...');
    expect(combined).toContain('Q?');
  });

  it('new-project: creates folder, inits git, runs init, queues first goal', async () => {
    const { newProjectCommand } = await import('./cli-commands.js');
    (queueGoal as any).mockResolvedValue(undefined);
    (runInit as any).mockResolvedValue(undefined);

    const cap = captureConsole();

    const stdin = new PassThrough();
    // Project name, parent dir, first goal, create github? (n)
    stdin.end(['testproj', '/tmp/projects', 'First goal', 'n'].join('\n') + '\n');

    await newProjectCommand({ stdin: stdin as any });

    expect(mkdir).toHaveBeenCalled();
    // Expect git init and runInit wired to computed project path.
    expect((execFile as any).mock.calls.some((c: any[]) => c[0] === 'git' && c[1]?.[0] === 'init')).toBe(true);
    expect(runInit).toHaveBeenCalled();
    expect(queueGoal).toHaveBeenCalledWith(expect.objectContaining({ title: 'First goal' }));

    expect(cap.out.join('\n')).not.toContain('GitHub being skipped');
  });

  it('new-project with gh unavailable: succeeds and logs GitHub being skipped warning', async () => {
    const { newProjectCommand } = await import('./cli-commands.js');
    (queueGoal as any).mockResolvedValue(undefined);
    (runInit as any).mockResolvedValue(undefined);

    // Mock `which gh` to fail.
    (execFile as any).mockImplementation((cmd: string, args: string[], optsOrCb: any, maybeCb?: any) => {
      const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
      if (cmd === 'which' && args[0] === 'gh') {
        cb(new Error('not found'));
        return;
      }
      cb(null, { stdout: '' });
    });

    const cap = captureConsole();

    const stdin = new PassThrough();
    stdin.end(['testproj', '/tmp/projects', 'First goal', 'y'].join('\n') + '\n');

    await newProjectCommand({ stdin: stdin as any });

    expect(runInit).toHaveBeenCalled();
    expect(queueGoal).toHaveBeenCalledWith(expect.objectContaining({ title: 'First goal' }));
    expect(cap.out.join('\n')).toContain('GitHub repo creation skipped');
  });
});

