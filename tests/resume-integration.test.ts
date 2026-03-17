/**
 * Integration test: crash-and-resume scenario.
 * Uses fixture session-log and STATE.md to verify computeResumePointer returns the expected
 * resume position so the daemon would pass resumeFrom to orchestrateGoal.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeResumePointer } from '../src/resume-pointer.js';

describe('resume integration', () => {
  let workspace: string;
  let sessionLogPath: string;
  let stateMdPath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'resume-integration-'));
    sessionLogPath = join(workspace, 'session-log.jsonl');
    stateMdPath = join(workspace, '.planning', 'STATE.md');
    mkdirSync(join(workspace, '.planning', 'phases', '01-alpha'), { recursive: true });
    writeFileSync(
      join(workspace, '.planning', 'ROADMAP.md'),
      '- [ ] **Phase 1: Alpha** — Test phase\n',
      'utf-8',
    );
    writeFileSync(join(workspace, '.planning', 'phases', '01-alpha', '01-01-PLAN.md'), '# P1\n', 'utf-8');
    writeFileSync(join(workspace, '.planning', 'phases', '01-alpha', '01-01-SUMMARY.md'), '# S1\n', 'utf-8');
    writeFileSync(join(workspace, '.planning', 'phases', '01-alpha', '01-02-PLAN.md'), '# P2\n', 'utf-8');
  });

  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('returns resume point when session crashed and goal matches first pending', async () => {
    const planCompleteEntry = {
      timestamp: new Date().toISOString(),
      goalTitle: 'Complete Phase 5',
      phase: '/gsd/execute-plan',
      phaseNumber: 1,
      planNumber: 1,
      sessionId: 'abc-123',
      command: '/gsd/execute-plan .planning/phases/01-alpha/01-01-PLAN.md',
      status: 'done' as const,
      durationMs: 5000,
    };
    const crashedEntry = {
      timestamp: new Date().toISOString(),
      goalTitle: 'Complete Phase 5',
      phase: '/gsd/execute-plan',
      phaseNumber: 1,
      planNumber: 2,
      sessionId: 'def-456',
      command: '/gsd/execute-plan .planning/phases/01-alpha/01-02-PLAN.md',
      status: 'crashed' as const,
      durationMs: 1000,
      error: 'Agent exited with code 1',
    };
    writeFileSync(
      sessionLogPath,
      JSON.stringify(planCompleteEntry) + '\n' + JSON.stringify(crashedEntry) + '\n',
      'utf-8',
    );

    const resumeFrom = await computeResumePointer({
      sessionLogPath,
      stateMdPath,
      goalTitle: 'Complete Phase 5',
    });

    expect(resumeFrom).toEqual({ phaseNumber: 1, planNumber: 2 });
  });

  it('returns null when goal does not match first pending', async () => {
    const crashedEntry = {
      timestamp: new Date().toISOString(),
      goalTitle: 'Other Goal',
      phase: '/gsd/execute-plan',
      phaseNumber: 1,
      planNumber: 1,
      sessionId: null,
      command: '/gsd/execute-plan ...',
      status: 'crashed' as const,
    };
    writeFileSync(sessionLogPath, JSON.stringify(crashedEntry) + '\n', 'utf-8');

    const resumeFrom = await computeResumePointer({
      sessionLogPath,
      stateMdPath,
      goalTitle: 'Complete Phase 5',
    });

    expect(resumeFrom).toBeNull();
  });
});
