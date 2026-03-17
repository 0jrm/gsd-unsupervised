import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import type { AutopilotConfig } from './config.js';
import type { Logger } from './logger.js';
import { createChildLogger } from './logger.js';
import { loadGoals, getPendingGoals, buildExecutionPlan } from './goals.js';
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

let shuttingDown = false;

export async function runDaemon(
  config: AutopilotConfig,
  logger: Logger,
): Promise<void> {
  const goals = await loadGoals(config.goalsPath);
  const pending = getPendingGoals(goals);

  if (pending.length === 0) {
    logger.info('No pending goals in queue');
    return;
  }

  logger.info({ count: pending.length }, `Found ${pending.length} pending goals`);

  const agent = createAgentInvoker(config.agent as AgentId, config);

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

  if (effectiveParallel) {
    logger.info(
      { maxConcurrent: config.maxConcurrent },
      `Parallel mode: processing up to ${config.maxConcurrent} goals concurrently`,
    );
  } else {
    logger.info('Sequential mode: processing goals one at a time');
  }

  let currentGoal: string | null = null;
  let statusServerClose: (() => Promise<void>) | null = null;
  let ngrokClose: (() => Promise<void>) | null = null;

  if (config.statusServerPort) {
    const { close } = createStatusServer(
      config.statusServerPort,
      () => ({
        running: !shuttingDown,
        currentGoal: currentGoal ?? undefined,
      }),
      {
        stateMdPath,
        sessionLogPath: config.sessionLogPath,
        workspaceRoot: config.workspaceRoot,
        planningConfigPath,
      },
    );
    statusServerClose = close;
    logger.info({ port: config.statusServerPort }, 'Status server listening');

    if (config.ngrok) {
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

  const plan = buildExecutionPlan(pending);

  let resumeFrom: Awaited<ReturnType<typeof computeResumePointer>> = null;
  if (pending.length > 0) {
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
        }
      } catch {
        await appendSessionLog(config.sessionLogPath, {
          ...crashed,
          timestamp: new Date().toISOString(),
          status: 'crashed',
          error: 'Heartbeat timeout (missing)',
        });
      }
    }
    resumeFrom = await computeResumePointer({
      sessionLogPath: config.sessionLogPath,
      stateMdPath,
      goalTitle: pending[0].title ?? '',
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

  for (let i = 0; i < plan.ordered.length; i++) {
    const goal = plan.ordered[i];
    currentGoal = goal.title;
    let plannedUpToPhaseNum = 0;

    // Pause/dormant mode: sleep while .pause-autopilot exists
    while (existsSync(pauseFlagPath)) {
      logger.info('Pause flag (.pause-autopilot) detected – sleeping 60s');
      await new Promise((r) => setTimeout(r, 60_000));
    }

    if (shuttingDown) {
      logger.warn('Shutdown requested — stopping after current goal');
      break;
    }

    logger.info({ goal: goal.title }, `Processing goal: ${goal.title}`);

    let watcher: StateWatcher | null = null;
    try {
      watcher = new StateWatcher({
        stateMdPath,
        debounceMs: config.stateWatchDebounceMs,
        logger: createChildLogger(logger, 'state-watcher'),
      });
      watcher.on('state_changed', (payload) => {
        const event = {
          type: 'state_changed' as const,
          previous: payload.previous,
          current: payload.current,
        };
        logger.debug(
          {
            phase: payload.current.phaseNumber,
            plan: payload.current.planNumber,
            status: payload.current.status,
          },
          'state_changed',
        );
        logger.info({ event }, 'progress event');
      });
      watcher.on('phase_advanced', (payload) => {
        const event = {
          type: 'phase_advanced' as const,
          fromPhase: payload.fromPhase,
          toPhase: payload.toPhase,
          phaseName: payload.phaseName,
        };
        logger.info(
          { fromPhase: payload.fromPhase, toPhase: payload.toPhase, phaseName: payload.phaseName },
          'phase_advanced',
        );
        logger.info({ event }, 'progress event');
      });
      watcher.on('plan_advanced', (payload) => {
        const event = {
          type: 'plan_advanced' as const,
          phaseNumber: payload.phaseNumber,
          fromPlan: payload.fromPlan,
          toPlan: payload.toPlan,
        };
        logger.info(
          {
            phaseNumber: payload.phaseNumber,
            fromPlan: payload.fromPlan,
            toPlan: payload.toPlan,
          },
          'plan_advanced',
        );
        logger.info({ event }, 'progress event');
      });
      watcher.on('phase_completed', (payload) => {
        const event = {
          type: 'phase_completed' as const,
          phaseNumber: payload.phaseNumber,
          phaseName: payload.phaseName,
        };
        logger.info(
          { phaseNumber: payload.phaseNumber, phaseName: payload.phaseName },
          'phase_completed',
        );
        logger.info({ event }, 'progress event');
      });
      watcher.on('goal_completed', () => {
        const event = { type: 'goal_completed' as const };
        logger.info('goal_completed');
        logger.info({ event }, 'progress event');
      });
      watcher.start();
    } catch (err) {
      logger.warn({ err, stateMdPath }, 'StateWatcher not started — proceeding without state watching');
    }

    try {
      let attempt = 0;
      // Hard stop + pause after 3 failed attempts on the same goal.
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
              logger.debug(
                {
                  phase: snapshot.phaseNumber,
                  plan: snapshot.planNumber,
                  status: snapshot.status,
                },
                'onProgress snapshot',
              );
              if (snapshot.status.startsWith('Planned phase')) {
                plannedUpToPhaseNum = Math.max(plannedUpToPhaseNum, snapshot.phaseNumber);
              }
            },
            resumeFrom: i === 0 ? resumeFrom : null,
            skipToPhase: attempt > 1 && plannedUpToPhaseNum > 0 ? plannedUpToPhaseNum + 1 : null,
          });
          logger.info(
            { goal: goal.title, progress: `${i + 1}/${pending.length}` },
            `Completed goal ${i + 1}/${pending.length}: ${goal.title}`,
          );
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(
            { err, goal: goal.title, attempt, maxAttempts: 3, progress: `${i + 1}/${pending.length}` },
            `Failed goal attempt ${attempt}/3: ${goal.title}`,
          );
          if (plannedUpToPhaseNum > 0) {
            logger.info(
              { goal: goal.title, plannedUpToPhaseNum },
              'Retry will skip re-planning phases already planned in previous attempt',
            );
          }
          if (attempt >= 3) {
            logger.error(
              { goal: goal.title },
              'Pausing daemon after 3 failed attempts (creating .pause-autopilot)',
            );
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
            // Enter pause loop (same behavior as external pause flag), but we created it.
            while (existsSync(pauseFlagPath) && !shuttingDown) {
              logger.info('Pause flag (.pause-autopilot) detected – sleeping 60s');
              await new Promise((r) => setTimeout(r, 60_000));
            }
          }
        } finally {
          // Only use resumeFrom on the very first orchestration attempt.
          resumeFrom = null;
        }
      }
    } finally {
      if (watcher) {
        watcher.stop();
      }
    }
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
