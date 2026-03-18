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
export type AgentId = 'cursor' | 'cn' | 'claude-code' | 'gemini-cli' | 'codex';

/** Policy for retrying agent runs with backoff and non-retryable exit codes. */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number[];
  nonRetryableExitCodes: number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: [5000, 30000, 120000],
  nonRetryableExitCodes: [1, 127],
};

export const SUPPORTED_AGENTS: readonly AgentId[] = [
  'cursor',
  'cn',
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
  /** Max retries on retriable failure (default 2). Total attempts = maxRetries + 1. */
  maxRetries?: number;
  /** Delay in ms before retry (default 5000). */
  retryDelayMs?: number;
  /** Optional logger for retry warnings. */
  logger?: import('./logger.js').Logger;
}

export interface RunAgentResult {
  sessionId: string | null;
  resultEvent: ResultEvent | null;
  events: CursorStreamEvent[];
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
}

/** True if the failure is likely transient (timeout, crash without result). */
function isRetriableFailure(result: RunAgentResult): boolean {
  if (result.timedOut) return true;
  if (result.exitCode !== 0 && result.resultEvent == null) return true;
  if (result.exitCode !== 0 && result.resultEvent?.is_error && !(result.resultEvent.result?.trim())) return true;
  return false;
}

/** Reason string for logging. */
function retryReason(result: RunAgentResult): string {
  if (result.timedOut) return 'timeout';
  if (result.exitCode !== 0 && result.resultEvent == null) return 'non-zero exit without result event';
  if (result.resultEvent?.is_error && !(result.resultEvent.result?.trim())) return 'error event without result message';
  return 'unknown';
}

/** Single attempt: no retries. */
function runAgentOnce(options: RunAgentOptions): Promise<RunAgentResult> {
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
        timedOut,
        stderr: parts.join(''),
      });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 5000;
  const logger = options.logger;

  let lastResult: RunAgentResult | null = null;
  const totalAttempts = maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    lastResult = await runAgentOnce(options);
    const retriable = isRetriableFailure(lastResult);
    if (!retriable || attempt >= totalAttempts) break;
    logger?.warn(
      { attempt, maxRetries, reason: retryReason(lastResult) },
      'Agent attempt failed, retrying',
    );
    await sleep(retryDelayMs);
  }

  return lastResult!;
}

/**
 * Runs the agent with retry policy: backoff between attempts, no retry on non-retryable exit codes.
 * Uses runAgent with maxRetries: 0 for a single attempt per outer attempt.
 * @param runFn - Optional single-attempt runner (for tests); defaults to runAgent with maxRetries: 0.
 */
export async function runAgentWithRetry(
  options: RunAgentOptions,
  policy: RetryPolicy,
  logger: import('./logger.js').Logger,
  runFn?: (opts: RunAgentOptions) => Promise<RunAgentResult>,
): Promise<RunAgentResult> {
  const { maxAttempts, backoffMs, nonRetryableExitCodes } = policy;
  const runOnce = runFn ?? ((opts: RunAgentOptions) => runAgent({ ...opts, maxRetries: 0, logger: opts.logger }));
  let lastResult: RunAgentResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await runOnce({ ...options, logger });

    const exitCode = lastResult.exitCode ?? -1;
    const done =
      lastResult.exitCode === 0 ||
      lastResult.timedOut ||
      nonRetryableExitCodes.includes(exitCode);

    if (done || attempt >= maxAttempts) break;

    const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? backoffMs[backoffMs.length - 1];
    const reason = lastResult.stderr?.slice(0, 500) || `exit ${lastResult.exitCode}`;
    logger.warn(
      { attempt, maxAttempts, backoffMs: delay, reason },
      'agent invocation failed, retrying',
    );
    await sleep(delay);
  }

  return lastResult!;
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
