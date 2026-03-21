import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoalContextPrompt } from './goal-context.js';

describe('buildGoalContextPrompt', () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('inlines the agent brief and points to the session context file', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'goal-context-'));
    workspaces.push(workspace);
    const bundleDir = join(workspace, '.planning', 'intake', '20260320-goal');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'AGENT-BRIEF.md'),
      '# Agent Brief\n\n- Read the request first.\n',
      'utf-8',
    );

    const prompt = await buildGoalContextPrompt({
      workspaceRoot: workspace,
      command: {
        command: '/gsd:quick',
        args: 'Ship the fix',
        description: 'Quick route',
      },
      logContext: {
        goalTitle: 'Ship the fix',
        route: 'quick',
        contextBundlePath: '.planning/intake/20260320-goal',
        sessionContextPath: '.planning/intake/20260320-goal/SESSION-CONTEXT.md',
        agentBriefPath: '.planning/intake/20260320-goal/AGENT-BRIEF.md',
      },
    });

    expect(prompt).toContain('Queued goal: Ship the fix');
    expect(prompt).toContain('Route: quick');
    expect(prompt).toContain('Context bundle: .planning/intake/20260320-goal');
    expect(prompt).toContain('# Agent Brief');
    expect(prompt).toContain('If more detail is needed, read: .planning/intake/20260320-goal/SESSION-CONTEXT.md');
    expect(prompt).toContain('Then execute the requested GSD command exactly: /gsd:quick Ship the fix');
  });
});
