import { describe, it, expect } from 'vitest';
import { parseGoalsFile, validateGoalsFile } from './goals-parser.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('goals-parser', () => {
  describe('parseGoalsFile', () => {
    it('parses normal goals in Pending and Done', () => {
      const md = `## Pending
- [ ] First
- [ ] Second

## Done
- [x] Completed
`;
      const got = parseGoalsFile(md);
      expect(got.goals).toHaveLength(3);
      expect(got.goals[0]).toMatchObject({ title: 'First', status: 'pending', raw: '- [ ] First' });
      expect(got.goals[1]).toMatchObject({ title: 'Second', status: 'pending' });
      expect(got.goals[2]).toMatchObject({ title: 'Completed', status: 'done', raw: '- [x] Completed' });
      expect(got.warnings).toHaveLength(0);
    });

    it('parses goals with inline specs (WhatsApp-style ### block)', () => {
      const md = `## Pending
- [ ] Build WhatsApp command interface
  ### WhatsApp command interface
  **Goal:** Allow sending commands via WhatsApp.
  **Success criteria:**
  1. Use Twilio WhatsApp Sandbox
  2. Simple parser for daemon actions
  3. Reply with dashboard URL
`;
      const got = parseGoalsFile(md);
      expect(got.goals).toHaveLength(1);
      expect(got.goals[0].title).toBe('Build WhatsApp command interface');
      expect(got.goals[0].description).toContain('Allow sending commands');
      expect(got.goals[0].successCriteria).toHaveLength(3);
      expect(got.goals[0].successCriteria).toContain('Use Twilio WhatsApp Sandbox');
      expect(got.warnings).toHaveLength(0);
    });

    it('parses bundle breadcrumb fields from metadata blocks', () => {
      const md = `## Pending
- [ ] Add intake-driven quick mode
  ### Add intake-driven quick mode
  **Goal:** Route trivial work through quick mode.
  **Success criteria:**
  1. Quick route is selected
  **Route:** quick
  **Context bundle:** .planning/intake/20260320-add-intake
  **Session context:** .planning/intake/20260320-add-intake/SESSION-CONTEXT.md
  **Agent brief:** .planning/intake/20260320-add-intake/AGENT-BRIEF.md
`;
      const got = parseGoalsFile(md);
      expect(got.goals).toHaveLength(1);
      expect(got.goals[0].route).toBe('quick');
      expect(got.goals[0].contextBundlePath).toBe('.planning/intake/20260320-add-intake');
      expect(got.goals[0].sessionContextPath).toContain('SESSION-CONTEXT.md');
      expect(got.goals[0].agentBriefPath).toContain('AGENT-BRIEF.md');
      expect(got.goals[0].metadataBlock).toContain('**Route:** quick');
    });

    it('handles empty sections', () => {
      const md = `## Pending

## In Progress

## Done
`;
      const got = parseGoalsFile(md);
      expect(got.goals).toHaveLength(0);
      expect(got.warnings).toHaveLength(0);
    });

    it('records warnings for lines outside section and non-checkbox lines', () => {
      const md = `# Header
- [ ] Orphan
## Pending
- [ ] Real goal
- Bare dash
`;
      const got = parseGoalsFile(md);
      expect(got.goals).toHaveLength(1);
      expect(got.goals[0].title).toBe('Real goal');
      expect(got.warnings.some((w) => w.reason.includes('outside any section'))).toBe(true);
      expect(got.warnings.some((w) => w.reason.includes('not a checkbox'))).toBe(true);
    });

    it('skips checkbox line with empty title (no goal added)', () => {
      const md = `## Pending
- [ ] 
- [ ] Has title
`;
      const got = parseGoalsFile(md);
      expect(got.goals).toHaveLength(1);
      expect(got.goals[0].title).toBe('Has title');
    });
  });

  describe('validateGoalsFile', () => {
    it('reads file and returns parsed goals', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'goals-parser-'));
      const path = join(dir, 'goals.md');
      writeFileSync(path, '## Pending\n- [ ] One\n- [ ] Two\n', 'utf-8');
      try {
        const got = await validateGoalsFile(path);
        expect(got.goals).toHaveLength(2);
        expect(got.goals[0].title).toBe('One');
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it('throws on missing file', async () => {
      await expect(validateGoalsFile('/nonexistent/goals.md')).rejects.toThrow();
    });
  });
});
