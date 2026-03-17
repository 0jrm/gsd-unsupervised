import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendSessionLog } from './session-log.js';
import type { SessionLogEntry } from './session-log.js';
import { computeResumePointer } from './resume-pointer.js';

describe('resume-pointer', () => {
  let tmpDir: string;
  let logPath: string;
  let stateMdPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'resume-pointer-test-'));
    logPath = join(tmpDir, 'session-log.jsonl');
    stateMdPath = join(tmpDir, '.planning', 'STATE.md');
    mkdirSync(join(tmpDir, '.planning'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  const entry = (
    status: SessionLogEntry['status'],
    overrides?: Partial<SessionLogEntry>,
  ): SessionLogEntry => ({
    timestamp: new Date().toISOString(),
    goalTitle: 'My Goal',
    phase: '/gsd/execute-plan',
    phaseNumber: 1,
    planNumber: 1,
    sessionId: null,
    command: '/gsd/execute-plan x',
    status,
    ...overrides,
  });

  describe('computeResumePointer', () => {
    it('returns null for empty log', async () => {
      writeFileSync(logPath, '', 'utf-8');
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: 'My Goal',
      });
      expect(got).toBeNull();
    });

    it('returns null when goal title is empty', async () => {
      await appendSessionLog(logPath, entry('crashed'));
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: '   ',
      });
      expect(got).toBeNull();
    });

    it('returns null when goal title mismatch', async () => {
      await appendSessionLog(logPath, entry('crashed', { goalTitle: 'Other Goal' }));
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: 'My Goal',
      });
      expect(got).toBeNull();
    });

    it('returns null when last entry for goal is done (no crash)', async () => {
      await appendSessionLog(logPath, entry('running', { phaseNumber: 1, planNumber: 1 }));
      await appendSessionLog(logPath, entry('done', { phaseNumber: 1, planNumber: 1 }));
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: 'My Goal',
      });
      expect(got).toBeNull();
    });

    it('returns pointer after plan-complete when last is crashed', async () => {
      await appendSessionLog(
        logPath,
        entry('done', {
          phase: '/gsd/execute-plan',
          phaseNumber: 3,
          planNumber: 2,
        }),
      );
      await appendSessionLog(
        logPath,
        entry('crashed', {
          phase: '/gsd/execute-plan',
          phaseNumber: 3,
          planNumber: 3,
        }),
      );
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: 'My Goal',
      });
      expect(got).toEqual({ phaseNumber: 3, planNumber: 3 });
    });

    it('returns pointer after plan-complete when last is running', async () => {
      await appendSessionLog(
        logPath,
        entry('done', {
          phase: '/gsd/execute-plan',
          phaseNumber: 5,
          planNumber: 1,
        }),
      );
      await appendSessionLog(
        logPath,
        entry('running', {
          phase: '/gsd/execute-plan',
          phaseNumber: 5,
          planNumber: 2,
        }),
      );
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: 'My Goal',
      });
      // Last plan-complete was plan 1; resume at plan 2 (re-run interrupted plan)
      expect(got).toEqual({ phaseNumber: 5, planNumber: 2 });
    });

    it('returns pointer from phase-complete when no plan-complete', async () => {
      await appendSessionLog(
        logPath,
        entry('done', {
          phase: '/gsd/plan-phase',
          phaseNumber: 4,
        }),
      );
      await appendSessionLog(
        logPath,
        entry('crashed', {
          phase: '/gsd/plan-phase',
          phaseNumber: 5,
        }),
      );
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: 'My Goal',
      });
      expect(got).toEqual({ phaseNumber: 5, planNumber: 0 });
    });

    it('prefers plan-complete over phase-complete', async () => {
      await appendSessionLog(
        logPath,
        entry('done', {
          phase: '/gsd/plan-phase',
          phaseNumber: 4,
        }),
      );
      await appendSessionLog(
        logPath,
        entry('done', {
          phase: '/gsd/execute-plan',
          phaseNumber: 5,
          planNumber: 2,
        }),
      );
      await appendSessionLog(
        logPath,
        entry('crashed', {
          phase: '/gsd/execute-plan',
          phaseNumber: 5,
          planNumber: 3,
        }),
      );
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: 'My Goal',
      });
      expect(got).toEqual({ phaseNumber: 5, planNumber: 3 });
    });

    it('returns null for missing session log file', async () => {
      const got = await computeResumePointer({
        sessionLogPath: join(tmpDir, 'nonexistent.jsonl'),
        stateMdPath,
        goalTitle: 'My Goal',
      });
      expect(got).toBeNull();
    });

    it('cross-checks STATE and favors conservative pointer when inconsistent', async () => {
      await appendSessionLog(
        logPath,
        entry('done', {
          phase: '/gsd/execute-plan',
          phaseNumber: 5,
          planNumber: 2,
        }),
      );
      await appendSessionLog(
        logPath,
        entry('running', {
          phase: '/gsd/execute-plan',
          phaseNumber: 5,
          planNumber: 3,
        }),
      );
      writeFileSync(
        stateMdPath,
        [
          '# STATE',
          '',
          '## Current Position',
          '',
          'Phase: 4 of 7 (State Monitoring)',
          'Plan: 2 of 2 in current phase',
          'Status: Executing plan 2',
          'Last activity: 2026-03-17',
          '',
        ].join('\n'),
        'utf-8',
      );
      const got = await computeResumePointer({
        sessionLogPath: logPath,
        stateMdPath,
        goalTitle: 'My Goal',
      });
      expect(got).not.toBeNull();
      expect(got!.phaseNumber).toBeLessThanOrEqual(5);
    });
  });
});
