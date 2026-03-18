/**
 * Daemon goals hot-reload and expirePendingGoals behavior.
 * - Watches .gsd/goals-updated; on change re-parses goals.md and merges new goals.
 * - Calls expirePendingGoals at startup and hourly.
 * - Does not re-queue already-running or already-completed goals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDaemon } from '../src/daemon.js';
import { initLogger } from '../src/logger.js';

const orchestrateResolvers: Array<() => void> = [];
vi.mock('../src/orchestrator.js', () => ({
  orchestrateGoal: vi.fn(() => new Promise<void>((r) => orchestrateResolvers.push(r))),
}));

const expirePendingGoalsSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/intake/clarifier.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/intake/clarifier.js')>();
  return {
    ...mod,
    expirePendingGoals: (...args: unknown[]) => {
      expirePendingGoalsSpy(...args);
      return mod.expirePendingGoals(...(args as [string]));
    },
  };
});

// Use real chokidar so writing .gsd/goals-updated actually fires the change handler.
// No chokidar mock.

describe('daemon goals reload', () => {
  let workspace: string;
  let goalsPath: string;

  function mkConfig(overrides?: Record<string, unknown>) {
    return {
      goalsPath,
      parallel: false,
      maxConcurrent: 3,
      verbose: false,
      logLevel: 'info' as const,
      workspaceRoot: workspace,
      agent: 'cursor' as const,
      cursorAgentPath: 'cursor-agent',
      agentTimeoutMs: 60_000,
      sessionLogPath: join(workspace, 'session-log.jsonl'),
      stateWatchDebounceMs: 500,
      requireCleanGitBeforePlan: false,
      autoCheckpoint: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'daemon-reload-'));
    goalsPath = join(workspace, 'goals.md');
    mkdirSync(join(workspace, '.planning'), { recursive: true });
    mkdirSync(join(workspace, '.gsd'), { recursive: true });
    writeFileSync(join(workspace, '.gsd', 'goals-updated'), 'initial\n', 'utf-8');
    writeFileSync(
      goalsPath,
      '## Pending\n- [ ] First goal\n\n## In Progress\n\n## Done\n',
      'utf-8',
    );
    writeFileSync(
      join(workspace, '.planning', 'ROADMAP.md'),
      '- [ ] **Phase 1: Test** — Minimal phase\n',
      'utf-8',
    );
    writeFileSync(
      join(workspace, '.planning', 'STATE.md'),
      '## Current Position\nPhase: 1 of 1\nPlan: 0 of 0\nStatus: Ready\n',
      'utf-8',
    );
    orchestrateResolvers.length = 0;
    expirePendingGoalsSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(workspace, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('reloads goals when .gsd/goals-updated changes and enqueues new pending goals', async () => {
    const orchestrateCalls: string[] = [];
    const { orchestrateGoal } = await import('../src/orchestrator.js');
    vi.mocked(orchestrateGoal).mockImplementation(async (opts) => {
      orchestrateCalls.push(opts.goal.title);
      return new Promise<void>((r) => orchestrateResolvers.push(r));
    });

    const logger = initLogger({ level: 'silent', pretty: false });
    const config = { ...mkConfig(), goalsReloadDebounceMs: 0 };

    const daemonPromise = runDaemon(config, logger);

    // Wait for daemon to set up watcher and start processing first goal
    await new Promise((r) => setTimeout(r, 100));

    writeFileSync(
      goalsPath,
      '## Pending\n- [ ] First goal\n- [ ] Second goal\n\n## In Progress\n\n## Done\n',
      'utf-8',
    );
    // Touch .gsd/goals-updated to trigger real chokidar change event
    writeFileSync(join(workspace, '.gsd', 'goals-updated'), `updated:${Date.now()}\n`, 'utf-8');
    // With goalsReloadDebounceMs: 0, handler schedules setImmediate(doReload).
    // Allow chokidar to fire and doReload to complete.
    await new Promise((r) => setTimeout(r, 200));

    orchestrateResolvers[0]?.();
    for (let i = 0; i < 100 && orchestrateResolvers.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(orchestrateCalls).toContain('First goal');
    expect(orchestrateCalls).toContain('Second goal');

    orchestrateResolvers.forEach((r) => r());
    await daemonPromise;
  });

  it('calls expirePendingGoals once at daemon startup', async () => {
    const logger = initLogger({ level: 'silent', pretty: false });
    const config = mkConfig();

    const daemonPromise = runDaemon(config, logger);
    await new Promise((r) => setTimeout(r, 50));

    expect(expirePendingGoalsSpy).toHaveBeenCalledWith(workspace);
    expect(expirePendingGoalsSpy).toHaveBeenCalledTimes(1);

    orchestrateResolvers[0]?.();
    await daemonPromise;
  });

  it('does not re-queue already-running or already-completed goals on file change', async () => {
    const orchestrateCalls: string[] = [];
    const { orchestrateGoal } = await import('../src/orchestrator.js');
    vi.mocked(orchestrateGoal).mockImplementation(async (opts) => {
      orchestrateCalls.push(opts.goal.title);
      // Keep first goal "running" until we emit change, then resolve
      await new Promise<void>((r) => setTimeout(r, 200));
    });

    const logger = initLogger({ level: 'silent', pretty: false });
    const config = mkConfig();

    const daemonPromise = runDaemon(config, logger);
    await new Promise((r) => setTimeout(r, 100));

    // While first goal is running, touch .gsd/goals-updated — addToQueue should skip (running.has)
    writeFileSync(join(workspace, '.gsd', 'goals-updated'), `updated:${Date.now()}\n`, 'utf-8');
    await new Promise((r) => setTimeout(r, 600));

    // orchestrateGoal should be called exactly once; change handler ran but did not re-queue
    expect(orchestrateCalls).toEqual(['First goal']);

    await daemonPromise;
  });
});
