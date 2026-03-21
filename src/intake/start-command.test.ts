import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./clarifier.js', () => ({
  classifyGoal: vi.fn(),
  clarifyGoal: vi.fn(),
}));
vi.mock('./goals-writer.js', () => ({
  queueGoal: vi.fn(),
}));
vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  initLogger: vi.fn(() => ({ child: () => ({}) })),
}));

import { classifyGoal, clarifyGoal } from './clarifier.js';
import { queueGoal } from './goals-writer.js';
import { loadConfig } from '../config.js';

function captureConsole() {
  const out: string[] = [];
  const warn: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => out.push(args.join(' ')));
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => warn.push(args.join(' ')));
  return { out, warn, logSpy, warnSpy };
}

describe('intake/start-command', () => {
  let workspace: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspace = mkdtempSync(join(tmpdir(), 'start-command-'));
    (loadConfig as any).mockReturnValue({ agent: 'cursor', workspaceRoot: workspace });
    (classifyGoal as any).mockResolvedValue({ score: 1, reasoning: 'tiny fix', suggestedQuestions: [] });
    (clarifyGoal as any).mockResolvedValue({ action: 'queued' });
    (queueGoal as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('queues a goal and exits update-only when the daemon is already healthy', async () => {
    const { startCommand } = await import('./start-command.js');
    const cap = captureConsole();

    const result = await startCommand(
      {
        projectPath: workspace,
        title: 'Add intake mode',
        body: 'More details here',
      },
      {},
      {
        syncFn: vi.fn().mockResolvedValue({
          manifest: {
            repoUrl: 'https://github.com/gsd-build/get-shit-done.git',
            repoSha: 'abc123',
            syncedAt: '2026-03-20T10:00:00.000Z',
            runtimes: { cursor: { installedSkills: [] }, codex: { installedSkills: [] } },
          },
          changed: true,
          cacheDir: `${workspace}/.gsd/upstream/get-shit-done`,
        }),
        createBundleFn: vi.fn().mockResolvedValue({
          manifest: {
            paths: {
              bundleDir: '.planning/intake/20260320-intake',
              sessionContext: '.planning/intake/20260320-intake/SESSION-CONTEXT.md',
              agentBrief: '.planning/intake/20260320-intake/AGENT-BRIEF.md',
            },
          },
        }),
        healthFn: vi.fn().mockResolvedValue({
          running: true,
          reason: 'healthy',
          statePath: `${workspace}/.gsd/state.json`,
          daemonPid: 12345,
          lastHeartbeat: '2026-03-20T10:00:00.000Z',
        }),
      },
    );

    expect(queueGoal).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Add intake mode',
      route: 'quick',
      contextBundlePath: '.planning/intake/20260320-intake',
    }));
    expect(result.daemonAction).toBe('already-running');
    expect(cap.out.join('\n')).toContain('Daemon already running');
  });

  it('offers update-and-run when daemon is not running and launches when user types RUN', async () => {
    const { startCommand } = await import('./start-command.js');
    const cap = captureConsole();
    const stdin = new PassThrough();
    stdin.end('RUN\n');
    const launchDaemonFn = vi.fn().mockResolvedValue(undefined);
    mkdirSync(join(workspace, '.gsd'), { recursive: true });
    writeFileSync(
      join(workspace, '.gsd', 'state.json'),
      JSON.stringify({
        mode: 'self',
        project: 'gsd-unsupervised',
        workspaceRoot: workspace,
        goalsPath: './goals.md',
      }),
      'utf-8',
    );

    const result = await startCommand(
      {
        projectPath: workspace,
        title: 'Build start wrapper',
        body: '',
      },
      { stdin: stdin as any },
      {
        syncFn: vi.fn().mockResolvedValue({
          manifest: {
            repoUrl: 'https://github.com/gsd-build/get-shit-done.git',
            repoSha: 'abc123',
            syncedAt: '2026-03-20T10:00:00.000Z',
            runtimes: { cursor: { installedSkills: [] }, codex: { installedSkills: [] } },
          },
          changed: true,
          cacheDir: `${workspace}/.gsd/upstream/get-shit-done`,
        }),
        createBundleFn: vi.fn().mockResolvedValue({
          manifest: {
            paths: {
              bundleDir: '.planning/intake/20260320-intake',
              sessionContext: '.planning/intake/20260320-intake/SESSION-CONTEXT.md',
              agentBrief: '.planning/intake/20260320-intake/AGENT-BRIEF.md',
            },
          },
        }),
        healthFn: vi.fn().mockResolvedValue({
          running: false,
          reason: 'missing-heartbeat',
          statePath: `${workspace}/.gsd/state.json`,
        }),
        launchDaemonFn,
      },
    );

    expect(launchDaemonFn).toHaveBeenCalledWith(workspace);
    expect(result.daemonAction).toBe('update-and-run');
    expect(cap.out.join('\n')).toContain('Starting daemon...');
  });

  it('warns when the configured agent is cn', async () => {
    const { startCommand } = await import('./start-command.js');
    const cap = captureConsole();
    (loadConfig as any).mockReturnValue({ agent: 'cn', workspaceRoot: workspace });

    await startCommand(
      {
        projectPath: workspace,
        title: 'Queue goal only',
        body: '',
        updateOnly: true,
      },
      {},
      {
        syncFn: vi.fn().mockResolvedValue({
          manifest: {
            repoUrl: 'https://github.com/gsd-build/get-shit-done.git',
            repoSha: 'abc123',
            syncedAt: '2026-03-20T10:00:00.000Z',
            runtimes: { cursor: { installedSkills: [] }, codex: { installedSkills: [] } },
          },
          changed: true,
          cacheDir: `${workspace}/.gsd/upstream/get-shit-done`,
        }),
        createBundleFn: vi.fn().mockResolvedValue({
          manifest: {
            paths: {
              bundleDir: '.planning/intake/20260320-intake',
              sessionContext: '.planning/intake/20260320-intake/SESSION-CONTEXT.md',
              agentBrief: '.planning/intake/20260320-intake/AGENT-BRIEF.md',
            },
          },
        }),
        healthFn: vi.fn().mockResolvedValue({
          running: false,
          reason: 'missing-state',
          statePath: `${workspace}/.gsd/state.json`,
        }),
      },
    );

    expect(cap.warn.join('\n')).toContain("only guaranteed for 'cursor' and 'codex'");
  });
});
