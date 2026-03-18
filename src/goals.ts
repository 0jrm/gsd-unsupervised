import { readFile, writeFile } from 'node:fs/promises';

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
  /** Optional metadata block (e.g. ### section) that immediately followed this goal line. */
  metadataBlock?: string;
}

/** A line that was skipped during parsing (not a checkbox goal). */
export interface ParseWarning {
  lineNumber: number;
  line: string;
  reason: string;
}

type GoalStatus = Goal['status'];

const SECTION_MAP: Record<string, GoalStatus> = {
  '## pending': 'pending',
  '## in progress': 'in_progress',
  '## done': 'done',
};

/** Only lines matching this are treated as executable goals. */
const CHECKBOX_RE = /^- \[([ xX])\]\s+(.+)$/;

export interface ParseGoalsResult {
  goals: Goal[];
  warnings: ParseWarning[];
}

/**
 * Strict parser: only lines matching `- [ ]` or `- [x]` are goals. Section headers (## pending, etc.)
 * set current section. All other non-blank lines in a section are recorded as ParseWarning.
 * A `###` line immediately following a checkbox goal is attached to that goal as metadataBlock.
 */
export function parseGoals(markdown: string): ParseGoalsResult {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const goals: Goal[] = [];
  const warnings: ParseWarning[] = [];
  let currentStatus: GoalStatus | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (SECTION_MAP[lower] !== undefined) {
      currentStatus = SECTION_MAP[lower];
      continue;
    }

    if (trimmed === '') continue;

    if (currentStatus === null) {
      warnings.push({
        lineNumber,
        line: trimmed,
        reason: 'outside any section (## Pending, ## In Progress, ## Done); skipped',
      });
      continue;
    }

    const match = trimmed.match(CHECKBOX_RE);
    if (match) {
      const title = match[2].trim();
      const annotated = applyAnnotations({
        title,
        status: currentStatus,
        raw: trimmed,
      });
      // Peek next line for ### metadata block
      if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next.startsWith('###')) {
          annotated.metadataBlock = next;
          i++; // consume the ### line so we don't warn on it
        }
      }
      goals.push(annotated);
      continue;
    }

    warnings.push({
      lineNumber,
      line: trimmed,
      reason: 'not a checkbox line (- [ ] or - [x]); skipped',
    });
  }

  return { goals, warnings };
}

export interface LoadGoalsOptions {
  /** When provided, parse warnings are logged at warn level with line numbers. */
  logger?: import('./logger.js').Logger;
}

export async function loadGoals(
  filePath: string,
  options?: LoadGoalsOptions,
): Promise<Goal[]> {
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

  const { goals, warnings } = parseGoals(content);

  const logWarn = options?.logger ? (msg: string) => options.logger!.warn(msg) : (msg: string) => console.warn(msg);
  for (const w of warnings) {
    logWarn(
      `goals.md:${w.lineNumber} skipped: ${w.reason} — "${w.line.slice(0, 60)}${w.line.length > 60 ? '...' : ''}"`,
    );
  }

  if (getPendingGoals(goals).length === 0) {
    logWarn(`Warning: no pending goals found in ${filePath}`);
  }

  return goals;
}

export function getPendingGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => g.status === 'pending');
}

/**
 * Appends a new pending goal to goals.md (under ## Pending).
 * Used by webhook and hot-reload merge; does not deduplicate.
 */
export async function appendPendingGoal(
  goalsPath: string,
  title: string,
  priority?: number,
): Promise<void> {
  const content = await readFile(goalsPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const pendingHeader = '## pending';
  let insertIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === pendingHeader) {
      insertIndex = i + 1;
      break;
    }
  }
  if (insertIndex < 0) {
    throw new Error(`Goals file missing "${pendingHeader}" section: ${goalsPath}`);
  }
  const suffix = Number.isFinite(priority) ? ` [priority:${priority}]` : '';
  const newLine = `- [ ] ${title}${suffix}`;
  lines.splice(insertIndex, 0, newLine);
  await writeFile(goalsPath, lines.join('\n'), 'utf-8');
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
  // Prioritization: sort by explicit [priority:N] (asc), then by original order.
  // parallelGroup and dependsOn are exposed on items but are not used by the
  // daemon for scheduling — goals are always processed one at a time in this order.
  // For now we keep semantics simple and stable; backwards-compatible for existing queues.
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
