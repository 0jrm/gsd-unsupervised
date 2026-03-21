import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GoalRoute } from '../goal-metadata.js';
import type { SyncRuntime, UpstreamSyncManifest } from '../gsd-sync.js';
import type { ComplexityScore } from './clarifier.js';
import type { RawGoal } from './types.js';

export interface IntakeBundleManifest {
  id: string;
  title: string;
  source: RawGoal['source'];
  route: GoalRoute;
  runtimes: SyncRuntime[];
  receivedAt: string;
  createdAt: string;
  complexity: ComplexityScore;
  draftSpec: string;
  clarifiedSpec: string;
  paths: {
    bundleDir: string;
    request: string;
    firstPrinciples: string;
    standards: string;
    sessionContext: string;
    agentBrief: string;
  };
  upstream?: Pick<UpstreamSyncManifest, 'repoUrl' | 'repoSha' | 'syncedAt'>;
}

export interface IntakeBundleResult {
  bundleDir: string;
  relativeBundleDir: string;
  requestPath: string;
  firstPrinciplesPath: string;
  standardsPath: string;
  sessionContextPath: string;
  agentBriefPath: string;
  manifest: IntakeBundleManifest;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'goal';
}

function stamp(date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function toWorkspaceRelative(workspaceRoot: string, targetPath: string): string {
  const relative = path.relative(workspaceRoot, targetPath);
  return relative.split(path.sep).join('/');
}

async function readPackageSummary(workspaceRoot: string): Promise<string | null> {
  const packagePath = path.join(workspaceRoot, 'package.json');
  if (!existsSync(packagePath)) return null;

  try {
    const raw = await readFile(packagePath, 'utf-8');
    const parsed = JSON.parse(raw) as { name?: string; type?: string; scripts?: Record<string, string> };
    const name = parsed.name ? `Package: ${parsed.name}` : 'Package: unknown';
    const moduleType = parsed.type ? `Module type: ${parsed.type}` : 'Module type: unspecified';
    const scripts = parsed.scripts
      ? `Scripts: ${Object.keys(parsed.scripts).sort().join(', ')}`
      : 'Scripts: none';
    return [name, moduleType, scripts].join('\n');
  } catch {
    return null;
  }
}

async function buildStandardsContent(options: {
  workspaceRoot: string;
  runtimes: SyncRuntime[];
  route: GoalRoute;
  upstream?: Pick<UpstreamSyncManifest, 'repoUrl' | 'repoSha' | 'syncedAt'>;
}): Promise<string> {
  const { workspaceRoot, runtimes, route, upstream } = options;
  const packageSummary = await readPackageSummary(workspaceRoot);
  const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
  const repoNotes = [
    '# Standards',
    '',
    '## Repo Conventions',
    '- Honor `AGENTS.md` as the primary local command and workflow contract.',
    '- Keep `goals.md` as the queue of record; use `.planning/intake/` for durable context breadcrumbs.',
    '- Run `npm run build` before `npm test` when validating code changes.',
    '',
    '## Runtime Scope',
    `- Supported by this intake flow: ${runtimes.join(', ')}`,
    '- Continue CLI (`cn`) is intentionally not part of this first-pass breadcrumb guarantee.',
    `- Default route for this goal: ${route}`,
    '',
    '## Upstream GSD',
    `- Repo: ${upstream?.repoUrl ?? 'not-synced'}`,
    `- Ref: ${upstream?.repoSha ?? 'unknown'}`,
    `- Synced at: ${upstream?.syncedAt ?? 'unknown'}`,
    '',
    '## Local References',
    `- AGENTS.md: ${existsSync(agentsPath) ? 'present' : 'missing'}`,
    '- Cursor overlay: `.cursor/rules/gsd-intake-bridge.mdc`',
    '- Codex overlay: `.codex/skills/gsd-session-context/SKILL.md`',
  ];

  if (packageSummary) {
    repoNotes.push('', '## Package Summary', '```text', packageSummary, '```');
  }

  return repoNotes.join('\n') + '\n';
}

export async function createIntakeBundle(options: {
  workspaceRoot: string;
  rawGoal: RawGoal;
  complexity: ComplexityScore;
  route: GoalRoute;
  runtimes: SyncRuntime[];
  draftSpec?: string;
  clarifiedSpec?: string;
  upstream?: Pick<UpstreamSyncManifest, 'repoUrl' | 'repoSha' | 'syncedAt'>;
}): Promise<IntakeBundleResult> {
  const {
    workspaceRoot,
    rawGoal,
    complexity,
    route,
    runtimes,
    draftSpec = '',
    clarifiedSpec = draftSpec || rawGoal.body || rawGoal.title,
    upstream,
  } = options;

  const intakeRoot = path.join(workspaceRoot, '.planning', 'intake');
  await mkdir(intakeRoot, { recursive: true });

  const id = `${stamp()}-${slugify(rawGoal.title)}`;
  const bundleDir = path.join(intakeRoot, id);
  await mkdir(bundleDir, { recursive: true });

  const requestPath = path.join(bundleDir, 'REQUEST.md');
  const firstPrinciplesPath = path.join(bundleDir, 'FIRST-PRINCIPLES.md');
  const standardsPath = path.join(bundleDir, 'STANDARDS.md');
  const sessionContextPath = path.join(bundleDir, 'SESSION-CONTEXT.md');
  const agentBriefPath = path.join(bundleDir, 'AGENT-BRIEF.md');
  const relativeBundleDir = toWorkspaceRelative(workspaceRoot, bundleDir);

  const requestContent = [
    '# Request',
    '',
    `- Title: ${rawGoal.title}`,
    `- Source: ${rawGoal.source}`,
    `- Received: ${rawGoal.receivedAt}`,
    `- Route: ${route}`,
    '',
    '## Raw Input',
    rawGoal.body?.trim() ? rawGoal.body.trim() : '(No extra details supplied.)',
    '',
    '## Draft Spec',
    draftSpec || '(No classifier draft available.)',
    '',
    '## Clarified Spec',
    clarifiedSpec || '(No clarified spec captured.)',
    '',
  ].join('\n');

  const firstPrinciplesContent = [
    '# First Principles',
    '',
    `- Desired outcome: ${clarifiedSpec || rawGoal.title}`,
    `- Complexity score: ${complexity.score}`,
    `- Reasoning: ${complexity.reasoning}`,
    `- Route choice: ${route}`,
    '',
    '## Constraints',
    '- Preserve the existing daemon, queue, and session-log behavior unless the task explicitly changes them.',
    '- Prefer durable file breadcrumbs over transient chat context.',
    '- Keep the goal executable by fresh sessions and spawned agents.',
    '',
    '## Non-Negotiables',
    '- `goals.md` remains authoritative for queueing.',
    '- The intake bundle must be enough to resume or delegate work later.',
    '- Cursor and Codex are the only guaranteed runtimes for this flow.',
    '',
  ].join('\n');

  const standardsContent = await buildStandardsContent({
    workspaceRoot,
    runtimes,
    route,
    upstream,
  });

  const sessionContextContent = [
    '# Session Context',
    '',
    `Goal: ${rawGoal.title}`,
    `Route: ${route}`,
    `Bundle: ${relativeBundleDir}`,
    '',
    '## Summary',
    clarifiedSpec || rawGoal.title,
    '',
    '## Required Reads',
    '- `REQUEST.md`',
    '- `FIRST-PRINCIPLES.md`',
    '- `STANDARDS.md`',
    '',
    '## Runtime Breadcrumbs',
    '- The stable pointer for this bundle is `.planning/intake/LATEST.json`.',
    '- Fresh agent sessions should begin with `AGENT-BRIEF.md`.',
    '- Use `SESSION-CONTEXT.md` for the full local context when the brief is insufficient.',
    '',
    '## Suggested Routing',
    route === 'quick'
      ? '- Use quick mode for this task unless new complexity is discovered.'
      : '- Use the full lifecycle for this task; do not collapse it into quick mode without re-evaluating scope.',
    '',
  ].join('\n');

  const agentBriefContent = [
    '# Agent Brief',
    '',
    `Goal: ${rawGoal.title}`,
    `Route: ${route}`,
    '',
    'Start here:',
    '- Read `REQUEST.md` for the request and clarified scope.',
    '- Read `FIRST-PRINCIPLES.md` for constraints and invariants.',
    '- Read `STANDARDS.md` for repo and runtime expectations.',
    '',
    'Escalate to `SESSION-CONTEXT.md` only if you need full context.',
    '',
  ].join('\n');

  const manifest: IntakeBundleManifest = {
    id,
    title: rawGoal.title,
    source: rawGoal.source,
    route,
    runtimes,
    receivedAt: rawGoal.receivedAt,
    createdAt: new Date().toISOString(),
    complexity,
    draftSpec,
    clarifiedSpec,
    paths: {
      bundleDir: relativeBundleDir,
      request: toWorkspaceRelative(workspaceRoot, requestPath),
      firstPrinciples: toWorkspaceRelative(workspaceRoot, firstPrinciplesPath),
      standards: toWorkspaceRelative(workspaceRoot, standardsPath),
      sessionContext: toWorkspaceRelative(workspaceRoot, sessionContextPath),
      agentBrief: toWorkspaceRelative(workspaceRoot, agentBriefPath),
    },
    ...(upstream ? { upstream } : {}),
  };

  await writeFile(requestPath, requestContent, 'utf-8');
  await writeFile(firstPrinciplesPath, firstPrinciplesContent, 'utf-8');
  await writeFile(standardsPath, standardsContent, 'utf-8');
  await writeFile(sessionContextPath, sessionContextContent, 'utf-8');
  await writeFile(agentBriefPath, agentBriefContent, 'utf-8');
  await writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  await writeFile(
    path.join(intakeRoot, 'LATEST.json'),
    JSON.stringify(
      {
        id: manifest.id,
        title: manifest.title,
        route: manifest.route,
        bundleDir: manifest.paths.bundleDir,
        sessionContext: manifest.paths.sessionContext,
        agentBrief: manifest.paths.agentBrief,
        manifest: `${manifest.paths.bundleDir}/manifest.json`,
      },
      null,
      2,
    ),
    'utf-8',
  );
  await writeFile(
    path.join(intakeRoot, 'LATEST.md'),
    [
      '# Latest Intake Bundle',
      '',
      `- Title: ${manifest.title}`,
      `- Route: ${manifest.route}`,
      `- Bundle: ${manifest.paths.bundleDir}`,
      `- Session context: ${manifest.paths.sessionContext}`,
      `- Agent brief: ${manifest.paths.agentBrief}`,
      '',
    ].join('\n'),
    'utf-8',
  );

  return {
    bundleDir,
    relativeBundleDir,
    requestPath,
    firstPrinciplesPath,
    standardsPath,
    sessionContextPath,
    agentBriefPath,
    manifest,
  };
}
