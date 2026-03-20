import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { runCodexCli } from './cursor-agent.js';
import type treeKillType from 'tree-kill';
import type { spawn as spawnType } from 'node:child_process';

type SpawnFn = typeof spawnType;

function createMockChildProcess(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as unknown as ChildProcess & EventEmitter;
  (child as any).pid = 12345;
  (child as any).stdout = new PassThrough();
  (child as any).stderr = new PassThrough();
  return child;
}

const spawnMock = vi.fn() as unknown as vi.Mock<ReturnType<SpawnFn>, Parameters<SpawnFn>>;
const treeKillMock = vi.fn() as unknown as vi.Mock<
  ReturnType<typeof treeKillType>,
  Parameters<typeof treeKillType>
>;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>(
    'node:child_process',
  );
  return {
    ...actual,
    spawn: ((
      ...args: Parameters<SpawnFn>
    ): ReturnType<SpawnFn> => spawnMock(...args)) as SpawnFn,
  };
});

vi.mock('tree-kill', () => {
  return {
    default: ((
      ...args: Parameters<typeof treeKillType>
    ): ReturnType<typeof treeKillType> => treeKillMock(...args)) as typeof treeKillType,
  };
});

describe('runCodexCli', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    treeKillMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns codex exec with non-interactive args', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runCodexCli({
      agentPath: 'codex',
      workspace: '/tmp/w',
      prompt: 'hello',
      timeoutMs: 0,
    });

    (child.stdout as PassThrough).write('{"session_id":"sess-1"}\n');
    child.emit('close', 0);
    await p;

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'never',
      '--cd',
      '/tmp/w',
      'hello',
    ]);
  });

  it('returns success on exit 0', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runCodexCli({
      agentPath: 'codex',
      workspace: '/tmp/w',
      prompt: 'hello',
      timeoutMs: 0,
    });

    (child.stdout as PassThrough).write('{"session_id":"sess-1"}\n');
    child.emit('close', 0);

    const result = await p;
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.sessionId).toBe('sess-1');
    expect(result.resultEvent?.is_error).toBe(false);
  });

  it('returns error result on non-zero exit', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runCodexCli({
      agentPath: 'codex',
      workspace: '/tmp/w',
      prompt: 'hello',
      timeoutMs: 0,
    });

    (child.stderr as PassThrough).write('boom');
    child.emit('close', 1);

    const result = await p;
    expect(result.exitCode).toBe(1);
    expect(result.resultEvent?.is_error).toBe(true);
  });

  it('aborts on timeout and returns timedOut true', async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);
    treeKillMock.mockImplementation(((_pid: unknown, _signal: unknown, cb: () => void) =>
      cb?.()) as typeof treeKillType);

    const p = runCodexCli({
      agentPath: 'codex',
      workspace: '/tmp/w',
      prompt: 'hello',
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    child.emit('close', 0);

    const result = await p;
    expect(result.timedOut).toBe(true);
    expect(treeKillMock).toHaveBeenCalled();
  });
});
