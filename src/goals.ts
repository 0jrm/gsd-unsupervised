import { readFile } from 'node:fs/promises';

export interface Goal {
  title: string;
  status: 'pending' | 'in_progress' | 'done';
  raw: string;
  /**
   * Optional parallelization metadata parsed from annotations in the raw
   * markdown line. These fields are purely advisory and are interpreted by
   * the execution planner in the daemon.
   */
  parallelGroup?: string | null;
  dependsOn?: string[];
  priority?: number;
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
    const annotated = applyAnnotations({
      title,
      status: currentStatus,
      raw: trimmed,
    });
    goals.push(annotated);
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

/**
 * Lightweight annotation grammar for goals:
 *
 *   - [ ] Title text [group:alpha] [after:beta,gamma] [priority:1]
 *
 * The bracketed tokens can appear anywhere in the line; they are stripped
 * from the human-readable title but preserved as structured metadata.
 */
function applyAnnotations(base: Goal): Goal {
  const GROUP_RE = /\[group:([^[\]]+)\]/i;
  const AFTER_RE = /\[after:([^[\]]+)\]/i;
  const PRIORITY_RE = /\[priority:(\d+)\]/i;

  let title = base.title;
  let parallelGroup: string | null | undefined;
  let dependsOn: string[] | undefined;
  let priority: number | undefined;

  const groupMatch = title.match(GROUP_RE);
  if (groupMatch) {
    parallelGroup = groupMatch[1].trim();
    title = title.replace(GROUP_RE, '').trim();
  }

  const afterMatch = title.match(AFTER_RE);
  if (afterMatch) {
    dependsOn = afterMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    title = title.replace(AFTER_RE, '').trim();
  }

  const priorityMatch = title.match(PRIORITY_RE);
  if (priorityMatch) {
    const p = Number.parseInt(priorityMatch[1], 10);
    if (Number.isFinite(p)) {
      priority = p;
    }
    title = title.replace(PRIORITY_RE, '').trim();
  }

  return {
    ...base,
    title,
    parallelGroup,
    dependsOn,
    priority,
  };
}

export interface ExecutionPlanItem {
  goal: Goal;
  parallelGroup?: string | null;
  dependsOn: string[];
  priority: number;
}

export interface ExecutionPlan {
  /** Flattened list of goals in execution order. */
  ordered: Goal[];
  /** Grouped view for potential future parallel scheduling. */
  items: ExecutionPlanItem[];
}

export function buildExecutionPlan(goals: Goal[]): ExecutionPlan {
  // For now we keep semantics simple and stable: sort by explicit numeric
  // priority (ascending), then by original order as tiebreaker. This is
  // sufficient for initial parallelization-planner skill while remaining
  // backwards-compatible for existing goal queues.
  const itemsWithIndex = goals.map((goal, index) => ({
    goal,
    parallelGroup: goal.parallelGroup ?? null,
    dependsOn: goal.dependsOn ?? [],
    priority: Number.isFinite(goal.priority ?? NaN)
      ? (goal.priority as number)
      : Number.MAX_SAFE_INTEGER,
    index,
  }));

  itemsWithIndex.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.index - b.index;
  });

  return {
    ordered: itemsWithIndex.map((i) => i.goal),
    items: itemsWithIndex.map(({ index, ...rest }) => rest),
  };
}
