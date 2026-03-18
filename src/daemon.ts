import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import chokidar from 'chokidar';
import type { AutopilotConfig } from './config.js';
import type { Logger } from './logger.js';
import { createChildLogger } from './logger.js';
import { loadGoals, getPendingGoals, buildExecutionPlan, type Goal } from './goals.js';
import { orchestrateGoal } from './orchestrator.js';
import type { AgentId } from './agent-runner.js';
import { createAgentInvoker } from './cursor-agent.js';
import { StateWatcher } from './state-watcher.js';
import {
  inspectForCrashedSessions,
  appendSessionLog,
} from './session-log.js';
import { computeResumePointer } from './resume-pointer.js';
import { createStatusServer, readPlanningConfig } from './status-server.js';
import { sendSms } from './notifier.js';
import { writeGsdState } from './gsd-state.js';
import { addTodo } from './todos-api.js';
import { validateStateConsistency } from './state-consistency.js';
import { expirePendingGoals } from './intake/clarifier.js';

let shuttingDown = false;

async function updateState(
  config: AutopilotConfig,
  update: Parameters<typeof writeGsdState>[1],
): Promise<void> {
  if (!config.statePath) return;
  try {
    await writeGsdState(config.workspaceRoot, update, config.statePath);
  } catch {
    // best-effort
  }
}

/**
 * Orchestration: queue + hot-reload + webhook + parallel pool.
 *
 * - Goals are loaded at start and can be hot-reloaded when goals.md changes
 *   (chokidar); new pending goals are merged into the queue. Webhook (POST
 *   /api/goals, /api/todos, Twilio POST /webhook/twilio) can add goals/todos
 *   and push into the queue immediately.
 * - Prioritization: buildExecutionPlan() orders by [priority:N] then original
 *   order. parallelGroup/dependsOn are parsed but not used for scheduling.
 * - Pool: up to maxConcurrent workers when parallel is enabled; single workspace
 *   uses one mutex so only one goal runs at a time (phase-level parallel still
 *   applies inside execute-phase). Multi-workspace would allow true parallel goals.
 */
export async function runDaemon(
  config: AutopilotConfig,
  logger: Logger,
): Promise<void> {
  const consistency = await validateStateConsistency(config.workspaceRoot, logger, {
    sessionLogPath: path.isAbsolute(config.sessionLogPath)
      ? config.sessionLogPath
      : path.join(config.workspaceRoot, config.sessionLogPath),
  });
  logger.info(
    {
      consistent: consistency.consistent,
      suggestedAction: consistency.suggestedAction,
      warnings: consistency.warnings.length ? consistency.warnings : undefined,
    },
    'State consistency: %s',
    consistency.suggestedAction,
  );
  if (consistency.suggestedAction === 'reset' && !config.autoCheckpoint) {
    throw new Error(
      `State inconsistent. ${consistency.warnings.join(' ')} ` +
        'Fix STATE.md / session log / .gsd/state.json or set autoCheckpoint: true to proceed. Refusing to start.',
    );
  }

  await expirePendingGoals(config.workspaceRoot);

  const goals = await loadGoals(config.goalsPath, { logger });
  const pending = getPendingGoals(goals);

  if (pending.length === 0) {
    logger.info('No pending goals in queue');
    return;
  }

  const plan = buildExecutionPlan(pending);
  const queue: Goal[] = [...plan.ordered];
  const running = new Set<string>();
  let wakeResolver: (() => void) | null = null;
  const wake = (): void => {
    if (wakeResolver) {
      wakeResolver();
      wakeResolver = null;
    }
  };
  const waitForWake = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      wakeResolver = resolve;
      setTimeout(() => {
        if (wakeResolver === resolve) {
          wakeResolver = null;
          resolve();
        }
      }, ms);
    });

  const addToQueue = (goal: Goal): void => {
    if (running.has(goal.title)) return;
    if (queue.some((g) => g.title === goal.title)) return;
    queue.push(goal);
    wake();
  };

  const totalGoalsInitial = queue.length;
  logger.info({ count: totalGoalsInitial }, `Found ${totalGoalsInitial} pending goals`);

  await updateState(config, {
    daemonPid: process.pid,
    startedAt: new Date().toISOString(),
  });

  const heartbeatIntervalMs = 30_000;
  const heartbeatTimer =
    config.statePath &&
    setInterval(() => {
      updateState(config, { lastHeartbeat: new Date().toISOString() }).catch(() => {});
    }, heartbeatIntervalMs);

  let currentAgentSessionId: string | null = null;
  const agent = createAgentInvoker(config.agent as AgentId, config, {
    setAgentSessionId: (id) => {
      currentAgentSessionId = id;
    },
    onCrashedAfterRetries: (ctx) => {
      sendSms(
        `[gsd] Crashed: ${ctx.goalTitle} — phase ${ctx.phaseNumber ?? '?'}, plan ${ctx.planNumber ?? '?'}. Check logs.`,
      ).catch((err) => logger.warn({ err }, 'SMS notification failed'));
    },
  });

  const stateMdPath = path.join(config.workspaceRoot, '.planning', 'STATE.md');
  const heartbeatPath = path.join(config.workspaceRoot, '.planning', 'heartbeat.txt');
  const planningConfigPath = path.join(config.workspaceRoot, '.planning', 'config.json');
  const heartbeatTimeoutMs = 60_000;

  let effectiveParallel = config.parallel;
  try {
    const planning = await readPlanningConfig(planningConfigPath);
    if (planning.parallelization?.enabled !== undefined) {
      effectiveParallel = planning.parallelization.enabled;
    }
  } catch {
    // use config.parallel
  }

  const numWorkers = effectiveParallel ? config.maxConcurrent : 1;
  if (effectiveParallel) {
    logger.info(
      { maxConcurrent: config.maxConcurrent },
      `Parallel mode: up to ${config.maxConcurrent} workers (single workspace => one goal at a time via mutex)`,
    );
  } else {
    logger.info('Sequential mode: processing goals one at a time');
  }

  let currentGoal: string | null = null;
  let completedCount = 0;
  let statusServerClose: (() => Promise<void>) | null = null;
  let ngrokClose: (() => Promise<void>) | null = null;

  const webhookOptions = {
    goalsPath: config.goalsPath,
    workspaceRoot: config.workspaceRoot,
    onQueueGoal: addToQueue,
    getRunningTitles: () => Array.from(running),
    addTodo: (title: string, area?: string) =>
      addTodo(config.workspaceRoot, title, area ?? 'general'),
  };

  if (config.statusServerPort) {
    try {
      const result = await createStatusServer(
        config.statusServerPort,
        () => ({
          running: !shuttingDown,
          currentGoal: currentGoal ?? undefined,
          currentAgentId: currentAgentSessionId ?? undefined,
        }),
        {
          stateMdPath,
          sessionLogPath: config.sessionLogPath,
          workspaceRoot: config.workspaceRoot,
          planningConfigPath,
          webhook: webhookOptions,
          logger,
        },
      );
      if (result.server) {
        statusServerClose = result.close;
        logger.info({ port: config.statusServerPort }, 'Status server listening');
      } else {
        logger.warn(
          { port: config.statusServerPort },
          'Status server port in use — running without status server',
        );
      }
    } catch (err) {
      logger.warn(
        { err, port: config.statusServerPort },
        'Status server failed to start — running without status server',
      );
    }

    if (statusServerClose && config.ngrok) {
      const port = config.statusServerPort;
      const child = spawn('ngrok', ['http', String(port)], {
        stdio: 'inherit',
        shell: false,
      });
      child.on('error', (err) => {
        logger.warn({ err, port }, 'ngrok failed to start');
      });
      child.on('exit', (code, signal) => {
        if (!shuttingDown && (code !== 0 || signal)) {
          logger.info({ code, signal }, 'ngrok exited');
        }
      });
      ngrokClose = (): Promise<void> =>
        new Promise((resolve) => {
          if (!child.killed && child.pid) {
            child.once('exit', () => resolve());
            child.kill('SIGTERM');
          } else {
            resolve();
          }
        });
      logger.info({ port }, 'ngrok started (ngrok http %s)', port);
    }
  }

  let resumeFrom: Awaited<ReturnType<typeof computeResumePointer>> = null;
  if (queue.length > 0) {
    const crashed = await inspectForCrashedSessions(config.sessionLogPath);
    if (crashed?.status === 'running') {
      try {
        const st = await stat(heartbeatPath);
        const ageMs = Date.now() - st.mtime.getTime();
        if (ageMs > heartbeatTimeoutMs) {
          await appendSessionLog(config.sessionLogPath, {
            ...crashed,
            timestamp: new Date().toISOString(),
            status: 'crashed',
            error: `Heartbeat timeout (>${heartbeatTimeoutMs / 1000}s)`,
          });
          try {
            await sendSms(`GSD goal crashed (heartbeat timeout).\nGoal: ${crashed.goalTitle}`);
          } catch (e) {
            logger.debug({ err: e }, 'SMS (goal crashed) skipped or failed');
          }
        }
      } catch {
        await appendSessionLog(config.sessionLogPath, {
          ...crashed,
          timestamp: new Date().toISOString(),
          status: 'crashed',
          error: 'Heartbeat timeout (missing)',
        });
        try {
          await sendSms(`GSD goal crashed (heartbeat timeout).\nGoal: ${crashed.goalTitle}`);
        } catch (e) {
          logger.debug({ err: e }, 'SMS (goal crashed) skipped or failed');
        }
      }
    }
    resumeFrom = await computeResumePointer({
      sessionLogPath: config.sessionLogPath,
      stateMdPath,
      goalTitle: queue[0]?.title ?? '',
    });
    if (resumeFrom) {
      logger.info(
        { phaseNumber: resumeFrom.phaseNumber, planNumber: resumeFrom.planNumber },
        'Resuming from phase %s plan %s due to previous crash',
        resumeFrom.phaseNumber,
        resumeFrom.planNumber === 0 ? '1 (first)' : resumeFrom.planNumber,
      );
    }
  }

  const pauseFlagPath = path.join(config.workspaceRoot, '.pause-autopilot');

  const goalsUpdatedPath = path.join(config.workspaceRoot, '.gsd', 'goals-updated');
  const goalsReloadDebounceMs = config.goalsReloadDebounceMs ?? 500;
  let goalsReloadTimer: ReturnType<typeof setTimeout> | null = null;
  const goalsWatcher = chokidar.watch(goalsUpdatedPath, { ignoreInitial: true });
  goalsWatcher.on('change', () => {
    if (goalsReloadTimer) clearTimeout(goalsReloadTimer);
    const doReload = async () => {
      try {
        const fresh = await loadGoals(config.goalsPath, { logger });
        const newPending = getPendingGoals(fresh);
        const newPlan = buildExecutionPlan(newPending);
        for (const g of newPlan.ordered) addToQueue(g);
      } catch (err) {
        logger.warn({ err, path: config.goalsPath }, 'Hot-reload goals failed');
      }
    };
    if (goalsReloadDebounceMs > 0) {
      goalsReloadTimer = setTimeout(() => {
        goalsReloadTimer = null;
        void doReload();
      }, goalsReloadDebounceMs);
    } else {
      goalsReloadTimer = null;
      setImmediate(() => void doReload());
    }
  });

  const expireIntervalMs = 60 * 60 * 1000;
  const expireTimer = setInterval(
    () => expirePendingGoals(config.workspaceRoot).catch((err) => logger.warn({ err }, 'expirePendingGoals failed')),
    expireIntervalMs,
  );

  const workspaceMutex = (() => {
    let locked = false;
    const waiters: Array<() => void> = [];
    return {
      async run<T>(fn: () => Promise<T>): Promise<T> {
        while (locked) {
          await new Promise<void>((r) => waiters.push(r));
        }
        locked = true;
        try {
          return await fn();
        } finally {
          locked = false;
          const next = waiters.shift();
          if (next) next();
        }
      },
    };
  })();

  async function runOneGoal(
    goal: Goal,
    useResumeFrom: Awaited<ReturnType<typeof computeResumePointer>>,
  ): Promise<void> {
    let plannedUpToPhaseNum = 0;
    let currentResumeFrom = useResumeFrom;
    let watcher: StateWatcher | null = null;
    try {
      watcher = new StateWatcher({
        stateMdPath,
        debounceMs: config.stateWatchDebounceMs,
        logger: createChildLogger(logger, 'state-watcher'),
      });
      watcher.on('state_changed', (payload) => {
        logger.debug(
          {
            phase: payload.current.phaseNumber,
            plan: payload.current.planNumber,
            status: payload.current.status,
          },
          'state_changed',
        );
      });
      watcher.on('phase_advanced', (p) =>
        logger.info(
          { fromPhase: p.fromPhase, toPhase: p.toPhase, phaseName: p.phaseName },
          'phase_advanced',
        ),
      );
      watcher.on('plan_advanced', (p) =>
        logger.info(
          { phaseNumber: p.phaseNumber, fromPlan: p.fromPlan, toPlan: p.toPlan },
          'plan_advanced',
        ),
      );
      watcher.on('phase_completed', (p) =>
        logger.info({ phaseNumber: p.phaseNumber, phaseName: p.phaseName }, 'phase_completed'),
      );
      watcher.on('goal_completed', () => logger.info('goal_completed'));
      watcher.start();
    } catch (err) {
      logger.warn({ err, stateMdPath }, 'StateWatcher not started — proceeding without state watching');
    }
    try {
      let attempt = 0;
      while (attempt < 3) {
        attempt++;
        try {
          await orchestrateGoal({
            goal,
            config,
            logger,
            agent,
            isShuttingDown: () => shuttingDown,
            onProgress: (snapshot) => {
              if (snapshot.status.startsWith('Planned phase')) {
                plannedUpToPhaseNum = Math.max(plannedUpToPhaseNum, snapshot.phaseNumber);
              }
            },
            resumeFrom: currentResumeFrom,
            skipToPhase: attempt > 1 && plannedUpToPhaseNum > 0 ? plannedUpToPhaseNum + 1 : null,
          });
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(
            { err, goal: goal.title, attempt, maxAttempts: 3 },
            `Failed goal attempt ${attempt}/3: ${goal.title}`,
          );
          if (attempt >= 3) {
            try {
              await writeFile(
                pauseFlagPath,
                `Paused after 3 failed attempts for goal: ${goal.title}\nLast error: ${msg}\n`,
                'utf-8',
              );
            } catch {
              // ignore
            }
            try {
              await sendSms(`GSD daemon paused after 3 retries.\nGoal: ${goal.title}\nError: ${msg}`);
            } catch (smsErr) {
              logger.warn({ err: smsErr }, 'SMS notification failed');
            }
            while (existsSync(pauseFlagPath) && !shuttingDown) {
              logger.info('Pause flag (.pause-autopilot) detected – sleeping 60s');
              await new Promise((r) => setTimeout(r, 60_000));
            }
          }
        } finally {
          currentResumeFrom = null;
        }
      }
    } finally {
      if (watcher) watcher.stop();
    }
  }

  const runWorker = async (): Promise<void> => {
    while (!shuttingDown) {
      while (existsSync(pauseFlagPath)) {
        logger.info('Pause flag (.pause-autopilot) detected – sleeping 60s');
        await new Promise((r) => setTimeout(r, 60_000));
      }
      const goal = queue.shift() ?? null;
      if (!goal) {
        if (running.size === 0) break;
        await waitForWake(5000);
        continue;
      }
      running.add(goal.title);
      currentGoal = goal.title;
      completedCount++;
      const totalCount = completedCount + queue.length;
      await updateState(config, { currentGoal: goal.title, progress: `${completedCount}/${totalCount}` });

      if (shuttingDown) {
        queue.unshift(goal);
        running.delete(goal.title);
        break;
      }
      logger.info({ goal: goal.title }, `Processing goal: ${goal.title}`);
      const phaseNum =
        completedCount === 1 && resumeFrom !== null ? (resumeFrom.phaseNumber ?? 1) : 1;
      sendSms(`[gsd] Started: ${goal.title} — phase ${phaseNum}`).catch((err) =>
        logger.warn({ err }, 'SMS notification failed'),
      );
      const isFirst = completedCount === 1 && resumeFrom !== null;
      await workspaceMutex.run(() => runOneGoal(goal, isFirst ? resumeFrom : null));
      running.delete(goal.title);
      currentGoal = null;
      currentAgentSessionId = null;
      const progressStr = `${completedCount}/${completedCount + queue.length}`;
      await updateState(config, {
        lastGoalCompleted: goal.title,
        progress: progressStr,
        currentGoal: undefined,
      });
      logger.info({ goal: goal.title, progress: progressStr }, `Completed goal: ${goal.title}`);
      wake();
    }
  };

  await Promise.all(Array.from({ length: numWorkers }, () => runWorker()));
  goalsWatcher.close();
  clearInterval(expireTimer);

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  if (!shuttingDown) {
    logger.info('All goals processed');
  }
  if (ngrokClose) {
    await ngrokClose();
  }
  if (statusServerClose) {
    await statusServerClose();
  }
}

export function registerShutdownHandlers(logger: Logger): void {
  let signalCount = 0;

  const handler = (signal: string) => {
    signalCount++;
    if (signalCount === 1) {
      logger.info({ signal }, 'Shutting down gracefully...');
      shuttingDown = true;
    } else {
      logger.warn({ signal }, 'Forced shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}
