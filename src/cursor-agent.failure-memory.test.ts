/**
 * Tests for failure memory injection into agent prompt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCursorAgentInvoker } from './cursor-agent.js';
import type { CursorAgentConfig } from './cursor-agent.js';
import type { ResultEvent } from './stream-events.js';
import { initLogger } from './logger.js';

const appendSessionLogMock = vi.fn();
const readSessionLogMock = vi.fn();
const runAgentMock = vi.fn();

vi.mock('./session-log.js', async () => {
  const actual = await vi.importActual<typeof import('./session-log.js')>('./session-log.js');
  return {
    ...actual,
    appendSessionLog: (...args: unknown[]) => appendSessionLogMock(...args),
    readSessionLog: (...args: unknown[]) => readSessionLogMock(...args),
  };
});

vi.mock('./agent-runner.js', async () => {
  const actual = await vi.importActual<typeof import('./agent-runner.js')>('./agent-runner.js');
  return {
    ...actual,
    runAgent: (...args: unknown[]) => runAgentMock(...args),
    runAgentWithRetry: async (
      options: import('./agent-runner.js').RunAgentOptions,
      _policy: import('./agent-runner.js').RetryPolicy,
      _logger: import('./logger.js').Logger,
    ) => runAgentMock(options),
  };
});

const writeFileMock = vi.fn();
const unlinkMock = vi.fn();
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    unlink: (...args: unknown[]) => unlinkMock(...args),
  };
});

function baseConfig(overrides?: Partial<CursorAgentConfig>): CursorAgentConfig {
  return {
    agentPath: '/usr/bin/cursor-agent',
    defaultTimeoutMs: 10_000,
    sessionLogPath: '/tmp/session-log.jsonl',
    ...overrides,
  };
}

function resultSuccess(): ResultEvent {
  return { type: 'result', is_error: false, duration_ms: 1, result: 'ok' } as ResultEvent;
}

describe('cursor-agent failure memory', () => {
  const logger = initLogger({ level: 'silent', pretty: false });

  beforeEach(() => {
    appendSessionLogMock.mockReset();
    readSessionLogMock.mockReset();
    runAgentMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
  });

  it('injects Previous attempts context when readSessionLog returns failed entries', async () => {
    readSessionLogMock.mockResolvedValue([
      {
        goalTitle: 'Fix auth',
        status: 'crashed',
        planNumber: 1,
        failureContext: '/p/01-01-PLAN.md phase 1 plan 1: exit 1',
      },
      {
        goalTitle: 'Fix auth',
        status: 'timeout',
        planNumber: 2,
        failureContext: '/p/01-02-PLAN.md phase 1 plan 2: timed out',
      },
    ]);
    runAgentMock.mockResolvedValue({
      sessionId: 's1',
      resultEvent: resultSuccess(),
      events: [],
      exitCode: 0,
      timedOut: false,
      stderr: '',
    });

    const invoker = createCursorAgentInvoker(baseConfig());
    await invoker(
      { command: '/gsd/execute-plan', args: '/p/01-03-PLAN.md', description: 'x' },
      '/workspace',
      logger,
      { goalTitle: 'Fix auth', phaseNumber: 1, planNumber: 3 },
    );

    expect(readSessionLogMock).toHaveBeenCalledWith('/tmp/session-log.jsonl');
    expect(runAgentMock).toHaveBeenCalled();
    const prompt = runAgentMock.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('Previous attempts context:');
    expect(prompt).toContain('Plan 1 failed: /p/01-01-PLAN.md phase 1 plan 1: exit 1');
    expect(prompt).toContain('Plan 2 failed: /p/01-02-PLAN.md phase 1 plan 2: timed out');
    expect(prompt).toContain('Avoid repeating these approaches.');
    expect(prompt).toContain('/gsd/execute-plan /p/01-03-PLAN.md');
  });
});
