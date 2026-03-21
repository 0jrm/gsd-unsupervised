import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const execFileP = promisify(execFile);

export type SyncRuntime = 'cursor' | 'codex';

export interface UpstreamSyncManifest {
  repoUrl: string;
  repoSha: string;
  syncedAt: string;
  runtimes: Record<SyncRuntime, { installedSkills: string[] }>;
}

export interface SyncUpstreamGsdOptions {
  workspaceRoot: string;
  runtimes: SyncRuntime[];
  repoUrl?: string;
  sourceDir?: string;
  repoSha?: string;
}

export interface SyncUpstreamGsdResult {
  manifest: UpstreamSyncManifest;
  changed: boolean;
  cacheDir: string;
}

export const DEFAULT_GSD_REPO_URL = 'https://github.com/gsd-build/get-shit-done.git';

function upstreamRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.gsd', 'upstream');
}

function upstreamCacheDir(workspaceRoot: string): string {
  return path.join(upstreamRoot(workspaceRoot), 'get-shit-done');
}

function manifestPath(workspaceRoot: string): string {
  return path.join(upstreamRoot(workspaceRoot), 'manifest.json');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readExistingManifest(workspaceRoot: string): Promise<UpstreamSyncManifest | null> {
  try {
    const raw = await readFile(manifestPath(workspaceRoot), 'utf-8');
    return JSON.parse(raw) as UpstreamSyncManifest;
  } catch {
    return null;
  }
}

async function ensureRepoCache(workspaceRoot: string, repoUrl: string): Promise<{ cacheDir: string; repoSha: string }> {
  const cacheDir = upstreamCacheDir(workspaceRoot);
  await mkdir(upstreamRoot(workspaceRoot), { recursive: true });

  if (!(await pathExists(path.join(cacheDir, '.git')))) {
    await rm(cacheDir, { recursive: true, force: true });
    await execFileP('git', ['clone', '--depth', '1', repoUrl, cacheDir], {
      cwd: workspaceRoot,
    });
  } else {
    await execFileP('git', ['-C', cacheDir, 'fetch', '--depth', '1', 'origin', 'main'], {
      cwd: workspaceRoot,
    });
    await execFileP('git', ['-C', cacheDir, 'checkout', '--detach', 'FETCH_HEAD'], {
      cwd: workspaceRoot,
    });
  }

  const { stdout } = await execFileP('git', ['-C', cacheDir, 'rev-parse', 'HEAD'], {
    cwd: workspaceRoot,
    encoding: 'utf-8',
  });

  return { cacheDir, repoSha: stdout.trim() };
}

async function listCommandFiles(srcDir: string, prefix = ''): Promise<Array<{ name: string; srcPath: string }>> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  const collected: Array<{ name: string; srcPath: string }> = [];

  for (const entry of entries) {
    const entryPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      const nestedPrefix = prefix ? `${prefix}-${entry.name}` : entry.name;
      collected.push(...(await listCommandFiles(entryPath, nestedPrefix)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const baseName = entry.name.replace(/\.md$/i, '');
    const skillName = prefix ? `${prefix}-${baseName}` : baseName;
    collected.push({
      name: `gsd-${skillName}`,
      srcPath: entryPath,
    });
  }

  return collected.sort((a, b) => a.name.localeCompare(b.name));
}

async function installCommandSkills(options: {
  workspaceRoot: string;
  runtime: SyncRuntime;
  commandsDir: string;
  previousSkills: string[];
}): Promise<string[]> {
  const { workspaceRoot, runtime, commandsDir, previousSkills } = options;
  const skillsDir = path.join(workspaceRoot, runtime === 'cursor' ? '.cursor' : '.codex', 'skills');
  await mkdir(skillsDir, { recursive: true });

  for (const skillName of previousSkills) {
    await rm(path.join(skillsDir, skillName), { recursive: true, force: true });
  }

  const commands = await listCommandFiles(commandsDir);
  for (const command of commands) {
    const skillDir = path.join(skillsDir, command.name);
    await rm(skillDir, { recursive: true, force: true });
    await mkdir(skillDir, { recursive: true });
    const content = await readFile(command.srcPath, 'utf-8');
    await writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  }

  return commands.map((command) => command.name);
}

async function installSupportTree(options: {
  workspaceRoot: string;
  runtime: SyncRuntime;
  sourceDir: string;
}): Promise<void> {
  const { workspaceRoot, runtime, sourceDir } = options;
  const runtimeRoot = path.join(workspaceRoot, runtime === 'cursor' ? '.cursor' : '.codex');

  await mkdir(runtimeRoot, { recursive: true });
  await rm(path.join(runtimeRoot, 'get-shit-done'), { recursive: true, force: true });
  await cp(path.join(sourceDir, 'get-shit-done'), path.join(runtimeRoot, 'get-shit-done'), {
    recursive: true,
  });

  if (runtime === 'codex') {
    await rm(path.join(runtimeRoot, 'gsd-agents'), { recursive: true, force: true });
    await cp(path.join(sourceDir, 'agents'), path.join(runtimeRoot, 'gsd-agents'), {
      recursive: true,
    });
  }
}

export async function syncUpstreamGsd(options: SyncUpstreamGsdOptions): Promise<SyncUpstreamGsdResult> {
  const {
    workspaceRoot,
    runtimes,
    repoUrl = DEFAULT_GSD_REPO_URL,
    sourceDir,
    repoSha: explicitRepoSha,
  } = options;

  const previousManifest = await readExistingManifest(workspaceRoot);
  const resolved = sourceDir
    ? {
        cacheDir: sourceDir,
        repoSha: explicitRepoSha ?? 'local-source',
      }
    : await ensureRepoCache(workspaceRoot, repoUrl);
  const normalizedSourceDir = resolved.cacheDir;

  const unchanged =
    previousManifest != null &&
    previousManifest.repoUrl === repoUrl &&
    previousManifest.repoSha === resolved.repoSha &&
    runtimes.every((runtime) => previousManifest.runtimes[runtime] != null);

  if (unchanged) {
    return {
      manifest: previousManifest!,
      changed: false,
      cacheDir: normalizedSourceDir,
    };
  }

  const commandsDir = path.join(normalizedSourceDir, 'commands', 'gsd');
  const nextRuntimes: UpstreamSyncManifest['runtimes'] = {
    cursor: { installedSkills: [] },
    codex: { installedSkills: [] },
  };

  for (const runtime of runtimes) {
    const previousSkills = previousManifest?.runtimes[runtime]?.installedSkills ?? [];
    await installSupportTree({
      workspaceRoot,
      runtime,
      sourceDir: normalizedSourceDir,
    });
    const installedSkills = await installCommandSkills({
      workspaceRoot,
      runtime,
      commandsDir,
      previousSkills,
    });
    nextRuntimes[runtime] = { installedSkills };
  }

  const manifest: UpstreamSyncManifest = {
    repoUrl,
    repoSha: resolved.repoSha,
    syncedAt: new Date().toISOString(),
    runtimes: nextRuntimes,
  };

  await mkdir(upstreamRoot(workspaceRoot), { recursive: true });
  await writeFile(manifestPath(workspaceRoot), JSON.stringify(manifest, null, 2), 'utf-8');

  return {
    manifest,
    changed: true,
    cacheDir: normalizedSourceDir,
  };
}
