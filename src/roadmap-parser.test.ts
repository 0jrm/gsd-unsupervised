import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPhaseDir, discoverPlans, isPlanCompleted } from './roadmap-parser.js';

describe('roadmap-parser', () => {
  let phasesRoot: string;
  let phaseDir: string;

  beforeEach(() => {
    phasesRoot = mkdtempSync(join(tmpdir(), 'roadmap-test-'));
    phaseDir = join(phasesRoot, '05-crash-detection-recovery');
    mkdirSync(phaseDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(phasesRoot, { recursive: true });
    } catch {
      // ignore
    }
  });

  describe('isPlanCompleted', () => {
    it('returns true when SUMMARY exists for plan number', () => {
      writeFileSync(join(phaseDir, '05-01-PLAN.md'), '# Plan', 'utf-8');
      writeFileSync(join(phaseDir, '05-01-SUMMARY.md'), '# Summary', 'utf-8');
      expect(isPlanCompleted(phaseDir, 1)).toBe(true);
    });

    it('returns false when only PLAN exists', () => {
      writeFileSync(join(phaseDir, '05-01-PLAN.md'), '# Plan', 'utf-8');
      expect(isPlanCompleted(phaseDir, 1)).toBe(false);
    });

    it('returns false when SUMMARY does not exist for plan number', () => {
      writeFileSync(join(phaseDir, '05-02-PLAN.md'), '# Plan', 'utf-8');
      expect(isPlanCompleted(phaseDir, 2)).toBe(false);
    });

    it('returns true for plan 2 when 05-02-SUMMARY.md exists', () => {
      writeFileSync(join(phaseDir, '05-02-PLAN.md'), '# Plan', 'utf-8');
      writeFileSync(join(phaseDir, '05-02-SUMMARY.md'), '# Summary', 'utf-8');
      expect(isPlanCompleted(phaseDir, 2)).toBe(true);
    });
  });

  describe('findPhaseDir and discoverPlans', () => {
    it('findPhaseDir finds phase directory by number', () => {
      const dir = findPhaseDir(phasesRoot, 5);
      expect(dir).toBe(phaseDir);
    });

    it('discoverPlans marks executed when SUMMARY exists', async () => {
      writeFileSync(join(phaseDir, '05-01-PLAN.md'), '', 'utf-8');
      writeFileSync(join(phaseDir, '05-01-SUMMARY.md'), '', 'utf-8');
      writeFileSync(join(phaseDir, '05-02-PLAN.md'), '', 'utf-8');
      const plans = await discoverPlans(phaseDir);
      expect(plans).toHaveLength(2);
      expect(plans[0].executed).toBe(true);
      expect(plans[1].executed).toBe(false);
    });
  });
});
