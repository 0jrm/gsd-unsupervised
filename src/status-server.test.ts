import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { createStatusServer } from './status-server.js';

describe('status-server', () => {
  const port = 0; // let OS pick
  let close: () => Promise<void>;

  afterEach(async () => {
    if (close) await close();
  });

  async function listen(server: import('node:http').Server): Promise<number> {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    return (address as import('node:net').AddressInfo).port;
  }

  it('serves GET /status with JSON', async () => {
    const payload = { running: true, currentGoal: 'Test' };
    const result = await createStatusServer(port, () => payload);
    expect(result.server).not.toBeNull();
    close = result.close;
    const address = result.server!.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const url = `http://127.0.0.1:${(address as import('node:net').AddressInfo).port}/status`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual(payload);
  });

  it('serves GET / with same JSON', async () => {
    const payload = { running: false };
    const result = await createStatusServer(port, () => payload);
    expect(result.server).not.toBeNull();
    close = result.close;
    const address = result.server!.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const url = `http://127.0.0.1:${(address as import('node:net').AddressInfo).port}/`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(payload);
  });

  it('returns 404 for other paths', async () => {
    const result = await createStatusServer(port, () => ({ running: false }));
    expect(result.server).not.toBeNull();
    close = result.close;
    const address = result.server!.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const res = await fetch(`http://127.0.0.1:${(address as import('node:net').AddressInfo).port}/other`);
    expect(res.status).toBe(404);
  });

  it('serves GET / as dashboard HTML when options provided', async () => {
    const payload = { running: true, currentGoal: 'Goal' };
    const result = await createStatusServer(port, () => payload, {
      stateMdPath: '/nonexistent/STATE.md',
      sessionLogPath: '/nonexistent/session-log.jsonl',
      workspaceRoot: process.cwd(),
    });
    expect(result.server).not.toBeNull();
    close = result.close;
    const address = result.server!.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const res = await fetch(`http://127.0.0.1:${(address as import('node:net').AddressInfo).port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('GSD Autopilot');
    expect(html).toContain('/api/status');
    expect(html).toContain('10000');
  });

  it('serves GET /status with JSON even when options provided', async () => {
    const payload = { running: true, currentGoal: 'Goal' };
    const result = await createStatusServer(port, () => payload, {
      stateMdPath: '/nonexistent/STATE.md',
      sessionLogPath: '/nonexistent/session-log.jsonl',
      workspaceRoot: process.cwd(),
    });
    expect(result.server).not.toBeNull();
    close = result.close;
    const address = result.server!.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const res = await fetch(`http://127.0.0.1:${(address as import('node:net').AddressInfo).port}/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(payload);
  });

  it('serves GET /api/status with rich dashboard JSON when options provided', async () => {
    const payload = {
      running: true,
      currentGoal: 'Goal',
      phaseNumber: 6,
      planNumber: 2,
      paused: true,
      pauseFlagPath: '/tmp/.pause-autopilot',
    };
    const result = await createStatusServer(port, () => payload, {
      stateMdPath: '/nonexistent/STATE.md',
      sessionLogPath: '/nonexistent/session-log.jsonl',
      workspaceRoot: process.cwd(),
    });
    expect(result.server).not.toBeNull();
    close = result.close;
    const address = result.server!.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const res = await fetch(`http://127.0.0.1:${(address as import('node:net').AddressInfo).port}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.running).toBe(true);
    expect(body.currentGoal).toBe('Goal');
    expect(body.phaseNumber).toBe(6);
    expect(body.planNumber).toBe(2);
    expect(body.paused).toBe(true);
    expect(body.pauseFlagPath).toBe('/tmp/.pause-autopilot');
    expect(body).toHaveProperty('tokens');
    expect(body).toHaveProperty('cost');
    expect(Array.isArray(body.sessionLogEntries)).toBe(true);
    expect(Array.isArray(body.gitFeed)).toBe(true);
  });

  it('serves GET /api/config when planningConfigPath provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'status-server-config-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ parallelization: { enabled: false } }),
      'utf-8',
    );
    const result = await createStatusServer(port, () => ({ running: false }), {
      stateMdPath: '/n/s.md',
      sessionLogPath: '/n/s.jsonl',
      workspaceRoot: process.cwd(),
      planningConfigPath: configPath,
    });
    expect(result.server).not.toBeNull();
    close = result.close;
    const p = await listen(result.server!);
    const res = await fetch(`http://127.0.0.1:${p}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parallelization).toBeDefined();
    expect(body.parallelization.enabled).toBe(false);
    rmSync(dir, { recursive: true });
  });

  it('POST /api/config updates and persists parallelization', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'status-server-config-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ parallelization: { enabled: false } }),
      'utf-8',
    );
    const result = await createStatusServer(port, () => ({ running: false }), {
      stateMdPath: '/n/s.md',
      sessionLogPath: '/n/s.jsonl',
      workspaceRoot: process.cwd(),
      planningConfigPath: configPath,
    });
    expect(result.server).not.toBeNull();
    close = result.close;
    const p = await listen(result.server!);
    const postRes = await fetch(`http://127.0.0.1:${p}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parallelization: { enabled: true } }),
    });
    expect(postRes.status).toBe(200);
    const updated = await postRes.json();
    expect(updated.parallelization.enabled).toBe(true);
    const getRes = await fetch(`http://127.0.0.1:${p}/api/config`);
    const getBody = await getRes.json();
    expect(getBody.parallelization.enabled).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it('POST /api/config with invalid parallelization.enabled returns 400', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'status-server-config-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify({}), 'utf-8');
    const result = await createStatusServer(port, () => ({ running: false }), {
      stateMdPath: '/n/s.md',
      sessionLogPath: '/n/s.jsonl',
      workspaceRoot: process.cwd(),
      planningConfigPath: configPath,
    });
    expect(result.server).not.toBeNull();
    close = result.close;
    const p = await listen(result.server!);
    const res = await fetch(`http://127.0.0.1:${p}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parallelization: { enabled: 'yes' } }),
    });
    expect(res.status).toBe(400);
    rmSync(dir, { recursive: true });
  });

  it('degrades gracefully when port is already in use (EADDRINUSE)', async () => {
    const payload = { running: true, currentGoal: 'First' };
    const first = await createStatusServer(0, () => payload);
    expect(first.server).not.toBeNull();
    close = first.close;
    const usedPort = (first.server!.address() as import('node:net').AddressInfo).port;
    const second = await createStatusServer(usedPort, () => ({ running: false }), {
      stateMdPath: '/n/s.md',
      sessionLogPath: '/n/s.jsonl',
      workspaceRoot: process.cwd(),
    });
    expect(second.server).toBeNull();
    await first.close();
    close = async () => {};
  });
});
