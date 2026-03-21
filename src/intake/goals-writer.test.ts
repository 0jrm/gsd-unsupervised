import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../notifier.js', () => ({
  sendSms: vi.fn(),
}));

import { sendSms } from '../notifier.js';
import { queueGoal, notifyQueued } from './goals-writer.js';

describe('intake/goals-writer', () => {
  let workspaceRoot: string;
  let goalsPath: string;
  let gsdDir: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'goals-writer-'));
    goalsPath = join(workspaceRoot, 'goals.md');
    gsdDir = join(workspaceRoot, '.gsd');
    mkdirSync(gsdDir, { recursive: true });

    // Minimal valid fixture for every test unless explicitly overwritten.
    writeFileSync(
      goalsPath,
      [
        '# GSD Autopilot Goals Queue',
        '',
        '## Pending',
        '- [ ] First existing',
        '',
        '## In Progress',
        '<!-- orchestrator moves goals here while running -->',
        '',
        '## Done',
        '<!-- orchestrator moves goals here on completion -->',
        '',
      ].join('\n'),
      'utf-8',
    );

    vi.clearAllMocks();
  });

  function readGoals(): string {
    return readFileSync(goalsPath, 'utf-8');
  }

  afterEach(() => {
    try {
      rmSync(workspaceRoot, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('queueGoal appends "- [ ] [title]" under ## Pending', async () => {
    await queueGoal({
      workspaceRoot,
      title: 'fix auth bug',
      successCriteria: [],
      replyTo: undefined,
    });

    const content = readGoals();
    expect(content).toContain('## Pending');
    expect(content).toContain('- [ ] fix auth bug');
  });

  it('queueGoal appends after the last pending item (not before)', async () => {
    writeFileSync(
      goalsPath,
      [
        '# Goals',
        '',
        '## Pending',
        '- [ ] First',
        '- [ ] Second',
        '',
        '## In Progress',
        '',
        '## Done',
        '',
      ].join('\n'),
      'utf-8',
    );

    await queueGoal({ workspaceRoot, title: 'Third', successCriteria: [], replyTo: undefined });

    const content = readGoals();
    const firstIdx = content.indexOf('- [ ] First');
    const secondIdx = content.indexOf('- [ ] Second');
    const thirdIdx = content.indexOf('- [ ] Third');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);
    expect(thirdIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('queueGoal creates goals.md with correct structure if file does not exist', async () => {
    rmSync(goalsPath);

    await queueGoal({ workspaceRoot, title: 'Hello world', successCriteria: [], replyTo: undefined });

    const content = readGoals();
    expect(content).toContain('# GSD Autopilot Goals Queue');
    expect(content).toContain('## Pending');
    expect(content).toContain('- [ ] Hello world');
    expect(content).toContain('## In Progress');
    expect(content).toContain('## Done');
  });

  it('queueGoal touches .gsd/goals-updated (mtime changes)', async () => {
    const touchPath = join(gsdDir, 'goals-updated');
    await queueGoal({ workspaceRoot, title: 'A', successCriteria: [], replyTo: undefined });
    const t1 = statSync(touchPath).mtimeMs;

    // Ensure mtime differs on fast filesystems.
    await new Promise((r) => setTimeout(r, 10));

    await queueGoal({ workspaceRoot, title: 'B', successCriteria: [], replyTo: undefined });
    const t2 = statSync(touchPath).mtimeMs;
    expect(t2).toBeGreaterThan(t1);
  });

  it('queueGoal with successCriteria appends "<!-- success: ... -->" comment on next line', async () => {
    await queueGoal({
      workspaceRoot,
      title: 'build endpoint',
      successCriteria: ['returns 200 and JSON'],
      replyTo: undefined,
    });

    const content = readGoals();
    const idx = content.indexOf('- [ ] build endpoint');
    expect(idx).toBeGreaterThan(-1);
    const after = content.slice(idx);
    expect(after).toContain('<!-- success: returns 200 and JSON -->');
  });

  it('queueGoal writes a structured metadata block when breadcrumb fields are provided', async () => {
    await queueGoal({
      workspaceRoot,
      title: 'bootstrap start flow',
      goalDescription: 'Create the intake-driven start entrypoint.',
      successCriteria: ['Writes intake bundle', 'Queues goal with route metadata'],
      route: 'full',
      contextBundlePath: '.planning/intake/start-flow',
      sessionContextPath: '.planning/intake/start-flow/SESSION-CONTEXT.md',
      agentBriefPath: '.planning/intake/start-flow/AGENT-BRIEF.md',
      replyTo: undefined,
    });

    const content = readGoals();
    expect(content).toContain('- [ ] bootstrap start flow');
    expect(content).toContain('### bootstrap start flow');
    expect(content).toContain('**Goal:** Create the intake-driven start entrypoint.');
    expect(content).toContain('**Route:** full');
    expect(content).toContain('**Context bundle:** .planning/intake/start-flow');
    expect(content).toContain('**Session context:** .planning/intake/start-flow/SESSION-CONTEXT.md');
    expect(content).toContain('**Agent brief:** .planning/intake/start-flow/AGENT-BRIEF.md');
  });

  it('notifyQueued calls sendSms when replyTo is set', async () => {
    (sendSms as unknown as { mock: { calls: any[][] } }).mockResolvedValue(undefined);

    await notifyQueued({
      workspaceRoot,
      title: 'fix auth bug',
      replyTo: '+15551234567',
    });

    const calls = (sendSms as any).mock.calls as any[][];
    expect(calls.length).toBe(1);
    const message = String(calls[0]?.[0] ?? '');
    expect(message).toContain('fix auth bug');
  });

  it('notifyQueued does not throw when sendSms rejects (fire-and-forget)', async () => {
    (sendSms as any).mockRejectedValue(new Error('twilio down'));

    await expect(
      notifyQueued({
        workspaceRoot,
        title: 'fix auth bug',
        replyTo: '+15551234567',
      }),
    ).resolves.toBeUndefined();

    // Allow queued catch handler to run without creating an unhandled rejection.
    await new Promise((r) => setTimeout(r, 0));
  });
});
