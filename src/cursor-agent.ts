import path from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import type { AgentInvoker, AgentResult } from './orchestrator.js';
import type { Logger } from './logger.js';
import { runAgentWithRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from './agent-runner.js';
import type { AgentId } from './agent-runner.js';
import {
  appendSessionLog,
  type SessionLogEntry,
  type SessionLogContext,
} from './session-log.js';
import type { CursorStreamEvent } from './stream-events.js';
import type { AutopilotConfig } from './config.js';
import { getCursorBinaryPath } from './config/paths.js';

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

export interface AgentInvokerCallbacks {
  /** Called when agent reports session_id (system/init); call with null when invocation ends. */
  setAgentSessionId?: (id: string | null) => void;
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
