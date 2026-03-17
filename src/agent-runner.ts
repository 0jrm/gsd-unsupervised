import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import treeKill from 'tree-kill';
import {
  parseEvent,
  extractSessionId,
  extractResult,
  type CursorStreamEvent,
  type ResultEvent,
} from './stream-events.js';

/** Supported agent IDs for the pluggable invoker seam. */
export type AgentId = 'cursor' | 'claude-code' | 'gemini-cli' | 'codex';

export const SUPPORTED_AGENTS: readonly AgentId[] = [
  'cursor',
  'claude-code',
  'gemini-cli',
  'codex',
] as const;

export function isSupportedAgent(id: string): id is AgentId {
  return (SUPPORTED_AGENTS as readonly string[]).includes(id);
}

export interface RunAgentOptions {
  agentPath: string;
  workspace: string;
  prompt: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  model?: string;
  resumeId?: string;
  onEvent?: (event: CursorStreamEvent) => void;
}

export interface RunAgentResult {
  sessionId: string | null;
  resultEvent: ResultEvent | null;
  events: CursorStreamEvent[];
  exitCode: number | null;
  stderr: string;
}

export function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { agentPath, workspace, prompt, env, timeoutMs, model, resumeId, onEvent } = options;

  const args = [
    '-p', '--force', '--trust', '--approve-mcps',
    '--workspace', workspace,
    '--output-format', 'stream-json',
  ];

  if (model) {
    args.push('--model', model);
  }
  if (resumeId) {
    args.push('--resume', resumeId);
  }
  args.push(prompt);

  return new Promise<RunAgentResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(agentPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
    } catch (err) {
      reject(new Error(`Failed to spawn agent at "${agentPath}": ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    const events: CursorStreamEvent[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Failed to spawn agent at "${agentPath}": ${err.message}`));
    });

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString());
      });
    }

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        const event = parseEvent(line);
        if (event) {
          events.push(event);
          onEvent?.(event);
        }
      });
    }

    if (timeoutMs != null && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        abortAgent(child).catch(() => {});
      }, timeoutMs);
    }

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);

      const resultEvent = extractResult(events);
      const parts = stderrChunks.slice();

      if (timedOut) {
        parts.push(`Agent timed out after ${timeoutMs}ms`);
      }

      if (code === 0 && !resultEvent) {
        parts.push('Agent exited cleanly but produced no result event');
      }

      resolve({
        sessionId: extractSessionId(events),
        resultEvent,
        events,
        exitCode: code,
        stderr: parts.join(''),
      });
    });
  });
}

export async function abortAgent(child: ChildProcess): Promise<void> {
  if (child.pid == null) return;

  return new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      treeKill(child.pid!, 'SIGKILL', () => resolve());
    }, 5000);

    treeKill(child.pid!, 'SIGTERM', (err) => {
      if (err) {
        clearTimeout(killTimer);
        treeKill(child.pid!, 'SIGKILL', () => resolve());
        return;
      }

      child.on('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  });
}
