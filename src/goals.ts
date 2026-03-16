import { readFile } from 'node:fs/promises';

export interface Goal {
  title: string;
  status: 'pending' | 'in_progress' | 'done';
  raw: string;
}

type GoalStatus = Goal['status'];

const SECTION_MAP: Record<string, GoalStatus> = {
  '## pending': 'pending',
  '## in progress': 'in_progress',
  '## done': 'done',
};

const CHECKBOX_RE = /^- \[([ xX])\]\s+(.+)$/;

export function parseGoals(markdown: string): Goal[] {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const goals: Goal[] = [];
  let currentStatus: GoalStatus | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (SECTION_MAP[lower] !== undefined) {
      currentStatus = SECTION_MAP[lower];
      continue;
    }

    if (currentStatus === null) continue;

    const match = trimmed.match(CHECKBOX_RE);
    if (!match) continue;

    const title = match[2].trim();
    goals.push({ title, status: currentStatus, raw: trimmed });
  }

  return goals;
}

export async function loadGoals(filePath: string): Promise<Goal[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Goals file not found: ${filePath}`);
    }
    throw err;
  }

  if (content.trim().length === 0) return [];

  const goals = parseGoals(content);

  if (getPendingGoals(goals).length === 0) {
    console.warn(`Warning: no pending goals found in ${filePath}`);
  }

  return goals;
}

export function getPendingGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => g.status === 'pending');
}
