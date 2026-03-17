import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCursorAgentInvoker } from './cursor-agent.js';
import type { CursorAgentConfig } from './cursor-agent.js';
import type { CursorStreamEvent, ResultEvent } from './stream-events.js';
import { initLogger } from './logger.js';

const appendSessionLogMock = vi.fn();
const runAgentMock = vi.fn();

vi.mock('./session-log.js', async () => {
  const actual = await vi.importActual<typeof import('./session-log.js')>('./session-log.js');
  return {
    ...actual,
    appendSessionLog: (...args: any[]) => appendSessionLogMock(...args),
  };
});

vi.mock('./agent-runner.js', async () => {
  const actual = await vi.importActual<typeof import('./agent-runner.js')>('./agent-runner.js');
  return {
    ...actual,
    runAgent: (...args: any[]) => runAgentMock(...args),
  };
});

const writeFileMock = vi.fn<unknown[], Promise<void>>();
const unlinkMock = vi.fn<unknown[], Promise<void>>();

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    writeFile: (...args: any[]) => writeFileMock(...args),
    unlink: (...args: any[]) => unlinkMock(...args),
  };
});

function baseInvokerConfig(overrides?: Partial<CursorAgentConfig>): CursorAgentConfig {
  return {
    agentPath: '/usr/bin/cursor-agent',
    defaultTimeoutMs: 10_000,
    sessionLogPath: '/tmp/session-log.jsonl',
    heartbeatPath: '/tmp/heartbeat.txt',
    heartbeatIntervalMs: 50,
    ...overrides,
  };
}

function resultEventSuccess(): ResultEvent {
  return {
    type: 'result',
    is_error: false,
    duration_ms: 1,
    result: 'ok',
  } as ResultEvent;
}

function systemInit(sessionId = 'sess-1'): CursorStreamEvent {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
  } as CursorStreamEvent;
}

describe('cursor-agent invoker', () => {
  const logger = initLogger({ level: 'silent', pretty: false });

  beforeEach(() => {
    appendSessionLogMock.mockReset();
    runAgentMock.mockReset();
    writeFileMock.mockReset();
    unlinkMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes running then done session-log entries on success', async () => {
    runAgentMock.mockResolvedValue({
      sessionId: 'sess-1',
      resultEvent: resultEventSuccess(),
      events: [systemInit('sess-1'), resultEventSuccess()],
      exitCode: 0,
      timedOut: false,
      stderr: '',
    });

    const invoker = createCursorAgentInvoker(baseInvokerConfig({ heartbeatIntervalMs: 10 }));
    const result = await invoker(
      { command: '/gsd/execute-plan', args: '/p', description: 'x' },
      '/workspace',
      logger,
      { goalTitle: 'Goal', phaseNumber: 3, planNumber: 1 },
    );

    expect(result).toEqual({ success: true, output: 'ok' });
    expect(appendSessionLogMock).toHaveBeenCalled();
    const statuses = appendSessionLogMock.mock.calls.map((c) => c[1]?.status);
    expect(statuses[0]).toBe('running');
    expect(statuses[1]).toBe('done');
    expect(appendSessionLogMock.mock.calls[1]![1]).toMatchObject({
      status: 'done',
      sessionId: 'sess-1',
      durationMs: expect.any(Number),
    });
  });

  it('writes timeout status when runAgent timedOut is true', async () => {
    runAgentMock.mockResolvedValue({
      sessionId: 'sess-2',
      resultEvent: null,
      events: [systemInit('sess-2')],
      exitCode: null,
      timedOut: true,
      stderr: 'some stderr',
    });

    const invoker = createCursorAgentInvoker(baseInvokerConfig());
    const result = await invoker(
      { command: '/gsd/execute-plan', args: '/p', description: 'x' },
      '/workspace',
      logger,
      { goalTitle: 'Goal', phaseNumber: 3, planNumber: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    const statuses = appendSessionLogMock.mock.calls.map((c) => c[1]?.status);
    expect(statuses).toEqual(['running', 'timeout']);
  });

  it('writes crashed status when agent exits non-zero without timeout', async () => {
    runAgentMock.mockResolvedValue({
      sessionId: 'sess-3',
      resultEvent: null,
      events: [systemInit('sess-3')],
      exitCode: 130,
      timedOut: false,
      stderr: 'Aborting operation...\n',
    });

    const invoker = createCursorAgentInvoker(baseInvokerConfig());
    const result = await invoker(
      { command: '/gsd/execute-plan', args: '/p', description: 'x' },
      '/workspace',
      logger,
      { goalTitle: 'Goal', phaseNumber: 3, planNumber: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('exit 130');
    const statuses = appendSessionLogMock.mock.calls.map((c) => c[1]?.status);
    expect(statuses).toEqual(['running', 'crashed']);
    expect(appendSessionLogMock.mock.calls[1]![1]).toMatchObject({
      status: 'crashed',
      sessionId: 'sess-3',
      error: expect.any(String),
    });
  });

  it('heartbeat writes at least once and is unlinked on completion', async () => {
    vi.useFakeTimers();
    runAgentMock.mockImplementation(async (opts: { onEvent?: (e: CursorStreamEvent) => void }) => {
      opts.onEvent?.(systemInit('sess-4'));
      return {
        sessionId: 'sess-4',
        resultEvent: resultEventSuccess(),
        events: [systemInit('sess-4'), resultEventSuccess()],
        exitCode: 0,
        timedOut: false,
        stderr: '',
      };
    });

    const invoker = createCursorAgentInvoker(baseInvokerConfig({ heartbeatIntervalMs: 10 }));
    const promise = invoker(
      { command: '/gsd/execute-plan', args: '/p', description: 'x' },
      '/workspace',
      logger,
      { goalTitle: 'Goal', phaseNumber: 3, planNumber: 1 },
    );

    // allow initial tick + at least one interval tick
    await vi.advanceTimersByTimeAsync(15);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(writeFileMock).toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/heartbeat.txt');
  });
});

