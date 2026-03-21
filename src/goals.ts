import { readFile, writeFile } from 'node:fs/promises';
import { validateGoalsFile, parseGoalsFile } from './goals-parser.js';
import type { GoalRoute } from './goal-metadata.js';

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
  route?: GoalRoute;
  contextBundlePath?: string;
  sessionContextPath?: string;
  agentBriefPath?: string;
  successCriteria?: string[];
  description?: string;
}

/** Re-export for tests that assert on parse warnings. */
export type { ParseWarning } from './goals-parser.js';
import type { ParsedGoal } from './goals-parser.js';

export interface ParseGoalsResult {
  goals: Goal[];
  warnings: import('./goals-parser.js').ParseWarning[];
}

function mapParsedToGoals(parsed: ParsedGoal[]): Goal[] {
  return parsed.map((p) => {
    const withAnnotations = applyAnnotations({
      title: p.title,
      status: p.status,
      raw: p.raw,
    });
    return {
      ...withAnnotations,
      metadataBlock: p.metadataBlock,
      successCriteria: p.successCriteria,
      description: p.description,
      route: p.route,
      contextBundlePath: p.contextBundlePath,
      sessionContextPath: p.sessionContextPath,
      agentBriefPath: p.agentBriefPath,
    };
  });
}

/**
 * Strict parser: delegates to goals-parser; returns goals and warnings for tests.
 */
export function parseGoals(markdown: string): ParseGoalsResult {
  const { goals: parsed, warnings } = parseGoalsFile(markdown);
  return { goals: mapParsedToGoals(parsed), warnings };
}

export interface LoadGoalsOptions {
  /** When provided, parse warnings are logged at warn level with line numbers. */
  logger?: import('./logger.js').Logger;
}

export async function loadGoals(
  filePath: string,
  options?: LoadGoalsOptions,
): Promise<Goal[]> {
  let parsed;
  try {
    parsed = await validateGoalsFile(filePath);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Goals file not found: ${filePath}`);
    }
    throw err;
  }

  if (parsed.goals.length === 0) return [];

  const goals = mapParsedToGoals(parsed.goals);
  const logWarn = options?.logger ? (msg: string) => options.logger!.warn(msg) : () => {};
  for (const w of parsed.warnings) {
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
