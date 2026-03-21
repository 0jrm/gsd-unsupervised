import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { initLogger } from '../logger.js';
import { loadConfig } from '../config.js';
import { getDaemonHealth } from '../daemon-health.js';
import { syncUpstreamGsd, type SyncUpstreamGsdResult } from '../gsd-sync.js';
import { createIntakeBundle, type IntakeBundleResult } from './bundle.js';
import { normalizeCliInput } from './normalizer.js';
import { classifyGoal, clarifyGoal, type ComplexityScore } from './clarifier.js';
import { queueGoal } from './goals-writer.js';

type CliIo = {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
};

type StartResult = {
  route: 'quick' | 'full';
  daemonAction: 'already-running' | 'update-only' | 'update-and-run';
  bundle: IntakeBundleResult;
};

function deriveSuccessCriteria(spec: string): string[] {
  const parts = spec
    .split(/[.!?]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  return parts.slice(0, 3);
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(String(answer ?? '')));
  });
}

async function launchDaemon(projectPath: string): Promise<void> {
  const runScript = path.join(projectPath, 'run');
  const useRunScript = existsSync(runScript);
  const command = useRunScript ? 'bash' : 'npx';
  const commandArgs = useRunScript
    ? ['./run']
    : ['--yes', 'gsd-unsupervised', 'run', '--state', '.gsd/state.json'];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectPath,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Daemon launcher exited with code ${code ?? -1}`));
    });
  });
}

export async function startCommand(
  args: {
    title?: string;
    projectPath?: string;
    body?: string;
    startDaemon?: boolean;
    updateOnly?: boolean;
  },
  io: CliIo = {},
  deps?: {
    syncFn?: typeof syncUpstreamGsd;
    createBundleFn?: typeof createIntakeBundle;
    healthFn?: typeof getDaemonHealth;
    launchDaemonFn?: typeof launchDaemon;
  },
): Promise<StartResult> {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const workspaceRoot = path.resolve(args.projectPath ?? process.cwd());
  const rl = createInterface({ input: stdin, output: stdout });
  const syncFn = deps?.syncFn ?? syncUpstreamGsd;
  const createBundleFn = deps?.createBundleFn ?? createIntakeBundle;
  const healthFn = deps?.healthFn ?? getDaemonHealth;
  const launchDaemonFn = deps?.launchDaemonFn ?? launchDaemon;

  try {
    const title = args.title?.trim() || (await ask(rl, 'What do you want to build? ')).trim();
    const body = args.body ?? ((await ask(rl, 'Any extra details or constraints? (optional) ')).trim() || undefined);

    const config = loadConfig({
      cliOverrides: { workspaceRoot },
      logger: initLogger({ level: 'silent', pretty: false }),
    });

    if (config.agent === 'cn') {
      console.warn(
        "Warning: start breadcrumb routing is only guaranteed for 'cursor' and 'codex'; current agent is 'cn'.",
      );
    }

    const syncResult: SyncUpstreamGsdResult = await syncFn({
      workspaceRoot,
      runtimes: ['cursor', 'codex'],
    });

    const rawGoal = normalizeCliInput(title, body, workspaceRoot);
    const complexity: ComplexityScore = await classifyGoal(rawGoal);
    const clarification = await clarifyGoal(rawGoal, complexity, workspaceRoot, undefined, {
      persistPending: false,
    });

    let clarifiedSpec = body?.trim() || title;
    let draftSpec = '';
    if (clarification.action === 'pending') {
      draftSpec = clarification.draftSpec;
      console.log(clarification.draftSpec);
      for (const question of clarification.questions) {
        console.log(question);
      }
      const answer = (await ask(
        rl,
        'Press ENTER/YES to accept the draft, or type an edited spec: ',
      )).trim();
      clarifiedSpec =
        answer.length === 0 || answer.toUpperCase() === 'YES'
          ? clarification.draftSpec || clarifiedSpec
          : answer;
    }

    const route = complexity.score <= 2 ? 'quick' : 'full';
    const bundle = await createBundleFn({
      workspaceRoot,
      rawGoal,
      complexity,
      route,
      runtimes: ['cursor', 'codex'],
      draftSpec,
      clarifiedSpec,
      upstream: {
        repoUrl: syncResult.manifest.repoUrl,
        repoSha: syncResult.manifest.repoSha,
        syncedAt: syncResult.manifest.syncedAt,
      },
    });

    await queueGoal({
      workspaceRoot,
      title,
      goalDescription: clarifiedSpec,
      successCriteria: deriveSuccessCriteria(clarifiedSpec),
      route,
      contextBundlePath: bundle.manifest.paths.bundleDir,
      sessionContextPath: bundle.manifest.paths.sessionContext,
      agentBriefPath: bundle.manifest.paths.agentBrief,
    });

    console.log(`Queued: ${title}`);
    console.log(`Route: ${route}`);
    console.log(`Bundle: ${bundle.manifest.paths.bundleDir}`);

    const health = await healthFn(workspaceRoot);
    if (health.running) {
      console.log(`Daemon already running (pid ${health.daemonPid ?? 'unknown'}). Updated queue only.`);
      return {
        route,
        daemonAction: 'already-running',
        bundle,
      };
    }

    const hasState = existsSync(path.join(workspaceRoot, '.gsd', 'state.json'));
    if (!hasState) {
      console.log('Daemon state not initialized. Updated queue only.');
      return {
        route,
        daemonAction: 'update-only',
        bundle,
      };
    }

    let shouldRun = false;
    if (args.startDaemon) {
      shouldRun = true;
    } else if (args.updateOnly) {
      shouldRun = false;
    } else {
      const answer = (await ask(
        rl,
        'Daemon not running. Type RUN to update and start the daemon, or press ENTER for update only: ',
      )).trim();
      shouldRun = answer.toUpperCase() === 'RUN';
    }

    if (!shouldRun) {
      console.log('Updated queue only.');
      return {
        route,
        daemonAction: 'update-only',
        bundle,
      };
    }

    console.log('Starting daemon...');
    await launchDaemonFn(workspaceRoot);
    return {
      route,
      daemonAction: 'update-and-run',
      bundle,
    };
  } finally {
    rl.close();
  }
}
