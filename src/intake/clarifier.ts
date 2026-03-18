import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ComplexityScore, PendingGoal, RawGoal } from './types.js';
import { runAgent } from '../agent-runner.js';

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

  await writePendingGoal(workspaceRoot, pending);

  return { action: 'pending', draftSpec, questions };
}

