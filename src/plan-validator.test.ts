import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePlanFile } from './plan-validator.js';

describe('plan-validator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plan-validator-'));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  const validPlan = `# Plan

<objective>
Build the feature.
</objective>

<tasks>
<task type="auto">
  <name>Task 1</name>
  <action>Do something</action>
</task>
</tasks>

<verification>
- Run npm test
</verification>

<success_criteria>
- Tests pass
</success_criteria>
`;

  it('valid plan passes', async () => {
    const path = join(tmpDir, 'valid-PLAN.md');
    writeFileSync(path, validPlan, 'utf-8');
    const result = await validatePlanFile(path);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('missing <objective> fails', async () => {
    const plan = validPlan.replace(/<objective>[\s\S]*?<\/objective>/, '');
    const path = join(tmpDir, 'no-objective-PLAN.md');
    writeFileSync(path, plan, 'utf-8');
    const result = await validatePlanFile(path);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or empty required section: <objective>...</objective>');
  });

  it('empty <tasks> fails', async () => {
    const plan = validPlan.replace(
      /<tasks>[\s\S]*?<\/tasks>/,
      '<tasks>\n\n</tasks>',
    );
    const path = join(tmpDir, 'empty-tasks-PLAN.md');
    writeFileSync(path, plan, 'utf-8');
    const result = await validatePlanFile(path);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('<tasks>'))).toBe(true);
  });

  it('tasks without <task> element fails', async () => {
    const plan = validPlan.replace(
      /<tasks>[\s\S]*?<\/tasks>/,
      '<tasks>\n  <p>No task here</p>\n</tasks>',
    );
    const path = join(tmpDir, 'no-task-element-PLAN.md');
    writeFileSync(path, plan, 'utf-8');
    const result = await validatePlanFile(path);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Section <tasks> must contain at least one <task> element',
    );
  });

  it('unreadable file fails', async () => {
    const result = await validatePlanFile(join(tmpDir, 'nonexistent-PLAN.md'));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/unreadable|ENOENT/i);
  });

  it('empty file fails', async () => {
    const path = join(tmpDir, 'empty-PLAN.md');
    writeFileSync(path, '', 'utf-8');
    const result = await validatePlanFile(path);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plan file is empty');
  });
});
