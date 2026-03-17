import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { runAgent } from './agent-runner.js';
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

const spawnMock = vi.fn<Parameters<SpawnFn>, ReturnType<SpawnFn>>();
const treeKillMock = vi.fn<
  Parameters<typeof treeKillType>,
  ReturnType<typeof treeKillType>
>();

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

describe('agent-runner spawn contract', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    treeKillMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns cursor-agent with stable args and prompt', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runAgent({
      agentPath: '/usr/bin/cursor-agent',
      workspace: '/tmp/workspace',
      prompt: '/gsd/execute-plan foo',
      timeoutMs: 0,
    });

    child.emit('close', 0);
    const result = await p;

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [agentPath, args, opts] = spawnMock.mock.calls[0]!;
    expect(agentPath).toBe('/usr/bin/cursor-agent');
    expect(args).toEqual([
      '-p',
      '--force',
      '--trust',
      '--approve-mcps',
      '--workspace',
      '/tmp/workspace',
      '--output-format',
      'stream-json',
      '/gsd/execute-plan foo',
    ]);
    expect((opts as any).stdio).toEqual(['pipe', 'pipe', 'pipe']);
  });

  it('appends --model and --resume flags when provided', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runAgent({
      agentPath: 'cursor-agent',
      workspace: '/w',
      prompt: 'hello',
      model: 'gpt-5',
      resumeId: 'resume-123',
      timeoutMs: 0,
    });

    child.emit('close', 0);
    await p;

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).toEqual([
      '-p',
      '--force',
      '--trust',
      '--approve-mcps',
      '--workspace',
      '/w',
      '--output-format',
      'stream-json',
      '--model',
      'gpt-5',
      '--resume',
      'resume-123',
      'hello',
    ]);
  });

  it('merges env passthrough with provided env', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    const p = runAgent({
      agentPath: 'cursor-agent',
      workspace: '/w',
      prompt: 'hello',
      env: { FOO: 'bar' },
      timeoutMs: 0,
    });

    child.emit('close', 0);
    await p;

    const [, , opts] = spawnMock.mock.calls[0]!;
    expect((opts as any).env).toMatchObject({ FOO: 'bar' });
  });

  it('aborts on timeout and resolves with timedOut: true', async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ReturnType<SpawnFn>);

    // Simulate tree-kill completing immediately.
    treeKillMock.mockImplementation(((_pid: any, _signal: any, cb: any) => cb?.(null)) as any);

    const promise = runAgent({
      agentPath: 'cursor-agent',
      workspace: '/w',
      prompt: 'hello',
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);

    // runAgent only resolves after close; emit it after timeout fires.
    child.emit('close', 0);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(treeKillMock).toHaveBeenCalled();
  });
});

