import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from './logger.js';
import { validateStateConsistency } from './state-consistency.js';

function stateMdContent(phaseNumber: number): string {
  return `## Current Position

Phase: ${phaseNumber} of 7 (Test Phase)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-03-18

Progress: 0%
`;
}

function sessionLogEntry(overrides: {
  status: 'running' | 'done' | 'crashed' | 'timeout';
  phaseNumber?: number;
  planNumber?: number;
}): string {
  const entry = {
    timestamp: new Date().toISOString(),
    goalTitle: 'Test goal',
    phase: '/gsd/execute-plan',
    phaseNumber: overrides.phaseNumber ?? 1,
    planNumber: overrides.planNumber ?? 1,
    sessionId: null,
    command: '/gsd/execute-plan x',
    status: overrides.status,
  };
  return JSON.stringify(entry) + '\n';
}

describe('state-consistency', () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'state-consistency-test-'));
    logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      child: () => logger,
    };
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  describe('consistent', () => {
    it('returns consistent and proceed when no session log', async () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'STATE.md'), stateMdContent(1), 'utf-8');
      const report = await validateStateConsistency(tmpDir, logger);
      expect(report.consistent).toBe(true);
      expect(report.warnings).toHaveLength(0);
      expect(report.suggestedAction).toBe('proceed');
    });

    it('returns consistent when last entry is done and phase matches STATE.md', async () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'STATE.md'), stateMdContent(2), 'utf-8');
      writeFileSync(
        join(tmpDir, 'session-log.jsonl'),
        sessionLogEntry({ status: 'done', phaseNumber: 2, planNumber: 1 }),
        'utf-8',
      );
      const report = await validateStateConsistency(tmpDir, logger);
      expect(report.consistent).toBe(true);
      expect(report.suggestedAction).toBe('proceed');
    });

    it('returns consistent when last entry is running and heartbeat exists', async () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'STATE.md'), stateMdContent(1), 'utf-8');
      writeFileSync(join(tmpDir, '.planning', 'heartbeat.txt'), '', 'utf-8');
      writeFileSync(
        join(tmpDir, 'session-log.jsonl'),
        sessionLogEntry({ status: 'running', phaseNumber: 1 }),
        'utf-8',
      );
      const report = await validateStateConsistency(tmpDir, logger);
      expect(report.consistent).toBe(true);
      expect(report.suggestedAction).toBe('proceed');
    });
  });

  describe('inconsistent-by-phase', () => {
    it('flags phase drift > 1 and suggests reset', async () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'STATE.md'), stateMdContent(5), 'utf-8');
      writeFileSync(
        join(tmpDir, 'session-log.jsonl'),
        sessionLogEntry({ status: 'done', phaseNumber: 2, planNumber: 1 }),
        'utf-8',
      );
      const report = await validateStateConsistency(tmpDir, logger);
      expect(report.consistent).toBe(false);
      expect(report.warnings.some((w) => w.includes('differs from session log'))).toBe(true);
      expect(report.suggestedAction).toBe('reset');
    });
  });

  describe('inconsistent-by-heartbeat', () => {
    it('flags running without heartbeat and suggests reset', async () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'STATE.md'), stateMdContent(1), 'utf-8');
      writeFileSync(
        join(tmpDir, 'session-log.jsonl'),
        sessionLogEntry({ status: 'running', phaseNumber: 1 }),
        'utf-8',
      );
      const report = await validateStateConsistency(tmpDir, logger);
      expect(report.consistent).toBe(false);
      expect(report.warnings.some((w) => w.includes('heartbeat'))).toBe(true);
      expect(report.suggestedAction).toBe('reset');
    });
  });
});
