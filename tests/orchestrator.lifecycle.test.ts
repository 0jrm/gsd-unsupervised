import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInvoker } from '../src/orchestrator.js';
import { orchestrateGoal } from '../src/orchestrator.js';
import type { Goal } from '../src/goals.js';
import type { AutopilotConfig } from '../src/config.js';
import { initLogger } from '../src/logger.js';
import * as notifier from '../src/notifier.js';

interface RecordedCommand {
  command: string;
  args?: string;
}

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

async function runWithRecording(options: {
  workspace: string;
  precreateProject?: boolean;
  precreateRoadmap?: boolean;
}) {
  const { workspace, precreateProject, precreateRoadmap } = options;
  const planningDir = join(workspace, '.planning');
  mkdirSync(planningDir, { recursive: true });

  if (precreateProject) {
    writeFileSync(join(planningDir, 'PROJECT.md'), '# Project\n', 'utf-8');
  }

  const roadmapPath = join(planningDir, 'ROADMAP.md');
  const roadmapContent = [
    '# Roadmap',
    '',
    '- [ ] **Phase 1: Alpha** — Test phase',
    '- [ ] **Phase 2: Beta** — Second phase',
    '',
  ].join('\n');

  if (precreateRoadmap) {
    writeFileSync(roadmapPath, roadmapContent, 'utf-8');
  }

  // Phase 1 directory with one executed and one unexecuted plan.
  const phase1Dir = join(planningDir, 'phases', '01-alpha');
  mkdirSync(phase1Dir, { recursive: true });
  writeFileSync(join(phase1Dir, '01-01-PLAN.md'), '# P1\n', 'utf-8');
  writeFileSync(join(phase1Dir, '01-01-SUMMARY.md'), '# S1\n', 'utf-8');
  writeFileSync(join(phase1Dir, '01-02-PLAN.md'), '# P2\n', 'utf-8');

  // Intentionally do NOT create a directory for Phase 2 ("02-beta") to ensure
  // the orchestrator skips execute-plan for that phase but continues planning.

  const recorded: RecordedCommand[] = [];

  const agent: AgentInvoker = async (cmd) => {
    recorded.push({ command: cmd.command, args: cmd.args });

    if (cmd.command === '/gsd/create-roadmap') {
      writeFileSync(roadmapPath, roadmapContent, 'utf-8');
    }

    // Simulate execute-plan creating a SUMMARY file so orchestrator
    // observes the plan as executed and moves on.
    if (cmd.command === '/gsd/execute-plan' && cmd.args) {
      const summaryPath = cmd.args.replace('-PLAN.md', '-SUMMARY.md');
      writeFileSync(summaryPath, '# Summary\n', 'utf-8');
    }

    return { success: true, output: 'ok' };
  };

  const logger = initLogger({ level: 'silent', pretty: false });
  const sendSmsSpy = vi.spyOn(notifier, 'sendSms').mockResolvedValue();

  const config = makeBaseConfig(workspace);

  await orchestrateGoal({
    goal: makeGoal('Lifecycle orchestration test'),
    config,
    logger,
    agent,
    isShuttingDown: () => false,
  });

  sendSmsSpy.mockRestore();

  return recorded;
}

describe('orchestrator lifecycle', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'orchestrator-lifecycle-'));
  });

  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true });
    } catch {
      // ignore cleanup errors in tests
    }
  });

  it(
    'issues commands in correct order for a fresh workspace',
    async () => {
    const commands = await runWithRecording({
      workspace,
      precreateProject: false,
      precreateRoadmap: false,
    });

    const rendered = commands.map((c) =>
      c.args ? `${c.command} ${c.args}` : c.command,
    );

    expect(rendered[0]).toBe('/gsd/new-project');
    expect(rendered[1]).toBe('/gsd/create-roadmap');

    // Then plan-phase and execute-plan at plan granularity.
    expect(rendered).toContain('/gsd/plan-phase 1');
    expect(rendered).toContain(
      `/gsd/execute-plan ${join(
        workspace,
        '.planning',
        'phases',
        '01-alpha',
        '01-02-PLAN.md',
      )}`,
    );

    // Phase 2 is planned but has no phase directory; orchestrator should still
    // plan the phase but must not attempt execute-plan for it.
    expect(rendered).toContain('/gsd/plan-phase 2');
    expect(
      rendered.some(
        (c) =>
          c.startsWith('/gsd/execute-plan') &&
          c.includes(join('.planning', 'phases', '02-beta')),
      ),
    ).toBe(false);
    },
    30000,
  );

  it(
    'skips /gsd/new-project and /gsd/create-roadmap when artifacts already exist',
    async () => {
    const commands = await runWithRecording({
      workspace,
      precreateProject: true,
      precreateRoadmap: true,
    });

    const rendered = commands.map((c) =>
      c.args ? `${c.command} ${c.args}` : c.command,
    );

    expect(rendered[0]).toBe('/gsd/plan-phase 1');
    expect(rendered).not.toContain('/gsd/new-project');
    expect(rendered).not.toContain('/gsd/create-roadmap');

    // Still executes only unexecuted plans and skips missing phase directories.
    expect(rendered).toContain(
      `/gsd/execute-plan ${join(
        workspace,
        '.planning',
        'phases',
        '01-alpha',
        '01-02-PLAN.md',
      )}`,
    );
    expect(rendered).toContain('/gsd/plan-phase 2');
    expect(
      rendered.some(
        (c) =>
          c.startsWith('/gsd/execute-plan') &&
          c.includes(join('.planning', 'phases', '02-beta')),
      ),
    ).toBe(false);
    },
    60000,
  );
});

