import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import type { AgentInvoker, AgentResult } from './orchestrator.js';
import type { Logger } from './logger.js';
import {
  runAgentWithRetry,
  abortAgent,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
  type RunAgentResult,
} from './agent-runner.js';
import type { AgentId } from './agent-runner.js';
import {
  appendSessionLog,
  type SessionLogEntry,
  type SessionLogContext,
} from './session-log.js';
import type { CursorStreamEvent, ResultEvent } from './stream-events.js';
import type { AutopilotConfig } from './config.js';
import { getCursorBinaryPath, getCnBinaryPath } from './config/paths.js';
import { parseCnOutput } from './cn-output.js';

export type { SessionLogContext };

export interface CursorAgentConfig {
  agentPath: string;
  defaultTimeoutMs: number;
  sessionLogPath: string;
  /** If set, write heartbeat timestamp here while agent runs (for crash detection). */
  heartbeatPath?: string;
  heartbeatIntervalMs?: number;
  /** If set, use runAgentWithRetry with this policy. */
  retryPolicy?: RetryPolicy;
}

export interface CrashedAfterRetriesContext {
  goalTitle: string;
  phaseNumber?: number;
  planNumber?: number;
}

export interface AgentInvokerCallbacks {
  /** Called when agent reports session_id (system/init); call with null when invocation ends. */
  setAgentSessionId?: (id: string | null) => void;
  /** Called when a session log entry is written as crashed after all retries are exhausted. */
  onCrashedAfterRetries?: (ctx: CrashedAfterRetriesContext) => void;
}

export function createCursorAgentInvoker(
  agentConfig: CursorAgentConfig,
  callbacks?: AgentInvokerCallbacks,
): AgentInvoker {
  return async (command, workspaceDir, logger, logContext): Promise<AgentResult> => {
    const cmdString = command.args
      ? `${command.command} ${command.args}`
      : command.command;

    const prompt =
      'Execute in non-interactive/YOLO mode. Auto-approve all confirmations. ' +
      'Do not ask the user any questions — make reasonable decisions autonomously.\n\n' +
      cmdString;

    logger.info({ command: cmdString }, `Invoking cursor-agent: ${cmdString}`);

    const baseEntry: Omit<SessionLogEntry, 'status' | 'durationMs' | 'error'> = {
      timestamp: new Date().toISOString(),
      goalTitle: logContext?.goalTitle ?? '',
      phase: command.command,
      phaseNumber: logContext?.phaseNumber,
      planNumber: logContext?.planNumber,
      sessionId: null,
      command: cmdString,
    };

    await appendSessionLog(agentConfig.sessionLogPath, {
      ...baseEntry,
      status: 'running',
    });

    const startMs = Date.now();
    const heartbeatPath = agentConfig.heartbeatPath;
    const heartbeatIntervalMs = agentConfig.heartbeatIntervalMs ?? 15_000;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stopHeartbeat = async (): Promise<void> => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (heartbeatPath) {
        try {
          await unlink(heartbeatPath);
        } catch {
          // ignore
        }
      }
    };

    if (heartbeatPath) {
      const tick = (): void => {
        writeFile(heartbeatPath!, new Date().toISOString(), 'utf-8').catch(() => {});
      };
      tick();
      heartbeatTimer = setInterval(tick, heartbeatIntervalMs);
    }

    const runOptions = {
      agentPath: agentConfig.agentPath,
      workspace: workspaceDir,
      prompt,
      env: process.env.CURSOR_API_KEY
        ? { CURSOR_API_KEY: process.env.CURSOR_API_KEY }
        : undefined,
      timeoutMs: agentConfig.defaultTimeoutMs,
      logger,
      onEvent: (event: CursorStreamEvent) => {
          if (event.type === 'system' && event.subtype === 'init') {
            logger.info({ sessionId: event.session_id }, 'Agent session started');
            callbacks?.setAgentSessionId?.(event.session_id);
          } else if (event.type === 'tool_call') {
            logger.debug(
              { toolName: event.tool_call.name, callId: event.call_id },
              `Tool call: ${event.tool_call.name}`,
            );
          } else if (event.type === 'result') {
            logger.info(
              { isError: event.is_error, durationMs: event.duration_ms },
              `Agent result: ${event.is_error ? 'error' : 'success'}`,
            );
          }
        },
    };

    try {
      const policy = agentConfig.retryPolicy ?? DEFAULT_RETRY_POLICY;
      const result = await runAgentWithRetry(runOptions, policy, logger);

      const durationMs = Date.now() - startMs;
      const timedOut = result.timedOut;

      await stopHeartbeat();
      callbacks?.setAgentSessionId?.(null);

      if (timedOut) {
        await appendSessionLog(agentConfig.sessionLogPath, {
          ...baseEntry,
          sessionId: result.sessionId,
          status: 'timeout',
          durationMs,
          error: `Agent timed out after ${agentConfig.defaultTimeoutMs}ms`,
        });
        return {
          success: false,
          error: `Agent timed out after ${agentConfig.defaultTimeoutMs}ms`,
        };
      }

      if (result.exitCode === 0 && result.resultEvent) {
        await appendSessionLog(agentConfig.sessionLogPath, {
          ...baseEntry,
          sessionId: result.sessionId,
          status: 'done',
          durationMs,
        });
        return { success: true, output: result.resultEvent.result };
      }

      const stderrSnippet = result.stderr.slice(0, 500);
      const errorMsg = result.resultEvent?.is_error
        ? `Agent error: ${result.resultEvent.result}`
        : `Agent failed (exit ${result.exitCode})${stderrSnippet ? `: ${stderrSnippet}` : ''}`;

      await appendSessionLog(agentConfig.sessionLogPath, {
        ...baseEntry,
        sessionId: result.sessionId,
        status: 'crashed',
        durationMs,
        error: errorMsg,
      });
      callbacks?.onCrashedAfterRetries?.({
        goalTitle: logContext?.goalTitle ?? '',
        phaseNumber: logContext?.phaseNumber,
        planNumber: logContext?.planNumber,
      });

      return { success: false, error: errorMsg };
    } catch (err) {
      await stopHeartbeat();
      callbacks?.setAgentSessionId?.(null);
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);

      void Promise.resolve(
        appendSessionLog(agentConfig.sessionLogPath, {
          ...baseEntry,
          status: 'crashed',
          durationMs,
          error: message,
        }),
      ).catch(() => {});
      callbacks?.onCrashedAfterRetries?.({
        goalTitle: logContext?.goalTitle ?? '',
        phaseNumber: logContext?.phaseNumber,
        planNumber: logContext?.planNumber,
      });

      return { success: false, error: `Agent invocation failed: ${message}` };
    }
  };
}

export function validateCursorApiKey(): void {
  const key = process.env.CURSOR_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error(
      'CURSOR_API_KEY environment variable is not set or empty.\n' +
      'Set CURSOR_API_KEY environment variable. Generate from Cursor Dashboard → Cloud Agents → User API Keys.',
    );
  }
}

export function validateContinueApiKey(): void {
  const key = process.env.CONTINUE_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error(
      'CONTINUE_API_KEY environment variable is not set or empty.\n' +
      'Set CONTINUE_API_KEY for CI/headless use. Get from https://continue.dev/settings/api-keys',
    );
  }
}

export interface CnAgentConfig {
  agentPath: string;
  defaultTimeoutMs: number;
  sessionLogPath: string;
  workspaceRoot: string;
  /** If set, write heartbeat timestamp here while agent runs (for crash detection). */
  heartbeatPath?: string;
  heartbeatIntervalMs?: number;
}

export function createContinueCliInvoker(
  agentConfig: CnAgentConfig,
  callbacks?: AgentInvokerCallbacks,
): AgentInvoker {
  return async (command, workspaceDir, logger, logContext): Promise<AgentResult> => {
    const cmdString = command.args
      ? `${command.command} ${command.args}`
      : command.command;

    const prompt =
      'Execute in non-interactive/YOLO mode. Auto-approve all confirmations. ' +
      'Do not ask the user any questions — make reasonable decisions autonomously.\n\n' +
      cmdString;

    logger.info({ command: cmdString }, `Invoking cn: ${cmdString}`);

    const baseEntry: Omit<SessionLogEntry, 'status' | 'durationMs' | 'error'> = {
      timestamp: new Date().toISOString(),
      goalTitle: logContext?.goalTitle ?? '',
      phase: command.command,
      phaseNumber: logContext?.phaseNumber,
      planNumber: logContext?.planNumber,
      sessionId: null,
      command: cmdString,
    };

    await appendSessionLog(agentConfig.sessionLogPath, {
      ...baseEntry,
      status: 'running',
    });

    const startMs = Date.now();
    const heartbeatPath = agentConfig.heartbeatPath;
    const heartbeatIntervalMs = agentConfig.heartbeatIntervalMs ?? 15_000;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stopHeartbeat = async (): Promise<void> => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (heartbeatPath) {
        try {
          await unlink(heartbeatPath);
        } catch {
          // ignore
        }
      }
    };

    if (heartbeatPath) {
      const tick = (): void => {
        writeFile(heartbeatPath!, new Date().toISOString(), 'utf-8').catch(() => {});
      };
      tick();
      heartbeatTimer = setInterval(tick, heartbeatIntervalMs);
    }

    const configPath = path.join(workspaceDir, '.continue', 'config.yaml');
    const effectiveConfigPath = existsSync(configPath) ? configPath : undefined;

    try {
      const result = await runContinueCli({
        agentPath: agentConfig.agentPath,
        workspace: workspaceDir,
        prompt,
        configPath: effectiveConfigPath,
        timeoutMs: agentConfig.defaultTimeoutMs,
        env: process.env.CONTINUE_API_KEY
          ? { CONTINUE_API_KEY: process.env.CONTINUE_API_KEY }
          : undefined,
      });

      const durationMs = Date.now() - startMs;
      const timedOut = result.timedOut;

      await stopHeartbeat();
      callbacks?.setAgentSessionId?.(null);

      if (timedOut) {
        await appendSessionLog(agentConfig.sessionLogPath, {
          ...baseEntry,
          sessionId: null,
          status: 'timeout',
          durationMs,
          error: `Agent timed out after ${agentConfig.defaultTimeoutMs}ms`,
        });
        return {
          success: false,
          error: `Agent timed out after ${agentConfig.defaultTimeoutMs}ms`,
        };
      }

      if (result.exitCode === 0 && result.resultEvent) {
        await appendSessionLog(agentConfig.sessionLogPath, {
          ...baseEntry,
          sessionId: null,
          status: 'done',
          durationMs,
        });
        return { success: true, output: result.resultEvent.result };
      }

      const stderrSnippet = result.stderr.slice(0, 500);
      const errorMsg = result.resultEvent?.is_error
        ? `Agent error: ${result.resultEvent.result}`
        : `Agent failed (exit ${result.exitCode ?? -1})${stderrSnippet ? `: ${stderrSnippet}` : ''}`;

      await appendSessionLog(agentConfig.sessionLogPath, {
        ...baseEntry,
        sessionId: null,
        status: 'crashed',
        durationMs,
        error: errorMsg,
      });
      callbacks?.onCrashedAfterRetries?.({
        goalTitle: logContext?.goalTitle ?? '',
        phaseNumber: logContext?.phaseNumber,
        planNumber: logContext?.planNumber,
      });

      return { success: false, error: errorMsg };
    } catch (err) {
      await stopHeartbeat();
      callbacks?.setAgentSessionId?.(null);
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);

      void Promise.resolve(
        appendSessionLog(agentConfig.sessionLogPath, {
          ...baseEntry,
          status: 'crashed',
          durationMs,
          error: message,
        }),
      ).catch(() => {});
      callbacks?.onCrashedAfterRetries?.({
        goalTitle: logContext?.goalTitle ?? '',
        phaseNumber: logContext?.phaseNumber,
        planNumber: logContext?.planNumber,
      });

      return { success: false, error: `Agent invocation failed: ${message}` };
    }
  };
}

export interface RunContinueCliOptions {
  agentPath: string;
  workspace: string;
  prompt: string;
  configPath?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/**
 * Spawn cn (Continue CLI) in headless mode. cn outputs plain text, not NDJSON.
 * Completion detection is via exit code. Returns RunAgentResult-compatible shape.
 */
export async function runContinueCli(options: RunContinueCliOptions): Promise<RunAgentResult> {
  const { agentPath, workspace, prompt, configPath, timeoutMs, env } = options;

  const args = [
    '-p',
    prompt,
    '--allow',
    'Write()',
    '--allow',
    'Bash()',
    '--allow',
    'Read()',
  ];

  if (configPath) {
    args.unshift('--config', configPath);
  }

  return new Promise<RunAgentResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(agentPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workspace,
        env: { ...process.env, ...env },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reject(
        new Error(
          `cn binary not found. Install via: curl -fsSL https://raw.githubusercontent.com/continuedev/continue/main/extensions/cli/scripts/install.sh | bash, or npm. Set GSD_CN_BIN or continueCliPath if installed elsewhere. Original: ${msg}`,
        ),
      );
      return;
    }

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new Error(
          `cn binary not found. Install via: curl -fsSL https://raw.githubusercontent.com/continuedev/continue/main/extensions/cli/scripts/install.sh | bash, or npm. Set GSD_CN_BIN or continueCliPath if installed elsewhere. Original: ${err.message}`,
        ),
      );
    });

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk.toString());
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString());
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

      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      const parsed = parseCnOutput(stdout);

      let resultEvent: ResultEvent | null = null;
      if (code === 0) {
        resultEvent = {
          type: 'result',
          subtype: 'done',
          duration_ms: 0,
          duration_api_ms: 0,
          is_error: false,
          result: stdout,
          session_id: '',
        };
      } else if (parsed.hasError || parsed.summary !== 'No output') {
        resultEvent = {
          type: 'result',
          subtype: 'error',
          duration_ms: 0,
          duration_api_ms: 0,
          is_error: true,
          result: parsed.summary,
          session_id: '',
        };
      }

      if (timedOut) {
        resolve({
          sessionId: null,
          resultEvent: null,
          events: [],
          exitCode: code,
          timedOut: true,
          stderr: stderr + (timeoutMs ? `\nAgent timed out after ${timeoutMs}ms` : ''),
        });
      } else {
        resolve({
          sessionId: null,
          resultEvent,
          events: [],
          exitCode: code,
          timedOut: false,
          stderr,
        });
      }
    });
  });
}

/** Agent-agnostic factory: returns the appropriate invoker for the given agent ID. */
export function createAgentInvoker(
  agentId: AgentId,
  config: AutopilotConfig,
  callbacks?: AgentInvokerCallbacks,
): AgentInvoker {
  switch (agentId) {
    case 'cursor':
      return createCursorAgentInvoker(
        {
          agentPath: getCursorBinaryPath(config),
          defaultTimeoutMs: config.agentTimeoutMs,
          sessionLogPath: config.sessionLogPath,
          heartbeatPath: path.join(config.workspaceRoot, '.planning', 'heartbeat.txt'),
          heartbeatIntervalMs: 15_000,
          retryPolicy: config.retryPolicy,
        },
        callbacks,
      );
    case 'cn':
      return createContinueCliInvoker(
        {
          agentPath: getCnBinaryPath(config),
          defaultTimeoutMs: config.agentTimeoutMs,
          sessionLogPath: config.sessionLogPath,
          workspaceRoot: config.workspaceRoot,
          heartbeatPath: path.join(config.workspaceRoot, '.planning', 'heartbeat.txt'),
          heartbeatIntervalMs: 15_000,
        },
        callbacks,
      );
    case 'claude-code':
    case 'gemini-cli':
    case 'codex': {
      // TODO: Implement real adapters when those agents support GSD NDJSON/heartbeat contract.
      const stub: AgentInvoker = async (command, workspaceDir, logger, _logContext) => {
        logger.info(
          `Stub (${agentId}): would invoke agent with "${command.command} ${command.args ?? ''}" in ${workspaceDir}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { success: true, output: 'stub' };
      };
      return stub;
    }
  }
}
