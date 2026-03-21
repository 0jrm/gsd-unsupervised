import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { syncUpstreamGsd } from './gsd-sync.js';

function writeFixtureUpstream(root: string, contentSuffix: string): void {
  mkdirSync(path.join(root, 'commands', 'gsd'), { recursive: true });
  mkdirSync(path.join(root, 'get-shit-done', 'workflows'), { recursive: true });
  mkdirSync(path.join(root, 'agents'), { recursive: true });

  writeFileSync(
    path.join(root, 'commands', 'gsd', 'help.md'),
    `# /gsd:help\n\nfixture ${contentSuffix}\n`,
    'utf-8',
  );
  writeFileSync(
    path.join(root, 'commands', 'gsd', 'quick.md'),
    `# /gsd:quick\n\nfixture ${contentSuffix}\n`,
    'utf-8',
  );
  writeFileSync(
    path.join(root, 'get-shit-done', 'workflows', 'help.md'),
    `workflow ${contentSuffix}\n`,
    'utf-8',
  );
  writeFileSync(
    path.join(root, 'agents', 'gsd-executor.md'),
    `agent ${contentSuffix}\n`,
    'utf-8',
  );
}

describe('gsd-sync', () => {
  it('installs upstream command skills for cursor and codex on first sync', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'gsd-sync-workspace-'));
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'gsd-sync-source-'));
    writeFixtureUpstream(sourceRoot, 'v1');

    try {
      const result = await syncUpstreamGsd({
        workspaceRoot,
        runtimes: ['cursor', 'codex'],
        sourceDir: sourceRoot,
        repoSha: 'abc123',
      });

      expect(result.changed).toBe(true);
      expect(existsSync(path.join(workspaceRoot, '.cursor', 'skills', 'gsd-help', 'SKILL.md'))).toBe(true);
      expect(existsSync(path.join(workspaceRoot, '.codex', 'skills', 'gsd-quick', 'SKILL.md'))).toBe(true);
      expect(existsSync(path.join(workspaceRoot, '.cursor', 'get-shit-done', 'workflows', 'help.md'))).toBe(true);
      expect(existsSync(path.join(workspaceRoot, '.codex', 'gsd-agents', 'gsd-executor.md'))).toBe(true);
      expect(result.manifest.repoSha).toBe('abc123');
      expect(result.manifest.runtimes.cursor.installedSkills).toContain('gsd-help');
      expect(result.manifest.runtimes.codex.installedSkills).toContain('gsd-quick');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('refreshes managed assets when the upstream sha changes', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'gsd-sync-workspace-'));
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'gsd-sync-source-'));
    writeFixtureUpstream(sourceRoot, 'v1');

    try {
      await syncUpstreamGsd({
        workspaceRoot,
        runtimes: ['cursor', 'codex'],
        sourceDir: sourceRoot,
        repoSha: 'abc123',
      });

      writeFixtureUpstream(sourceRoot, 'v2');
      const result = await syncUpstreamGsd({
        workspaceRoot,
        runtimes: ['cursor', 'codex'],
        sourceDir: sourceRoot,
        repoSha: 'def456',
      });

      const cursorHelp = readFileSync(
        path.join(workspaceRoot, '.cursor', 'skills', 'gsd-help', 'SKILL.md'),
        'utf-8',
      );
      expect(result.changed).toBe(true);
      expect(result.manifest.repoSha).toBe('def456');
      expect(cursorHelp).toContain('fixture v2');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('returns a no-op result when the synced sha and runtimes already match', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'gsd-sync-workspace-'));
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'gsd-sync-source-'));
    writeFixtureUpstream(sourceRoot, 'v1');

    try {
      await syncUpstreamGsd({
        workspaceRoot,
        runtimes: ['cursor', 'codex'],
        sourceDir: sourceRoot,
        repoSha: 'abc123',
      });

      const result = await syncUpstreamGsd({
        workspaceRoot,
        runtimes: ['cursor', 'codex'],
        sourceDir: sourceRoot,
        repoSha: 'abc123',
      });

      expect(result.changed).toBe(false);
      expect(result.manifest.repoSha).toBe('abc123');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});
