import { readFile } from 'node:fs/promises';

/**
 * Machine-readable snapshot of the "## Current Position" section of STATE.md.
 * Used by the orchestrator for progress monitoring and by Phase 5 crash recovery
 * to resume from the exact last known position.
 */
export interface StateSnapshot {
  phaseNumber: number;
  totalPhases: number;
  phaseName: string;
  planNumber: number;
  totalPlans: number;
  status: string;
  lastActivity: string;
  progressPercent: number | null;
}

const SECTION_RE = /## Current Position\n([\s\S]*?)(?=\n## |$)/;
const PHASE_RE = /^Phase:\s*(\d+)\s+of\s+(\d+)\s*\(([^)]+)\)\s*$/m;
const PLAN_RE = /^Plan:\s*(\d+)\s+of\s+(\d+)\s+in current phase\s*$/m;
const STATUS_RE = /^Status:\s*(.+)$/m;
const LAST_ACTIVITY_RE = /^Last activity:\s*(.+)$/m;
const PROGRESS_RE = /^Progress:\s*[^\n]*?(\d+)%\s*$/m;

/**
 * Parses the "## Current Position" section of STATE.md into a StateSnapshot.
 * Returns null if the section is missing, content is empty/whitespace, or any
 * required field (phase line with "of", plan line, status) is missing or malformed.
 * progressPercent is null when the progress line is absent or has no percentage.
 */
export function parseStateMd(content: string): StateSnapshot | null {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  const sectionMatch = content.match(SECTION_RE);
  if (!sectionMatch) {
    return null;
  }

  const block = sectionMatch[1];

  const phaseMatch = block.match(PHASE_RE);
  if (!phaseMatch) {
    return null;
  }
  const phaseNumber = parseInt(phaseMatch[1], 10);
  const totalPhases = parseInt(phaseMatch[2], 10);
  const phaseName = phaseMatch[3].trim();

  const planMatch = block.match(PLAN_RE);
  if (!planMatch) {
    return null;
  }
  const planNumber = parseInt(planMatch[1], 10);
  const totalPlans = parseInt(planMatch[2], 10);

  const statusMatch = block.match(STATUS_RE);
  if (!statusMatch) {
    return null;
  }
  const status = statusMatch[1].trim();

  let lastActivity = '';
  const lastActivityMatch = block.match(LAST_ACTIVITY_RE);
  if (lastActivityMatch) {
    lastActivity = lastActivityMatch[1].trim();
  }

  let progressPercent: number | null = null;
  const progressMatch = block.match(PROGRESS_RE);
  if (progressMatch) {
    progressPercent = parseInt(progressMatch[1], 10);
  }

  return {
    phaseNumber,
    totalPhases,
    phaseName,
    planNumber,
    totalPlans,
    status,
    lastActivity,
    progressPercent,
  };
}

/**
 * Reads STATE.md from the given file path and returns a StateSnapshot.
 * Returns null if the file is missing, unreadable, or content fails to parse.
 */
export async function readStateMd(filePath: string): Promise<StateSnapshot | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
  return parseStateMd(content);
}
