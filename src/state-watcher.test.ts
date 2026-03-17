import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from './logger.js';
import { StateWatcher } from './state-watcher.js';

function createTestLogger(): Logger {
  // Minimal logger implementation for tests
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noop = (..._args: any[]) => {};
  return {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    child: () => createTestLogger(),
    level: 'info',
  } as unknown as Logger;
}

async function waitForEvent<TPayload>(
  watcher: StateWatcher,
  type: string,
  timeoutMs = 500,
): Promise<TPayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.removeListener(type, onEvent as (...args: unknown[]) => void);
      reject(new Error(`Timed out waiting for ${type} event`));
    }, timeoutMs);

    const onEvent = (payload: TPayload) => {
      clearTimeout(timer);
      watcher.removeListener(type, onEvent as (...args: unknown[]) => void);
      resolve(payload);
    };

    watcher.on(type, onEvent as (...args: unknown[]) => void);
  });
}

describe('StateWatcher', () => {
  let tempDir: string;
  let statePath: string;
  let watcher: StateWatcher | null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'state-watcher-'));
    statePath = join(tempDir, 'STATE.md');
    watcher = null;
  });

  afterEach(() => {
    if (watcher) {
      watcher.stop();
      watcher = null;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeState(content: string): void {
    writeFileSync(statePath, content, 'utf-8');
  }

  function createWatcher(): StateWatcher {
    const logger = createTestLogger();
    const w = new StateWatcher({
      stateMdPath: statePath,
      debounceMs: 20,
      logger,
    });
    w.start();
    return w;
  }

  function buildStateBlock(options: {
    phaseNumber: number;
    totalPhases: number;
    phaseName: string;
    planNumber: number;
    totalPlans: number;
    status: string;
    lastActivity?: string;
    progressPercent?: number | null;
  }): string {
    const {
      phaseNumber,
      totalPhases,
      phaseName,
      planNumber,
      totalPlans,
      status,
      lastActivity = new Date().toISOString(),
      progressPercent,
    } = options;

    const lines: string[] = [];
    lines.push('## Current Position', '');
    lines.push(`Phase: ${phaseNumber} of ${totalPhases} (${phaseName})`);
    lines.push(`Plan: ${planNumber} of ${totalPlans} in current phase`);
    lines.push(`Status: ${status}`);
    lines.push(`Last activity: ${lastActivity}`, '');
    if (typeof progressPercent === 'number') {
      const filled = Math.round(progressPercent / 10);
      const empty = 10 - filled;
      lines.push(
        `Progress: ${'█'.repeat(filled)}${'░'.repeat(empty)} ${progressPercent}%`,
      );
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  it('emits ready once on first successful parse and state_changed for each change', async () => {
    writeState(
      buildStateBlock({
        phaseNumber: 4,
        totalPhases: 7,
        phaseName: 'State Monitoring & Phase Transitions',
        planNumber: 0,
        totalPlans: 2,
        status: 'Planned phase 4',
        progressPercent: null,
      }),
    );

    watcher = createWatcher();

    const ready = await waitForEvent<{ phaseNumber: number; planNumber: number }>(
      watcher,
      'ready',
    );
    expect(ready.phaseNumber).toBe(4);
    expect(ready.planNumber).toBe(0);

    const events: Array<{
      previous: unknown;
      current: { phaseNumber: number; planNumber: number };
    }> = [];
    watcher.on('state_changed', (payload) => {
      events.push(payload);
    });

    writeState(
      buildStateBlock({
        phaseNumber: 4,
        totalPhases: 7,
        phaseName: 'State Monitoring & Phase Transitions',
        planNumber: 1,
        totalPlans: 2,
        status: 'Executing plan',
        progressPercent: 55,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1]!;
    expect(last.previous).not.toBeNull();
    expect(last.current.phaseNumber).toBe(4);
    expect(last.current.planNumber).toBe(1);
  });

  it('emits plan_advanced when plan number increases within same phase', async () => {
    writeState(
      buildStateBlock({
        phaseNumber: 4,
        totalPhases: 7,
        phaseName: 'State Monitoring & Phase Transitions',
        planNumber: 0,
        totalPlans: 2,
        status: 'Planned phase 4',
        progressPercent: null,
      }),
    );

    watcher = createWatcher();
    await waitForEvent(watcher, 'ready');

    writeState(
      buildStateBlock({
        phaseNumber: 4,
        totalPhases: 7,
        phaseName: 'State Monitoring & Phase Transitions',
        planNumber: 1,
        totalPlans: 2,
        status: 'Executing plan',
        progressPercent: 50,
      }),
    );

    const advanced = await waitForEvent<{
      phaseNumber: number;
      fromPlan: number;
      toPlan: number;
    }>(watcher, 'plan_advanced');
    expect(advanced.phaseNumber).toBe(4);
    expect(advanced.fromPlan).toBe(0);
    expect(advanced.toPlan).toBe(1);
  });

  // Note: Additional behaviors such as phase_completed and goal_completed are
  // exercised indirectly via higher-level daemon/orchestrator tests that use
  // a real StateWatcher instance against a live STATE.md.
});

