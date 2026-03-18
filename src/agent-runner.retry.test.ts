import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentWithRetry, type RunAgentResult, type RunAgentOptions } from './agent-runner.js';

function result(overrides: Partial<RunAgentResult>): RunAgentResult {
  return {
    sessionId: null,
    resultEvent: null,
    events: [],
    exitCode: 0,
    timedOut: false,
    stderr: '',
    ...overrides,
  };
}

describe('runAgentWithRetry', () => {
  const logger = { debug: () => {}, info: () => {}, warn: vi.fn(), error: () => {}, child: () => logger as any };
  const baseOptions: RunAgentOptions = {
    agentPath: '/bin/agent',
    workspace: '/ws',
    prompt: 'test',
    timeoutMs: 5000,
    logger,
  };

  beforeEach(() => {
    logger.warn.mockClear();
  });

  it('succeeds on first attempt and does not retry', async () => {
    const runFn = vi.fn().mockResolvedValueOnce(result({ exitCode: 0 }));
    const policy = { maxAttempts: 3, backoffMs: [100, 200], nonRetryableExitCodes: [1, 127] };
    const out = await runAgentWithRetry(baseOptions, policy, logger as any, runFn);
    expect(out.exitCode).toBe(0);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('retries on retriable failure then succeeds', async () => {
    const runFn = vi.fn()
      .mockResolvedValueOnce(result({ exitCode: 137 }))
      .mockResolvedValueOnce(result({ exitCode: 0 }));
    const policy = { maxAttempts: 3, backoffMs: [10, 20], nonRetryableExitCodes: [1, 127] };
    const out = await runAgentWithRetry(baseOptions, policy, logger as any, runFn);
    expect(out.exitCode).toBe(0);
    expect(runFn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, maxAttempts: 3, reason: expect.any(String) }),
      'agent invocation failed, retrying',
    );
  });

  it('does not retry on non-retryable exit code', async () => {
    const runFn = vi.fn().mockResolvedValueOnce(result({ exitCode: 1 }));
    const policy = { maxAttempts: 3, backoffMs: [100, 200], nonRetryableExitCodes: [1, 127] };
    const out = await runAgentWithRetry(baseOptions, policy, logger as any, runFn);
    expect(out.exitCode).toBe(1);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stops after maxAttempts and returns last result', async () => {
    const runFn = vi.fn()
      .mockResolvedValueOnce(result({ exitCode: 2 }))
      .mockResolvedValueOnce(result({ exitCode: 2 }))
      .mockResolvedValueOnce(result({ exitCode: 2 }));
    const policy = { maxAttempts: 3, backoffMs: [10, 10], nonRetryableExitCodes: [1, 127] };
    const out = await runAgentWithRetry(baseOptions, policy, logger as any, runFn);
    expect(out.exitCode).toBe(2);
    expect(runFn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
