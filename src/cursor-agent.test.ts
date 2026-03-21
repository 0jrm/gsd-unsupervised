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
  codexCliPath: 'codex',
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

  it('returns codex adapter for agent codex', () => {
    const invoker = createAgentInvoker('codex', baseConfig);
    expect(invoker).toBeTypeOf('function');
    expect(invoker.length).toBe(4);
  });

});
