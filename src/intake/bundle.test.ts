import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createIntakeBundle } from './bundle.js';

describe('intake/bundle', () => {
  it('creates the intake bundle files and updates LATEST pointers', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'intake-bundle-'));
    writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'demo-app', type: 'module', scripts: { build: 'tsc', test: 'vitest' } }, null, 2),
      'utf-8',
    );
    writeFileSync(path.join(workspaceRoot, 'AGENTS.md'), '# Local agents\n', 'utf-8');

    try {
      const result = await createIntakeBundle({
        workspaceRoot,
        rawGoal: {
          title: 'Bootstrap start flow',
          body: 'Need a queue-aware intake launcher.',
          source: 'cli',
          projectPath: workspaceRoot,
          receivedAt: '2026-03-20T10:00:00.000Z',
        },
        complexity: {
          score: 3,
          reasoning: 'moderate feature',
          suggestedQuestions: [],
        },
        route: 'full',
        runtimes: ['cursor', 'codex'],
        draftSpec: 'Queue the request and build a bundle.',
        clarifiedSpec: 'Create start flow with bundle breadcrumbs and daemon awareness.',
        upstream: {
          repoUrl: 'https://github.com/gsd-build/get-shit-done.git',
          repoSha: 'abc123',
          syncedAt: '2026-03-20T10:05:00.000Z',
        },
      });

      expect(existsSync(result.requestPath)).toBe(true);
      expect(existsSync(result.firstPrinciplesPath)).toBe(true);
      expect(existsSync(result.standardsPath)).toBe(true);
      expect(existsSync(result.sessionContextPath)).toBe(true);
      expect(existsSync(result.agentBriefPath)).toBe(true);

      const latestJson = readFileSync(path.join(workspaceRoot, '.planning', 'intake', 'LATEST.json'), 'utf-8');
      const latestMd = readFileSync(path.join(workspaceRoot, '.planning', 'intake', 'LATEST.md'), 'utf-8');
      const sessionContext = readFileSync(result.sessionContextPath, 'utf-8');

      expect(latestJson).toContain(result.manifest.paths.sessionContext);
      expect(latestMd).toContain(result.manifest.title);
      expect(sessionContext).toContain('Goal: Bootstrap start flow');
      expect(result.manifest.paths.bundleDir).toContain('.planning/intake/');
      expect(result.manifest.paths.agentBrief).toContain('AGENT-BRIEF.md');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
