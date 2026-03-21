/**
 * Validated goals parser: parses goals.md into zod-validated ParsedGoals.
 * Replaces ad-hoc parsing with a clear schema and parse error reporting.
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { parseGoalMetadataBlock, type GoalRoute } from './goal-metadata.js';

export const ParsedGoalSchema = z.object({
  title: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'done']),
  description: z.string().optional(),
  successCriteria: z.array(z.string()).optional(),
  route: z.enum(['quick', 'full']).optional(),
  contextBundlePath: z.string().optional(),
  sessionContextPath: z.string().optional(),
  agentBriefPath: z.string().optional(),
  metadataBlock: z.string().optional(),
  /** Original checkbox line for display and append. */
  raw: z.string(),
});

export type ParsedGoal = z.infer<typeof ParsedGoalSchema>;

export const ParsedGoalsSchema = z.object({
  goals: z.array(ParsedGoalSchema),
});

export type ParsedGoals = z.infer<typeof ParsedGoalsSchema>;

export interface ParseWarning {
  lineNumber: number;
  line: string;
  reason: string;
}

const SECTION_MAP: Record<string, ParsedGoal['status']> = {
  '## pending': 'pending',
  '## in progress': 'in_progress',
  '## done': 'done',
};

const CHECKBOX_RE = /^- \[([ xX])\]\s+(.+)$/;

/**
 * Parses goals markdown into validated ParsedGoals.
 * Sections: ## Pending, ## In Progress, ## Done.
 * Only lines matching - [ ] or - [x] are goals; ### and following lines are attached as description/successCriteria of the preceding goal.
 * Non-checkbox lines in a section and lines outside any section are recorded as warnings.
 */
export function parseGoalsFile(content: string): ParsedGoals & { warnings: ParseWarning[] } {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const goals: ParsedGoal[] = [];
  const warnings: ParseWarning[] = [];
  let currentStatus: ParsedGoal['status'] | null = null;

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
      const raw = trimmed;
      const title = match[2].trim();
      if (!title) {
        warnings.push({ lineNumber, line: trimmed, reason: 'checkbox line has empty title; skipped' });
        continue;
      }
      let description: string | undefined;
      let successCriteria: string[] | undefined;
      let route: GoalRoute | undefined;
      let contextBundlePath: string | undefined;
      let sessionContextPath: string | undefined;
      let agentBriefPath: string | undefined;
      let metadataBlock: string | undefined;

      if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next.startsWith('###')) {
          const blockLines: string[] = [next];
          let j = i + 2;
          while (j < lines.length) {
            const l = lines[j];
            if (l.trim() === '' || l.match(CHECKBOX_RE) || SECTION_MAP[l.trim().toLowerCase()] !== undefined) {
              break;
            }
            blockLines.push(l);
            j++;
          }
          const block = blockLines.join('\n');
          const parsedMetadata = parseGoalMetadataBlock(block);
          metadataBlock = block;
          description = parsedMetadata.goal ?? (block.length > 0 ? block : undefined);
          successCriteria =
            parsedMetadata.successCriteria && parsedMetadata.successCriteria.length > 0
              ? parsedMetadata.successCriteria
              : undefined;
          route = parsedMetadata.route;
          contextBundlePath = parsedMetadata.contextBundlePath;
          sessionContextPath = parsedMetadata.sessionContextPath;
          agentBriefPath = parsedMetadata.agentBriefPath;
          i = j - 1;
        }
      }

      goals.push({
        title,
        status: currentStatus,
        raw,
        ...(description && { description }),
        ...(successCriteria && successCriteria.length > 0 && { successCriteria }),
        ...(route && { route }),
        ...(contextBundlePath && { contextBundlePath }),
        ...(sessionContextPath && { sessionContextPath }),
        ...(agentBriefPath && { agentBriefPath }),
        ...(metadataBlock && { metadataBlock }),
      });
      continue;
    }

    warnings.push({
      lineNumber,
      line: trimmed,
      reason: 'not a checkbox line (- [ ] or - [x]); skipped',
    });
  }

  const parsed = ParsedGoalsSchema.parse({ goals });
  return { ...parsed, warnings };
}

/**
 * Reads and parses a goals file; throws on read or parse error.
 */
export async function validateGoalsFile(
  filePath: string,
): Promise<ParsedGoals & { warnings: ParseWarning[] }> {
  const content = await readFile(filePath, 'utf-8');
  return parseGoalsFile(content);
}
