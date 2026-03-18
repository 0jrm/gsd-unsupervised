import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentInvoker } from './cursor-agent.js';
import type { AutopilotConfig } from './config.js';
import { initLogger } from './logger.js';

const baseConfig: AutopilotConfig = {
  goalsPath: './goals.md',
  parallel: false,
  maxConcurrent: 3,
  maxCpuFraction: 0.75,
  verbose: false,
  logLevel: 'info',
  workspaceRoot: '/tmp/test',
  agent: 'cursor',
  cursorAgentPath: '/usr/bin/cursor-agent',
  continueCliPath: 'cn',
  agentTimeoutMs: 60_000,
  sessionLogPath: '/tmp/session-log.jsonl',
  stateWatchDebounceMs: 500,
  requireCleanGitBeforePlan: true,
  autoCheckpoint: false,
};

describe('createAgentInvoker', () => {
  const logger = initLogger({ level: 'silent', pretty: false });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cursor adapter for agent cursor', () => {
    const invoker = createAgentInvoker('cursor', baseConfig);
    expect(invoker).toBeTypeOf('function');
    expect(invoker.length).toBe(4); // command, workspaceDir, logger, logContext
  });

  it('returns cn adapter for agent cn', () => {
    const invoker = createAgentInvoker('cn', { ...baseConfig, agent: 'cn' });
    expect(invoker).toBeTypeOf('function');
    expect(invoker.length).toBe(4);
  });

  it('returns non-throwing stub for claude-code', async () => {
    const invoker = createAgentInvoker('claude-code', baseConfig);
    const infoSpy = vi.spyOn(logger, 'info');
    const result = await invoker(
      { command: '/gsd/execute-plan', args: 'foo', description: 'test' },
      '/workspace',
      logger,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('stub');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Stub (claude-code)'),
    );
  });

  it('returns non-throwing stub for gemini-cli', async () => {
    const invoker = createAgentInvoker('gemini-cli', baseConfig);
    const infoSpy = vi.spyOn(logger, 'info');
    const result = await invoker(
      { command: '/gsd/plan-phase', args: '1', description: 'test' },
      '/workspace',
      logger,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('stub');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Stub (gemini-cli)'),
    );
  });

  it('returns non-throwing stub for codex', async () => {
    const invoker = createAgentInvoker('codex', baseConfig);
    const infoSpy = vi.spyOn(logger, 'info');
    const result = await invoker(
      { command: '/gsd/new-project', description: 'test' },
      '/workspace',
      logger,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('stub');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Stub (codex)'),
    );
  });

  it('stub adapters have same call signature as cursor', async () => {
    const stubInvoker = createAgentInvoker('claude-code', baseConfig);
    const result = await stubInvoker(
      { command: '/gsd/execute-plan', args: 'path', description: 'desc' },
      '/workspace',
      logger,
      { goalTitle: 'Goal', phaseNumber: 1, planNumber: 1 },
    );
    expect(result).toMatchObject({ success: true, output: 'stub' });
    expect(result.error).toBeUndefined();
  });
});
