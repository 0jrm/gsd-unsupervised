import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { sendSms } from '../notifier.js';
import { buildGoalMetadataBlock, type GoalRoute } from '../goal-metadata.js';

export interface QueueGoalInput {
  workspaceRoot: string;
  title: string;
  successCriteria: string[];
  goalDescription?: string;
  route?: GoalRoute;
  contextBundlePath?: string;
  sessionContextPath?: string;
  agentBriefPath?: string;
  replyTo?: string;
}

function goalsFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, 'goals.md');
}

function defaultGoalsMd(titleLine?: string): string {
  const maybeTitle = titleLine ? `\n${titleLine}\n` : '\n';
  return `# GSD Autopilot Goals Queue${maybeTitle}
## Pending
${titleLine ? `- [ ] ${titleLine}\n` : ''}\n## In Progress
<!-- orchestrator moves goals here while running -->

## Done
<!-- orchestrator moves goals here on completion -->
`;
}

async function ensureGoalsFile(goalsPath: string): Promise<string> {
  if (!existsSync(goalsPath)) {
    const content = defaultGoalsMd();
    await fs.writeFile(goalsPath, content, 'utf-8');
    return content;
  }
  return fs.readFile(goalsPath, 'utf-8');
}

function findSectionBounds(lines: string[], sectionHeading: string): { start: number; end: number } {
  const headingIdx = lines.findIndex((l) => l.trim() === sectionHeading);
  if (headingIdx < 0) throw new Error(`Missing section "${sectionHeading}" in goals.md`);

  // End is the next section heading (## ...) after headingIdx.
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('## ') && lines[i].trim() !== sectionHeading) {
      end = i;
      break;
    }
  }
  return { start: headingIdx + 1, end };
}

export async function touchGoalsUpdated(workspaceRoot: string): Promise<void> {
  const dir = join(workspaceRoot, '.gsd');
  await fs.mkdir(dir, { recursive: true });
  const flagPath = join(dir, 'goals-updated');
  // Always write to bump mtime.
  await fs.writeFile(flagPath, `updated:${Date.now()}\n`, 'utf-8');
}

export async function notifyQueued(args: { workspaceRoot: string; title: string; replyTo?: string }): Promise<void> {
  if (!args.replyTo) return;

  const message = `Queued: ${args.title}`;
  // Fire-and-forget: catch and log; never throw.
  void sendSms(message).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('SMS notification failed (notifyQueued):', err);
  });
}

export async function queueGoal(input: QueueGoalInput): Promise<void> {
  const {
    workspaceRoot,
    title,
    successCriteria,
    goalDescription,
    route,
    contextBundlePath,
    sessionContextPath,
    agentBriefPath,
    replyTo,
  } = input;
  const goalsPath = goalsFilePath(workspaceRoot);

  const raw = await ensureGoalsFile(goalsPath);
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  const { start, end } = findSectionBounds(lines, '## Pending');

  // Insert before end, after trimming trailing blank lines inside the section.
  let insertAt = end;
  while (insertAt > start && lines[insertAt - 1]?.trim() === '') {
    insertAt -= 1;
  }

  const newCheckboxLine = `- [ ] ${title}`;
  lines.splice(insertAt, 0, newCheckboxLine);

  const metadataBlock = buildGoalMetadataBlock(title, {
    goal: goalDescription,
    successCriteria,
    route,
    contextBundlePath,
    sessionContextPath,
    agentBriefPath,
  });

  if (metadataBlock) {
    const indented = metadataBlock
      .split('\n')
      .map((line) => `  ${line}`);
    lines.splice(insertAt + 1, 0, ...indented);
  } else if (successCriteria.length > 0) {
    const comment = `<!-- success: ${successCriteria.join('; ')} -->`;
    lines.splice(insertAt + 1, 0, comment);
  }

  await fs.writeFile(goalsPath, lines.join('\n'), 'utf-8');
  await touchGoalsUpdated(workspaceRoot);

  // Optional SMS notification.
  void notifyQueued({ workspaceRoot, title, replyTo });
}
