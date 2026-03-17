import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSessionLog,
  readSessionLog,
  inspectForCrashedSessions,
  getLastRunningSession,
  computeResumePoint,
  type SessionLogEntry,
} from './session-log.js';

const STATE_MD_CURRENT_POSITION = `
## Current Position

Phase: 2 of 7 (Core Orchestration Loop)
Plan: 1 of 3 in current phase
Status: Executing plan
Last activity: 2026-03-16 — Running 02-01-PLAN.md

Progress: ██░░░░░░░░ 14%
`;

describe('session-log', () => {
  let logPath: string;
  let tmpDir: string;
  let stateMdPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-log-test-'));
    logPath = join(tmpDir, 'session-log.jsonl');
    stateMdPath = join(tmpDir, 'STATE.md');
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  const entry = (status: SessionLogEntry['status'], overrides?: Partial<SessionLogEntry>): SessionLogEntry => ({
    timestamp: new Date().toISOString(),
    goalTitle: 'Test goal',
    phase: '/gsd/execute-plan',
    phaseNumber: 1,
    planNumber: 1,
    sessionId: null,
    command: '/gsd/execute-plan .planning/phases/01-x/01-01-PLAN.md',
    status,
    ...overrides,
  });

  describe('appendSessionLog and readSessionLog', () => {
    it('appends one line and readSessionLog returns entries', async () => {
      await appendSessionLog(logPath, entry('running'));
      const entries = await readSessionLog(logPath);
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('running');
      expect(entries[0].goalTitle).toBe('Test goal');
    });

    it('appends multiple lines', async () => {
      await appendSessionLog(logPath, entry('running'));
      await appendSessionLog(logPath, entry('done', { durationMs: 100 }));
      const entries = await readSessionLog(logPath);
      expect(entries).toHaveLength(2);
      expect(entries[0].status).toBe('running');
      expect(entries[1].status).toBe('done');
      expect(entries[1].durationMs).toBe(100);
    });

    it('skips malformed lines', async () => {
      writeFileSync(logPath, '{"status":"running"}\nnot json\n{"timestamp":"x","goalTitle":"","phase":"","sessionId":null,"command":"","status":"done"}\n', 'utf-8');
      const entries = await readSessionLog(logPath);
      expect(entries).toHaveLength(2);
    });

    it('returns empty array for missing file', async () => {
      const entries = await readSessionLog(join(tmpDir, 'nonexistent.jsonl'));
      expect(entries).toEqual([]);
    });
  });

  describe('inspectForCrashedSessions', () => {
    it('returns null for empty log', async () => {
      writeFileSync(logPath, '', 'utf-8');
      const got = await inspectForCrashedSessions(logPath);
      expect(got).toBeNull();
    });

    it('returns null when last entry is done', async () => {
      await appendSessionLog(logPath, entry('running'));
      await appendSessionLog(logPath, entry('done'));
      const got = await inspectForCrashedSessions(logPath);
      expect(got).toBeNull();
    });

    it('returns null when last entry is timeout', async () => {
      await appendSessionLog(logPath, entry('timeout'));
      const got = await inspectForCrashedSessions(logPath);
      expect(got).toBeNull();
    });

    it('returns last entry when last is running', async () => {
      await appendSessionLog(logPath, entry('done'));
      await appendSessionLog(logPath, entry('running', { goalTitle: 'Current' }));
      const got = await inspectForCrashedSessions(logPath);
      expect(got).not.toBeNull();
      expect(got!.status).toBe('running');
      expect(got!.goalTitle).toBe('Current');
    });

    it('returns last entry when last is crashed', async () => {
      await appendSessionLog(logPath, entry('running'));
      await appendSessionLog(logPath, entry('crashed', { error: 'exit 1' }));
      const got = await inspectForCrashedSessions(logPath);
      expect(got).not.toBeNull();
      expect(got!.status).toBe('crashed');
      expect(got!.error).toBe('exit 1');
    });

    it('skips malformed lines and returns last valid running/crashed', async () => {
      writeFileSync(logPath, 'garbage\n', 'utf-8');
      await appendSessionLog(logPath, entry('crashed'));
      const got = await inspectForCrashedSessions(logPath);
      expect(got).not.toBeNull();
      expect(got!.status).toBe('crashed');
    });
  });

  describe('getLastRunningSession', () => {
    it('returns last running entry', async () => {
      await appendSessionLog(logPath, entry('done'));
      await appendSessionLog(logPath, entry('running', { goalTitle: 'A' }));
      const got = await getLastRunningSession(logPath);
      expect(got).not.toBeNull();
      expect(got!.goalTitle).toBe('A');
    });

    it('returns null when no running', async () => {
      await appendSessionLog(logPath, entry('done'));
      const got = await getLastRunningSession(logPath);
      expect(got).toBeNull();
    });
  });

  describe('computeResumePoint', () => {
    it('returns null for empty log', async () => {
      writeFileSync(stateMdPath, STATE_MD_CURRENT_POSITION, 'utf-8');
      const got = await computeResumePoint(logPath, stateMdPath, 'My Goal');
      expect(got).toBeNull();
    });

    it('returns null when goal title mismatch', async () => {
      writeFileSync(stateMdPath, STATE_MD_CURRENT_POSITION, 'utf-8');
      await appendSessionLog(logPath, entry('crashed', { goalTitle: 'Other Goal' }));
      const got = await computeResumePoint(logPath, stateMdPath, 'My Goal');
      expect(got).toBeNull();
    });

    it('returns null when STATE.md null and entry missing phase/plan', async () => {
      await appendSessionLog(logPath, entry('crashed', { goalTitle: 'My Goal', phaseNumber: undefined, planNumber: undefined }));
      const got = await computeResumePoint(logPath, stateMdPath, 'My Goal');
      expect(got).toBeNull();
    });

    it('returns ResumeFrom when STATE.md valid and goal match', async () => {
      writeFileSync(stateMdPath, STATE_MD_CURRENT_POSITION, 'utf-8');
      await appendSessionLog(logPath, entry('crashed', { goalTitle: 'My Goal' }));
      const got = await computeResumePoint(logPath, stateMdPath, 'My Goal');
      expect(got).toEqual({ phaseNumber: 2, planNumber: 1 });
    });

    it('returns ResumeFrom from log fallback when STATE.md missing but entry has phase/plan', async () => {
      await appendSessionLog(logPath, entry('crashed', { goalTitle: 'My Goal', phaseNumber: 3, planNumber: 2 }));
      const got = await computeResumePoint(logPath, stateMdPath, 'My Goal');
      expect(got).toEqual({ phaseNumber: 3, planNumber: 2 });
    });

    it('returns null when firstPendingGoalTitle is empty', async () => {
      writeFileSync(stateMdPath, STATE_MD_CURRENT_POSITION, 'utf-8');
      await appendSessionLog(logPath, entry('crashed', { goalTitle: 'My Goal' }));
      const got = await computeResumePoint(logPath, stateMdPath, '');
      expect(got).toBeNull();
    });
  });
});
