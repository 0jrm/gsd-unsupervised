/**
 * Integration test: crash-and-resume scenario.
 * Uses fixture session-log and STATE.md to verify computeResumePoint returns the expected
 * resume position so the daemon would pass resumeFrom to orchestrateGoal.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeResumePoint } from '../src/session-log.js';

const STATE_MD_PHASE2_PLAN1 = `
# Project State

## Current Position

Phase: 2 of 7 (Core Orchestration Loop)
Plan: 1 of 3 in current phase
Status: Executing plan
Last activity: 2026-03-16 — Running 02-01-PLAN.md

Progress: ██░░░░░░░░ 14%

## Other sections
...
`;

describe('resume integration', () => {
  let workspace: string;
  let sessionLogPath: string;
  let stateMdPath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'resume-integration-'));
    sessionLogPath = join(workspace, 'session-log.jsonl');
    stateMdPath = join(workspace, '.planning', 'STATE.md');
    mkdirSync(join(workspace, '.planning'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('returns resume point when session crashed and goal matches first pending', async () => {
    writeFileSync(stateMdPath, STATE_MD_PHASE2_PLAN1, 'utf-8');
    const crashedEntry = {
      timestamp: new Date().toISOString(),
      goalTitle: 'Complete Phase 5',
      phase: '/gsd/execute-plan',
      phaseNumber: 2,
      planNumber: 1,
      sessionId: 'abc-123',
      command: '/gsd/execute-plan .planning/phases/02-x/02-01-PLAN.md',
      status: 'crashed' as const,
      durationMs: 5000,
      error: 'Agent exited with code 1',
    };
    writeFileSync(sessionLogPath, JSON.stringify(crashedEntry) + '\n', 'utf-8');

    const resumeFrom = await computeResumePoint(
      sessionLogPath,
      stateMdPath,
      'Complete Phase 5',
    );

    expect(resumeFrom).toEqual({ phaseNumber: 2, planNumber: 1 });
  });

  it('returns null when goal does not match first pending', async () => {
    writeFileSync(stateMdPath, STATE_MD_PHASE2_PLAN1, 'utf-8');
    const crashedEntry = {
      timestamp: new Date().toISOString(),
      goalTitle: 'Other Goal',
      phase: '/gsd/execute-plan',
      phaseNumber: 2,
      planNumber: 1,
      sessionId: null,
      command: '/gsd/execute-plan ...',
      status: 'crashed' as const,
    };
    writeFileSync(sessionLogPath, JSON.stringify(crashedEntry) + '\n', 'utf-8');

    const resumeFrom = await computeResumePoint(
      sessionLogPath,
      stateMdPath,
      'Complete Phase 5',
    );

    expect(resumeFrom).toBeNull();
  });
});
