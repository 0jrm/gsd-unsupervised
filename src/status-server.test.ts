import { describe, it, expect, afterEach } from 'vitest';
import { createStatusServer } from './status-server.js';

describe('status-server', () => {
  const port = 0; // let OS pick
  let close: () => Promise<void>;

  afterEach(async () => {
    if (close) await close();
  });

  it('serves GET /status with JSON', async () => {
    const payload = { running: true, currentGoal: 'Test' };
    const { server, close: c } = createStatusServer(port, () => payload);
    close = c;
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const url = `http://127.0.0.1:${address.port}/status`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual(payload);
  });

  it('serves GET / with same JSON', async () => {
    const payload = { running: false };
    const { server, close: c } = createStatusServer(port, () => payload);
    close = c;
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const url = `http://127.0.0.1:${address.port}/`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(payload);
  });

  it('returns 404 for other paths', async () => {
    const { server, close: c } = createStatusServer(port, () => ({ running: false }));
    close = c;
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const res = await fetch(`http://127.0.0.1:${address.port}/other`);
    expect(res.status).toBe(404);
  });

  it('serves GET /api/status with rich dashboard JSON when options provided', async () => {
    const payload = { running: true, currentGoal: 'Goal', phaseNumber: 6, planNumber: 2 };
    const { server, close: c } = createStatusServer(port, () => payload, {
      stateMdPath: '/nonexistent/STATE.md',
      sessionLogPath: '/nonexistent/session-log.jsonl',
      workspaceRoot: process.cwd(),
    });
    close = c;
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected port binding');
    const res = await fetch(`http://127.0.0.1:${address.port}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.running).toBe(true);
    expect(body.currentGoal).toBe('Goal');
    expect(body.phaseNumber).toBe(6);
    expect(body.planNumber).toBe(2);
    expect(body).toHaveProperty('tokens');
    expect(body).toHaveProperty('cost');
    expect(Array.isArray(body.sessionLogEntries)).toBe(true);
    expect(Array.isArray(body.gitFeed)).toBe(true);
  });
});
