import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { runContinueCli } from './cursor-agent.js';
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

describe('runContinueCli', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    treeKillMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns success on exit 0 with stdout as result', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runContinueCli({
      agentPath: '/usr/bin/cn',
      workspace: '/tmp/w',
      prompt: 'hello',
      timeoutMs: 0,
    });

    (child.stdout as PassThrough).write('output line 1\noutput line 2');
    (child.stdout as PassThrough).end();
    child.emit('close', 0);

    const result = await p;

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.resultEvent).not.toBeNull();
    expect(result.resultEvent!.is_error).toBe(false);
    expect(result.resultEvent!.result).toBe('output line 1\noutput line 2');
    expect(result.sessionId).toBe(null);

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args).toContain('--allow');
    expect(args).toContain('Write()');
    expect(args).toContain('Bash()');
    expect(args).toContain('Read()');
  });

  it('returns crashed on nonzero exit', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runContinueCli({
      agentPath: 'cn',
      workspace: '/w',
      prompt: 'fail',
      timeoutMs: 0,
    });

    (child.stderr as PassThrough).write('Error: something');
    child.emit('close', 1);

    const result = await p;

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.sessionId).toBe(null);
  });

  it('aborts on timeout and resolves with timedOut true', async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    treeKillMock.mockImplementation(((_pid: unknown, _signal: unknown, cb: () => void) =>
      cb?.()) as typeof treeKillType);

    const promise = runContinueCli({
      agentPath: 'cn',
      workspace: '/w',
      prompt: 'slow',
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    child.emit('close', 0);

    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(treeKillMock).toHaveBeenCalled();
  });

  it('passes --config when configPath provided', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runContinueCli({
      agentPath: 'cn',
      workspace: '/w',
      prompt: 'hi',
      configPath: '/w/.continue/config.yaml',
      timeoutMs: 0,
    });

    child.emit('close', 0);
    await p;

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args[0]).toBe('--config');
    expect(args[1]).toBe('/w/.continue/config.yaml');
  });
});
