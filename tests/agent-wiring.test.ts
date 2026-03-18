/**
 * Verifies that the daemon wires config.agent into createAgentInvoker
 * and that the selected agent ID is passed to the factory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cursorAgent from '../src/cursor-agent.js';
import { runDaemon } from '../src/daemon.js';
import { initLogger } from '../src/logger.js';

describe('agent wiring', () => {
  let workspace: string;
  let goalsPath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'agent-wiring-'));
    goalsPath = join(workspace, 'goals.md');
    writeFileSync(
      goalsPath,
      '## Pending\n- [ ] Test goal\n\n## In Progress\n\n## Done\n',
      'utf-8',
    );
    const planningDir = join(workspace, '.planning');
    mkdirSync(planningDir, { recursive: true });
    writeFileSync(
      join(planningDir, 'ROADMAP.md'),
      '- [ ] **Phase 1: Test** — Minimal phase\n',
      'utf-8',
    );
    writeFileSync(
      join(planningDir, 'STATE.md'),
      '## Current Position\nPhase: 1 of 1\nPlan: 0 of 0\nStatus: Ready\n',
      'utf-8',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(workspace, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('createAgentInvoker is called with config.agent when daemon runs', async () => {
    const createAgentInvokerSpy = vi.spyOn(cursorAgent, 'createAgentInvoker');
    const logger = initLogger({ level: 'silent', pretty: false });

    await runDaemon(
      {
        goalsPath,
        parallel: false,
        maxConcurrent: 3,
        verbose: false,
        logLevel: 'info',
        workspaceRoot: workspace,
        agent: 'claude-code',
        cursorAgentPath: 'cursor-agent',
        agentTimeoutMs: 60_000,
        sessionLogPath: join(workspace, 'session-log.jsonl'),
        stateWatchDebounceMs: 500,
        requireCleanGitBeforePlan: false,
        autoCheckpoint: false,
      },
      logger,
    );

    expect(createAgentInvokerSpy).toHaveBeenCalledWith(
      'claude-code',
      expect.objectContaining({ workspaceRoot: workspace }),
      expect.any(Object),
    );
  });

  it('createAgentInvoker is called with cursor when config.agent is cursor', async () => {
    const createAgentInvokerSpy = vi.spyOn(cursorAgent, 'createAgentInvoker').mockImplementation(() => {
      return async () => ({ success: true, output: 'mocked' });
    });
    const logger = initLogger({ level: 'silent', pretty: false });

    await runDaemon(
      {
        goalsPath,
        parallel: false,
        maxConcurrent: 3,
        verbose: false,
        logLevel: 'info',
        workspaceRoot: workspace,
        agent: 'cursor',
        cursorAgentPath: 'cursor-agent',
        agentTimeoutMs: 60_000,
        sessionLogPath: join(workspace, 'session-log.jsonl'),
        stateWatchDebounceMs: 500,
        requireCleanGitBeforePlan: false,
        autoCheckpoint: false,
      },
      logger,
    );

    expect(createAgentInvokerSpy).toHaveBeenCalledWith(
      'cursor',
      expect.objectContaining({ workspaceRoot: workspace }),
      expect.any(Object),
    );
  });

  it('createAgentInvoker is called with claude-code when config.agent is claude-code', async () => {
    const createAgentInvokerSpy = vi.spyOn(cursorAgent, 'createAgentInvoker');
    const logger = initLogger({ level: 'silent', pretty: false });

    await runDaemon(
      {
        goalsPath,
        parallel: false,
        maxConcurrent: 3,
        verbose: false,
        logLevel: 'info',
        workspaceRoot: workspace,
        agent: 'claude-code',
        cursorAgentPath: 'cursor-agent',
        agentTimeoutMs: 60_000,
        sessionLogPath: join(workspace, 'session-log.jsonl'),
        stateWatchDebounceMs: 500,
        requireCleanGitBeforePlan: false,
        autoCheckpoint: false,
      },
      logger,
    );

    expect(createAgentInvokerSpy).toHaveBeenCalledWith(
      'claude-code',
      expect.any(Object),
      expect.any(Object),
    );
  });
});
