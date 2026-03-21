import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { GsdCommand } from './lifecycle.js';
import type { SessionLogContext } from './session-log.js';

async function readRelativeFile(workspaceRoot: string, relativePath?: string): Promise<string | null> {
  if (!relativePath) return null;
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(workspaceRoot, relativePath);
  try {
    return await readFile(absolutePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function buildGoalContextPrompt(options: {
  workspaceRoot: string;
  command: GsdCommand;
  logContext?: SessionLogContext;
}): Promise<string> {
  const { workspaceRoot, command, logContext } = options;
  if (!logContext?.goalTitle) return '';

  const lines: string[] = [
    `Queued goal: ${logContext.goalTitle}`,
  ];

  if (logContext.route) lines.push(`Route: ${logContext.route}`);
  if (logContext.contextBundlePath) lines.push(`Context bundle: ${logContext.contextBundlePath}`);

  const agentBrief = await readRelativeFile(workspaceRoot, logContext.agentBriefPath);
  if (agentBrief) {
    lines.push('');
    lines.push('Read this bundle brief first:');
    lines.push('```md');
    lines.push(agentBrief.trim());
    lines.push('```');
  } else if (logContext.agentBriefPath) {
    lines.push(`Agent brief path: ${logContext.agentBriefPath}`);
  }

  if (logContext.sessionContextPath) {
    lines.push(`If more detail is needed, read: ${logContext.sessionContextPath}`);
  }

  lines.push(
    `Then execute the requested GSD command exactly: ${command.args ? `${command.command} ${command.args}` : command.command}`,
  );

  return lines.join('\n').trim();
}
