import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { RawGoal } from './types.js';
import { runAgent } from '../agent-runner.js';

export interface ComplexityScore {
  score: 1 | 2 | 3 | 4 | 5;
  reasoning: string;
  suggestedQuestions: string[];
}

export interface PendingGoal {
  id: string;
  raw: RawGoal;
  complexity: ComplexityScore;
  draftSpec: string;
  expiresAt: string;
}

export const DEFAULT_CLASSIFIER_MODEL = 'cursor' as const;

export interface ClassifierAgentConfig {
  agentPath?: string;
  model?: string;
  timeoutMs?: number;
}

function wordCount(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function extractFilenames(title: string): string[] {
  const re = /\b[\w./-]+?\.(ts|js|css|md)\b/gi;
  return title.match(re) ?? [];
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

export async function classifyGoal(
  raw: RawGoal,
  agentConfig?: ClassifierAgentConfig,
): Promise<ComplexityScore> {
  const title = raw.title;
  const body = raw.body ?? '';
  const titleWords = wordCount(title);
  const bodyWords = raw.body ? wordCount(raw.body) : 0;

  if (
    includesAny(title, [
      'new project',
      'from scratch',
      'full rewrite',
      'architecture',
      'redesign entire',
    ])
  ) {
    return {
      score: 5,
      reasoning: 'large project scope',
      suggestedQuestions: [],
    };
  }

  if (includesAny(title, ['refactor', 'redesign', 'multiple systems', 'integrate'])) {
    return {
      score: 4,
      reasoning: 'multi-system refactor scope',
      suggestedQuestions: [],
    };
  }

  const filenames = extractFilenames(title);
  if (filenames.length === 1 && titleWords < 30) {
    return {
      score: 2,
      reasoning: 'single file change scope',
      suggestedQuestions: [],
    };
  }

  const hasScopeKeywords = includesAny(title, [
    'refactor',
    'redesign',
    'integrate',
    'multiple systems',
    'new project',
    'from scratch',
    'full rewrite',
    'architecture',
    'redesign entire',
  ]);

  const bodyWordOk = raw.body == null ? true : bodyWords < 15;
  const noScope = !hasScopeKeywords && filenames.length === 0;
  if (bodyWordOk && noScope && titleWords <= 4) {
    return {
      score: 1,
      reasoning: 'tiny fix scope',
      suggestedQuestions: [],
    };
  }

  const goalTitle = title;
  const prompt = `Considering the current project, what do we need to seamlessly and efficiently implement ${goalTitle}?

Respond with JSON only, no prose:
{
  "score": <1-5 integer>,
  "reasoning": "<one sentence>",
  "suggestedQuestions": ["<question if score >= 3>"]
}

Score guide: 1=tiny fix, 2=single file change, 3=moderate feature, 4=multi-system change, 5=large project.`;

  const result = (await runAgent({
    agentPath: agentConfig?.agentPath ?? 'cursor-agent',
    workspace: raw.projectPath,
    prompt,
    timeoutMs: agentConfig?.timeoutMs,
    model: agentConfig?.model ?? DEFAULT_CLASSIFIER_MODEL,
  } as any)) as any;

  const success = typeof result?.success === 'boolean' ? result.success : Boolean(result?.output);
  const output: unknown = result?.output ?? result?.resultEvent?.result;

  if (!success || typeof output !== 'string') {
    return { score: 3, reasoning: 'classifier unavailable', suggestedQuestions: [] };
  }

  try {
    const parsed = JSON.parse(output) as Partial<ComplexityScore> & { score?: number };
    const scoreNum = parsed.score;
    const score = scoreNum as ComplexityScore['score'];
    if (![1, 2, 3, 4, 5].includes(scoreNum as number)) {
      return { score: 3, reasoning: 'classifier unavailable', suggestedQuestions: [] };
    }
    return {
      score,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : [],
    };
  } catch {
    return { score: 3, reasoning: 'classifier unavailable', suggestedQuestions: [] };
  }
}

export type ClarifyAction =
  | { action: 'queued' }
  | { action: 'pending'; draftSpec: string; questions: string[] };

function pendingGoalsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.gsd', 'pending-goals.json');
}

export async function readPendingGoals(workspaceRoot: string): Promise<PendingGoal[]> {
  const filePath = pendingGoalsPath(workspaceRoot);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as PendingGoal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePendingGoalsFile(workspaceRoot: string, goals: PendingGoal[]): Promise<void> {
  const dir = join(workspaceRoot, '.gsd');
  await mkdir(dir, { recursive: true });
  await writeFile(pendingGoalsPath(workspaceRoot), JSON.stringify(goals, null, 2), 'utf-8');
}

export async function writePendingGoal(workspaceRoot: string, goal: PendingGoal): Promise<void> {
  const existing = await readPendingGoals(workspaceRoot);
  existing.push(goal);
  await writePendingGoalsFile(workspaceRoot, existing);
}

export async function resolvePendingGoal(workspaceRoot: string, id: string): Promise<void> {
  const existing = await readPendingGoals(workspaceRoot);
  const next = existing.filter((g) => g.id !== id);
  await writePendingGoalsFile(workspaceRoot, next);
}

export async function expirePendingGoals(workspaceRoot: string): Promise<void> {
  const existing = await readPendingGoals(workspaceRoot);
  const now = Date.now();
  const next = existing.filter((g) => {
    const t = new Date(g.expiresAt).getTime();
    if (Number.isNaN(t)) return false;
    return t > now;
  });
  await writePendingGoalsFile(workspaceRoot, next);
}

export async function clarifyGoal(
  rawGoal: RawGoal,
  complexity: ComplexityScore,
  workspaceRoot: string,
  agentConfig?: { agentPath?: string; model?: string; timeoutMs?: number },
  options?: { persistPending?: boolean },
): Promise<ClarifyAction> {
  if (complexity.score <= 2) {
    return { action: 'queued' };
  }

  const title = rawGoal.title;
  const bodyPart = rawGoal.body ? ` ${rawGoal.body}` : '';
  const prompt = `Pre-fill a goal spec for this software task in the current project: ${title}.${bodyPart}

Respond with JSON only:
{
  "draftSpec": "<2-3 sentences: what will be built and success criteria>",
  "questions": ["<1 question for score 3, 2-3 for score 4-5>"]
}`;

  const result = (await runAgent({
    agentPath: agentConfig?.agentPath ?? 'cursor-agent',
    workspace: workspaceRoot,
    prompt,
    timeoutMs: agentConfig?.timeoutMs,
    model: agentConfig?.model,
  } as any)) as any;

  const success = typeof result?.success === 'boolean' ? result.success : Boolean(result?.output);
  const output: unknown = result?.output ?? result?.resultEvent?.result;
  if (!success || typeof output !== 'string') {
    // If the agent is unavailable, degrade to queued flow.
    return { action: 'pending', draftSpec: '', questions: [] };
  }

  let draftSpec = '';
  let questions: string[] = [];
  try {
    const parsed = JSON.parse(output) as { draftSpec?: string; questions?: string[] };
    draftSpec = typeof parsed.draftSpec === 'string' ? parsed.draftSpec : '';
    questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  } catch {
    draftSpec = '';
    questions = [];
  }

  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  const pending: PendingGoal = {
    id: randomUUID(),
    raw: rawGoal,
    complexity,
    draftSpec,
    expiresAt,
  };

  if (options?.persistPending !== false) {
    await writePendingGoal(workspaceRoot, pending);
  }

  return { action: 'pending', draftSpec, questions };
}
