import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initLogger } from '../src/logger.js';
import { reportProgress } from '../src/orchestrator.js';

function writeStateMd(filePath: string, phaseNumber: number) {
  const content = [
    '# STATE',
    '',
    '## Current Position',
    '',
    `Phase: ${phaseNumber} of 7 (State Monitoring & Phase Transitions)`,
    'Plan: 1 of 2 in current phase',
    'Status: Executed plan 1',
    'Last activity: 2026-03-17T17:59:45.953Z',
    '',
    'Git SHA: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    '',
  ].join('\n');

  writeFileSync(filePath, content, 'utf-8');
}

describe('reportProgress', () => {
  let workspace: string;
  let stateMdPath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'orchestrator-progress-'));
    const planningDir = join(workspace, '.planning');
    mkdirSync(planningDir, { recursive: true });
    stateMdPath = join(planningDir, 'STATE.md');
  });

  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('does not emit a mismatch warning when phase matches expectedPhase', async () => {
    writeStateMd(stateMdPath, 1);

    const logger = initLogger({ level: 'silent', pretty: false });
    const warnSpy = vi.spyOn(logger, 'warn');
    const snapshots: number[] = [];

    await reportProgress({
      stateMdPath,
      logger,
      onProgress: (snapshot) => {
        snapshots.push(snapshot.phaseNumber);
      },
      expectedPhase: 1,
    });

    expect(snapshots).toEqual([1]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('emits a single structured mismatch warning when phase differs from expectedPhase', async () => {
    writeStateMd(stateMdPath, 2);

    const logger = initLogger({ level: 'silent', pretty: false });
    const warnSpy = vi.spyOn(logger, 'warn');

    await reportProgress({
      stateMdPath,
      logger,
      expectedPhase: 1,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [firstCall] = warnSpy.mock.calls;
    const [payload, message] = firstCall;

    expect(message).toBe('STATE.md phase mismatch with orchestrator expectation');
    expect(payload).toMatchObject({
      expectedPhase: 1,
      actualPhase: 2,
      actualPhaseName: 'State Monitoring & Phase Transitions',
      plan: 1,
      status: 'Executed plan 1',
    });
  });
});

