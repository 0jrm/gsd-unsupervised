import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('runtime breadcrumb overlays', () => {
  it('documents the Cursor intake bridge contract', () => {
    const content = readFileSync(
      resolve(process.cwd(), '.cursor', 'rules', 'gsd-intake-bridge.mdc'),
      'utf-8',
    );

    expect(content).toContain('.planning/intake/LATEST.json');
    expect(content).toContain('AGENT-BRIEF.md');
    expect(content).toContain('SESSION-CONTEXT.md');
  });

  it('documents the Codex session-context skill contract', () => {
    const content = readFileSync(
      resolve(process.cwd(), '.codex', 'skills', 'gsd-session-context', 'SKILL.md'),
      'utf-8',
    );

    expect(content).toContain('.planning/intake/LATEST.json');
    expect(content).toContain('AGENT-BRIEF.md');
    expect(content).toContain('SESSION-CONTEXT.md');
  });
});
