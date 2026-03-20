import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { SessionLogEntry } from './session-log.js';

export interface PhaseInfo {
  number: number;
  name: string;
  description: string;
  dirName: string;
  complete: boolean;
}

export interface PlanInfo {
  phaseNumber: number;
  planNumber: number;
  planPath: string;
  summaryPath: string;
  executionStatus: PlanExecutionStatus;
  executed: boolean;
}

export type PlanExecutionStatus =
  | 'pending'
  | 'done'
  | 'skipped'
  | 'verify-failed'
  | 'crashed'
  | 'timeout';

const PHASE_RE = /^- \[([ xX])\] \*\*Phase (\d+(?:\.\d+)?): (.+?)\*\* — (.+)$/;
const PLAN_FILE_RE = /^(\d+(?:\.\d+)?)-(\d+)-PLAN\.md$/;

function phaseNumberToPrefix(phaseNumber: number): string {
  if (Number.isInteger(phaseNumber)) {
    return String(phaseNumber).padStart(2, '0');
  }
  const [intPart, decPart] = String(phaseNumber).split('.');
  return `${intPart.padStart(2, '0')}.${decPart}`;
}

export async function parseRoadmap(roadmapPath: string): Promise<PhaseInfo[]> {
  let content: string;
  try {
    content = await readFile(roadmapPath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Roadmap file not found: ${roadmapPath}`);
    }
    throw err;
  }

  if (content.trim().length === 0) return [];

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const phases: PhaseInfo[] = [];

  for (const line of lines) {
    const match = line.match(PHASE_RE);
    if (!match) continue;

    const complete = match[1] === 'x' || match[1] === 'X';
    const number = parseFloat(match[2]);
    const name = match[3];
    const description = match[4];
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const dirName = `${phaseNumberToPrefix(number)}-${slug}`;

    phases.push({ number, name, description, dirName, complete });
  }

  phases.sort((a, b) => a.number - b.number);
  return phases;
}

/**
 * Returns the single directory under phasesRoot whose name starts with the phase prefix (e.g. "04-").
 * Throws if more than one directory matches (ambiguous phase prefix).
 */
export function findPhaseDir(phasesRoot: string, phaseNumber: number): string | null {
  if (!existsSync(phasesRoot)) return null;

  const prefix = phaseNumberToPrefix(phaseNumber) + '-';
  let entries: string[];
  try {
    entries = readdirSync(phasesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }

  const matches = entries.filter((name) => name.startsWith(prefix));
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous phase directory: multiple dirs match prefix '${prefix}': ${matches.join(', ')}. ` +
        `Remove the duplicate from .planning/phases/.`,
    );
  }
  return matches.length === 1 ? join(phasesRoot, matches[0]) : null;
}

export async function discoverPlans(
  phaseDir: string,
  executionStatuses?: Map<number, PlanExecutionStatus>,
): Promise<PlanInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(phaseDir);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Phase directory not found: ${phaseDir}`);
    }
    throw err;
  }

  const plans: PlanInfo[] = [];

  for (const entry of entries) {
    const match = entry.match(PLAN_FILE_RE);
    if (!match) continue;

    const phaseNumber = parseFloat(match[1]);
    const planNumber = parseInt(match[2], 10);
    const planPath = join(phaseDir, entry);
    const summaryFile = entry.replace('-PLAN.md', '-SUMMARY.md');
    const summaryPath = join(phaseDir, summaryFile);
    const executionStatus = executionStatuses?.get(planNumber) ?? 'pending';
    const executed = executionStatus !== 'pending';

    plans.push({ phaseNumber, planNumber, planPath, summaryPath, executionStatus, executed });
  }

  plans.sort((a, b) => a.planNumber - b.planNumber);
  return plans;
}

export function getNextUnexecutedPlan(plans: PlanInfo[]): PlanInfo | null {
  return plans.find((p) => !p.executed) ?? null;
}

export function isPhaseComplete(plans: PlanInfo[]): boolean {
  return plans.length > 0 && plans.every((p) => p.executed);
}

/**
 * Derive per-plan terminal execution status from session log entries.
 * Only terminal execute-plan outcomes are considered authoritative.
 */
export function derivePlanExecutionStatuses(
  entries: SessionLogEntry[],
  phaseNumber: number,
  goalTitle?: string,
): Map<number, PlanExecutionStatus> {
  const result = new Map<number, PlanExecutionStatus>();
  for (const entry of entries) {
    if (entry.phase !== '/gsd/execute-plan') continue;
    if (entry.phaseNumber !== phaseNumber) continue;
    if (goalTitle && entry.goalTitle !== goalTitle) continue;
    if (typeof entry.planNumber !== 'number' || entry.planNumber < 1) continue;
    switch (entry.status) {
      case 'done':
      case 'skipped':
      case 'verify-failed':
      case 'crashed':
      case 'timeout':
        result.set(entry.planNumber, entry.status);
        break;
      default:
        break;
    }
  }
  return result;
}

/**
 * Legacy helper for compatibility with older tests/tools.
 * SUMMARY file existence is informational only and not used for orchestration truth.
 */
export function isPlanCompleted(phaseDir: string, planNumber: number): boolean {
  const plans = readdirSync(phaseDir);
  const summarySuffixRe = new RegExp(`-(\\d+)-SUMMARY\\.md$`);
  return plans.some((name) => {
    const m = name.match(summarySuffixRe);
    if (!m) return false;
    return parseInt(m[1], 10) === planNumber && existsSync(join(phaseDir, name));
  });
}
