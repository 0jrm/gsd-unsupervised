import { describe, it, expect } from 'vitest';
import { parseStateMd, readStateMd, type StateSnapshot } from './state-parser.js';

const STANDARD_BLOCK = `
## Current Position

Phase: 3 of 7 (Cursor Agent Integration)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-03-16 — Completed 03-03-PLAN.md — Phase 3 complete

Progress: ██████░░░░ 43%
`;

describe('parseStateMd', () => {
  it('parses standard content with all fields', () => {
    const got = parseStateMd(STANDARD_BLOCK);
    expect(got).not.toBeNull();
    expect(got).toEqual({
      phaseNumber: 3,
      totalPhases: 7,
      phaseName: 'Cursor Agent Integration',
      planNumber: 3,
      totalPlans: 3,
      status: 'Phase complete',
      lastActivity: '2026-03-16 — Completed 03-03-PLAN.md — Phase 3 complete',
      progressPercent: 43,
    });
  });

  it('parses phase in-progress (Executing plan)', () => {
    const content = `
## Current Position

Phase: 2 of 7 (Core Orchestration Loop)
Plan: 1 of 3 in current phase
Status: Executing plan
Last activity: 2026-03-16 — Running 02-01-PLAN.md

Progress: ██░░░░░░░░ 14%
`;
    const got = parseStateMd(content);
    expect(got).not.toBeNull();
    expect(got!.status).toBe('Executing plan');
    expect(got!.phaseNumber).toBe(2);
    expect(got!.planNumber).toBe(1);
  });

  it('parses plan 1 of 1 in phase', () => {
    const content = `
## Current Position

Phase: 1 of 7 (Foundation & CLI Scaffold)
Plan: 1 of 1 in current phase
Status: Planned
Last activity: 2026-03-16 — Not started

Progress: ░░░░░░░░░░ 0%
`;
    const got = parseStateMd(content);
    expect(got).not.toBeNull();
    expect(got!.planNumber).toBe(1);
    expect(got!.totalPlans).toBe(1);
  });

  it('returns null when "Current Position" section is missing', () => {
    const content = `
# Project State

## Some Other Section

Phase: 1 of 7 (Foundation)
Plan: 1 of 1 in current phase
Status: Planned
`;
    expect(parseStateMd(content)).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseStateMd('')).toBeNull();
  });

  it('returns null for whitespace-only content', () => {
    expect(parseStateMd('   \n\n  \t  ')).toBeNull();
  });

  it('returns null when phase line has no "of" (malformed)', () => {
    const content = `
## Current Position

Phase: 3 (Cursor Agent Integration)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-03-16
`;
    expect(parseStateMd(content)).toBeNull();
  });

  it('returns null when plan line is missing', () => {
    const content = `
## Current Position

Phase: 3 of 7 (Cursor Agent Integration)
Status: Phase complete
Last activity: 2026-03-16
`;
    expect(parseStateMd(content)).toBeNull();
  });

  it('returns null when status line is missing', () => {
    const content = `
## Current Position

Phase: 3 of 7 (Cursor Agent Integration)
Plan: 3 of 3 in current phase
Last activity: 2026-03-16
`;
    expect(parseStateMd(content)).toBeNull();
  });

  it('sets progressPercent to null when progress line has no percentage', () => {
    const content = `
## Current Position

Phase: 3 of 7 (Cursor Agent Integration)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-03-16

Progress: ██████░░░░
`;
    const got = parseStateMd(content);
    expect(got).not.toBeNull();
    expect(got!.progressPercent).toBeNull();
  });

  it('sets progressPercent to null when progress line is missing', () => {
    const content = `
## Current Position

Phase: 3 of 7 (Cursor Agent Integration)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-03-16
`;
    const got = parseStateMd(content);
    expect(got).not.toBeNull();
    expect(got!.progressPercent).toBeNull();
  });

  it('parses real STATE.md Current Position block (phase 4)', () => {
    const content = `
# Project State

## Project Reference

See: .planning/PROJECT.md

## Current Position

Phase: 4 of 7 (State Monitoring & Phase Transitions)
Plan: 0 of 3 in current phase
Status: Planned
Last activity: 2026-03-16 — Phase 4 planned with 3 plans (TDD parser, watcher + events, daemon/orchestrator wiring)

Progress: ██████░░░░ 43%

## Performance Metrics
`;
    const got = parseStateMd(content);
    expect(got).not.toBeNull();
    expect(got).toEqual({
      phaseNumber: 4,
      totalPhases: 7,
      phaseName: 'State Monitoring & Phase Transitions',
      planNumber: 0,
      totalPlans: 3,
      status: 'Planned',
      lastActivity: '2026-03-16 — Phase 4 planned with 3 plans (TDD parser, watcher + events, daemon/orchestrator wiring)',
      progressPercent: 43,
    });
  });

  it('trims status and lastActivity', () => {
    const content = `
## Current Position

Phase: 1 of 7 (Foundation)
Plan: 1 of 1 in current phase
Status:   Planned  
Last activity:   2026-03-16 — Started

Progress: 10%
`;
    const got = parseStateMd(content);
    expect(got).not.toBeNull();
    expect(got!.status).toBe('Planned');
    expect(got!.lastActivity).toBe('2026-03-16 — Started');
    expect(got!.progressPercent).toBe(10);
  });
});

describe('readStateMd', () => {
  it('reads and parses existing STATE.md', async () => {
    const got = await readStateMd('.planning/STATE.md');
    expect(got).not.toBeNull();
    expect(typeof got!.phaseNumber).toBe('number');
    expect(typeof got!.totalPhases).toBe('number');
    expect(typeof got!.status).toBe('string');
  });

  it('returns null when file is missing', async () => {
    const got = await readStateMd('.planning/NONEXISTENT-STATE.md');
    expect(got).toBeNull();
  });

  it('returns null when file content is unparseable', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'state-parser-'));
    const badPath = join(dir, 'STATE.md');
    try {
      await writeFile(badPath, 'not a valid state file, no ## Current Position', 'utf-8');
      const got = await readStateMd(badPath);
      expect(got).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
