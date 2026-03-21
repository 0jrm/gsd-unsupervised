import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import {
  parseGoals,
  loadGoals,
  getPendingGoals,
  buildExecutionPlan,
  appendPendingGoal,
  type ParseWarning,
} from './goals.js';

describe('goals', () => {
  describe('appendPendingGoal', () => {
    it('appends a goal under ## Pending', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'goals-append-'));
      const goalsPath = join(dir, 'goals.md');
      const content = `# Goals

## Pending
- [ ] First goal

## In Progress
- [x] Done
`;
      writeFileSync(goalsPath, content, 'utf-8');
      await appendPendingGoal(goalsPath, 'New goal');
      const after = await loadGoals(goalsPath);
      const pending = getPendingGoals(after);
      expect(pending.map((g) => g.title)).toContain('First goal');
      expect(pending.map((g) => g.title)).toContain('New goal');
      rmSync(dir, { recursive: true });
    });

    it('appends with priority when given', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'goals-priority-'));
      const goalsPath = join(dir, 'goals.md');
      writeFileSync(
        goalsPath,
        `# Goals\n\n## pending\n- [ ] A\n\n## done\n`,
        'utf-8',
      );
      await appendPendingGoal(goalsPath, 'High priority', 1);
      const raw = await import('node:fs/promises').then((fs) => fs.readFile(goalsPath, 'utf-8'));
      expect(raw).toContain('- [ ] High priority [priority:1]');
      rmSync(dir, { recursive: true });
    });

    it('throws when ## pending section is missing', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'goals-no-pending-'));
      const goalsPath = join(dir, 'goals.md');
      writeFileSync(goalsPath, '# Goals\n\n## done\n- [x] Only done\n', 'utf-8');
      await expect(appendPendingGoal(goalsPath, 'X')).rejects.toThrow(/missing.*pending/);
      rmSync(dir, { recursive: true });
    });
  });

  describe('buildExecutionPlan', () => {
    it('orders by priority then index', () => {
      const goals = [
        { title: 'A', status: 'pending' as const, raw: '- [ ] A', priority: undefined },
        { title: 'B', status: 'pending' as const, raw: '- [ ] B', priority: 1 },
        { title: 'C', status: 'pending' as const, raw: '- [ ] C', priority: 1 },
      ];
      const plan = buildExecutionPlan(goals);
      expect(plan.ordered.map((g) => g.title)).toEqual(['B', 'C', 'A']);
    });
  });

  describe('parseGoals (strict schema)', () => {
    it('parses only checkbox lines as goals and collects warnings for others', () => {
      const md = `## Pending
- [ ] Checkbox goal
- Bare dash without checkbox
- [x] Done goal
### 5-crash-detection-recovery
- [ ] Another pending
`;
      const { goals, warnings } = parseGoals(md);
      expect(goals).toHaveLength(3);
      expect(goals[0].title).toBe('Checkbox goal');
      expect(goals[1].title).toBe('Done goal');
      expect(goals[2].title).toBe('Another pending');
      expect(warnings.some((w: ParseWarning) => w.line.includes('Bare dash'))).toBe(true);
      expect(warnings.some((w: ParseWarning) => w.reason.includes('checkbox'))).toBe(true);
    });

    it('skips bare-dash and h3 lines with warnings', () => {
      const md = `## Pending
- Debug & fix STATE.md
### 5-crash-detection-recovery
- [ ] Real goal
`;
      const { goals, warnings } = parseGoals(md);
      expect(goals).toHaveLength(1);
      expect(goals[0].title).toBe('Real goal');
      expect(warnings).toHaveLength(2);
      expect(warnings.some((w: ParseWarning) => w.line.includes('Debug'))).toBe(true);
      expect(warnings.some((w: ParseWarning) => w.line.includes('5-crash-detection'))).toBe(true);
      expect(warnings.every((w: ParseWarning) => w.reason.includes('not a checkbox'))).toBe(true);
    });

    it('attaches ### block as metadata to preceding goal', () => {
      const md = `## Pending
- [ ] Build WhatsApp command interface
  ### WhatsApp command interface
`;
      const { goals, warnings } = parseGoals(md);
      expect(goals).toHaveLength(1);
      expect(goals[0].title).toBe('Build WhatsApp command interface');
      expect(goals[0].metadataBlock).toContain('### WhatsApp');
      expect(warnings).toHaveLength(0);
    });

    it('maps parsed breadcrumb fields onto Goal objects', () => {
      const md = `## Pending
- [ ] Bootstrap start flow
  ### Bootstrap start flow
  **Goal:** Create a bundle-aware start flow.
  **Route:** full
  **Context bundle:** .planning/intake/boot-start
  **Session context:** .planning/intake/boot-start/SESSION-CONTEXT.md
  **Agent brief:** .planning/intake/boot-start/AGENT-BRIEF.md
`;
      const { goals, warnings } = parseGoals(md);
      expect(goals).toHaveLength(1);
      expect(goals[0].route).toBe('full');
      expect(goals[0].contextBundlePath).toBe('.planning/intake/boot-start');
      expect(goals[0].sessionContextPath).toContain('SESSION-CONTEXT.md');
      expect(goals[0].agentBriefPath).toContain('AGENT-BRIEF.md');
      expect(warnings).toHaveLength(0);
    });

    it('reports lines outside section as warnings', () => {
      const md = `# Header
- [ ] Orphan (no section above)
## Pending
- [ ] In section
`;
      const { goals, warnings } = parseGoals(md);
      expect(goals).toHaveLength(1);
      expect(goals[0].title).toBe('In section');
      expect(warnings.some((w: ParseWarning) => w.line.includes('Orphan'))).toBe(true);
      expect(warnings.some((w: ParseWarning) => w.reason.includes('outside any section'))).toBe(true);
    });
  });
});
