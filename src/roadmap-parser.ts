import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

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
  executed: boolean;
}

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

  const match = entries.find((name) => name.startsWith(prefix));
  return match ? join(phasesRoot, match) : null;
}

export async function discoverPlans(phaseDir: string): Promise<PlanInfo[]> {
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
    const executed = existsSync(summaryPath);

    plans.push({ phaseNumber, planNumber, planPath, summaryPath, executed });
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
 * Returns true iff the plan's SUMMARY file exists (auditable plan completion).
 * Same heuristic as discoverPlans: plan XX-N-PLAN.md → XX-N-SUMMARY.md (N may be zero-padded).
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
