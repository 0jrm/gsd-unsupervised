/**
 * Tests for post-plan verification hook.
 * Mocks execFile to control verify command outcome.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInvoker } from './orchestrator.js';
import { orchestrateGoal } from './orchestrator.js';
import type { Goal } from './goals.js';
import type { AutopilotConfig } from './config.js';
import { initLogger } from './logger.js';
import * as notifier from './notifier.js';

const execFileMock = vi.fn();
const appendSessionLogMock = vi.fn().mockResolvedValue(undefined);

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: vi.fn(),
}));

vi.mock('./session-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-log.js')>();
  return {
    ...actual,
    appendSessionLog: (...args: unknown[]) => appendSessionLogMock(...args),
  };
});

function makeBaseConfig(workspaceRoot: string): AutopilotConfig {
  return {
    goalsPath: join(workspaceRoot, 'goals.md'),
    parallel: false,
    maxConcurrent: 1,
    maxCpuFraction: 1,
    maxMemoryFraction: 1,
    verbose: false,
    logLevel: 'silent',
    workspaceRoot,
    agent: 'cursor',
    cursorAgentPath: 'cursor-agent',
    agentTimeoutMs: 60_000,
    sessionLogPath: join(workspaceRoot, 'session-log.jsonl'),
    stateWatchDebounceMs: 500,
    requireCleanGitBeforePlan: false,
    autoCheckpoint: false,
  };
}

function makeGoal(title: string): Goal {
  return {
    title,
    status: 'pending',
    raw: `- [ ] ${title}`,
  };
}

async function runWithVerifySetup(options: {
  workspace: string;
  verifyCommand: string;
  autoFixOnVerifyFail?: boolean;
  execFileBehavior: 'pass' | 'fail';
}) {
  const { workspace, verifyCommand, autoFixOnVerifyFail = false, execFileBehavior } = options;
  const planningDir = join(workspace, '.planning');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(join(planningDir, 'PROJECT.md'), '# Project\n', 'utf-8');

  const roadmapPath = join(planningDir, 'ROADMAP.md');
  const roadmapContent = [
    '# Roadmap',
    '',
    '- [ ] **Phase 1: Alpha** — Test phase',
    '',
  ].join('\n');
  writeFileSync(roadmapPath, roadmapContent, 'utf-8');

  const phase1Dir = join(planningDir, 'phases', '01-alpha');
  mkdirSync(phase1Dir, { recursive: true });
  writeFileSync(join(phase1Dir, '01-01-PLAN.md'), '# P1\n', 'utf-8');
  writeFileSync(join(phase1Dir, '01-01-SUMMARY.md'), '# S1\n', 'utf-8');
  writeFileSync(join(phase1Dir, '01-02-PLAN.md'), '# P2\n', 'utf-8');

  const onQueueFixGoal = vi.fn();
  const agent: AgentInvoker = async (cmd) => {
    if (cmd.command === '/gsd/execute-plan' && cmd.args) {
      const summaryPath = cmd.args.replace('-PLAN.md', '-SUMMARY.md');
      writeFileSync(summaryPath, '# Summary\n', 'utf-8');
    }
    return { success: true, output: 'ok' };
  };

  execFileMock.mockImplementation((_cmd: string, _args: string[], opts: { cwd?: string }, cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    if (execFileBehavior === 'pass') {
      setImmediate(() => cb(null, '', ''));
    } else {
      const err = Object.assign(new Error('Verify failed'), { code: 1, stderr: 'npm test failed' });
      setImmediate(() => cb(err as NodeJS.ErrnoException, '', 'npm test failed'));
    }
  });

  const logger = initLogger({ level: 'silent', pretty: false });
  const sendSmsSpy = vi.spyOn(notifier, 'sendSms').mockResolvedValue();

  const config: AutopilotConfig = {
    ...makeBaseConfig(workspace),
    verifyCommand,
    autoFixOnVerifyFail,
  };

  await orchestrateGoal({
    goal: makeGoal('Verify test'),
    config,
    logger,
    agent,
    isShuttingDown: () => false,
    onQueueFixGoal: autoFixOnVerifyFail ? onQueueFixGoal : undefined,
  });

  sendSmsSpy.mockRestore();

  return {
    appendSessionLogMock,
    onQueueFixGoal,
    execFileMock,
  };
}

describe('orchestrator verify hook', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'orchestrator-verify-'));
    execFileMock.mockReset();
    appendSessionLogMock.mockClear();
  });

  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('verify passes → no verify-failed log, no onQueueFixGoal', async () => {
    const { appendSessionLogMock, onQueueFixGoal, execFileMock } = await runWithVerifySetup({
      workspace,
      verifyCommand: 'npm test',
      autoFixOnVerifyFail: false,
      execFileBehavior: 'pass',
    });

    expect(execFileMock).toHaveBeenCalled();
    const verifyFailedCalls = appendSessionLogMock.mock.calls.filter(
      (c) => (c[1] as { status?: string })?.status === 'verify-failed',
    );
    expect(verifyFailedCalls).toHaveLength(0);
    expect(onQueueFixGoal).not.toHaveBeenCalled();
  }, 15000);

  it('verify fails + autoFix false → warn only (append verify-failed, no onQueueFixGoal)', async () => {
    const { appendSessionLogMock, onQueueFixGoal, execFileMock } = await runWithVerifySetup({
      workspace,
      verifyCommand: 'npm test',
      autoFixOnVerifyFail: false,
      execFileBehavior: 'fail',
    });

    expect(execFileMock).toHaveBeenCalled();
    const verifyFailedCalls = appendSessionLogMock.mock.calls.filter(
      (c) => (c[1] as { status?: string })?.status === 'verify-failed',
    );
    expect(verifyFailedCalls).toHaveLength(1);
    expect((verifyFailedCalls[0]![1] as { error?: string }).error).toContain('npm test failed');
    expect(onQueueFixGoal).not.toHaveBeenCalled();
  }, 15000);

  it('verify fails + autoFix true → onQueueFixGoal called with stderr in body', async () => {
    const { appendSessionLogMock, onQueueFixGoal } = await runWithVerifySetup({
      workspace,
      verifyCommand: 'npm test',
      autoFixOnVerifyFail: true,
      execFileBehavior: 'fail',
    });

    const verifyFailedCalls = appendSessionLogMock.mock.calls.filter(
      (c) => (c[1] as { status?: string })?.status === 'verify-failed',
    );
    expect(verifyFailedCalls).toHaveLength(1);
    expect(onQueueFixGoal).toHaveBeenCalledTimes(1);
    const [title, body] = onQueueFixGoal.mock.calls[0]!;
    expect(title).toMatch(/^Fix: verify failed after .*01-02-PLAN\.md$/);
    expect(body).toBe('npm test failed');
  }, 15000);
});
