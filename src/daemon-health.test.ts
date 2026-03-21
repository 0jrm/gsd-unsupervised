import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDaemonHealth } from './daemon-health.js';

describe('daemon-health', () => {
  let workspaceRoot = '';

  afterEach(() => {
    vi.restoreAllMocks();
    if (workspaceRoot) {
      rmSync(workspaceRoot, { recursive: true, force: true });
      workspaceRoot = '';
    }
  });

  it('reports missing-state when no .gsd/state.json exists', async () => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'daemon-health-'));
    const health = await getDaemonHealth(workspaceRoot);
    expect(health.running).toBe(false);
    expect(health.reason).toBe('missing-state');
  });

  it('reports stale-heartbeat when the heartbeat is too old', async () => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'daemon-health-'));
    mkdirSync(path.join(workspaceRoot, '.gsd'), { recursive: true });
    writeFileSync(
      path.join(workspaceRoot, '.gsd', 'state.json'),
      JSON.stringify({
        workspaceRoot,
        goalsPath: './goals.md',
        daemonPid: 12345,
        lastHeartbeat: '2026-03-20T09:00:00.000Z',
      }),
      'utf-8',
    );
    vi.spyOn(process, 'kill').mockImplementation(() => true as never);

    const health = await getDaemonHealth(workspaceRoot, {
      nowMs: new Date('2026-03-20T10:00:00.000Z').getTime(),
      heartbeatMaxAgeMs: 30_000,
    });
    expect(health.running).toBe(false);
    expect(health.reason).toBe('stale-heartbeat');
  });

  it('reports healthy when the daemon pid is alive and heartbeat is fresh', async () => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'daemon-health-'));
    mkdirSync(path.join(workspaceRoot, '.gsd'), { recursive: true });
    writeFileSync(
      path.join(workspaceRoot, '.gsd', 'state.json'),
      JSON.stringify({
        workspaceRoot,
        goalsPath: './goals.md',
        daemonPid: 12345,
        lastHeartbeat: '2026-03-20T09:59:50.000Z',
      }),
      'utf-8',
    );
    vi.spyOn(process, 'kill').mockImplementation(() => true as never);

    const health = await getDaemonHealth(workspaceRoot, {
      nowMs: new Date('2026-03-20T10:00:00.000Z').getTime(),
      heartbeatMaxAgeMs: 30_000,
    });
    expect(health.running).toBe(true);
    expect(health.reason).toBe('healthy');
  });
});
