import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { AutopilotConfig } from './config.js';
import type { Logger } from './logger.js';
import { createChildLogger } from './logger.js';
import { loadGoals, getPendingGoals } from './goals.js';
import { orchestrateGoal } from './orchestrator.js';
import { createCursorAgentInvoker } from './cursor-agent.js';
import { StateWatcher } from './state-watcher.js';
import {
  computeResumePoint,
  inspectForCrashedSessions,
  appendSessionLog,
} from './session-log.js';
import { createStatusServer } from './status-server.js';

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

  const agent = createCursorAgentInvoker({
    agentPath: config.cursorAgentPath,
    defaultTimeoutMs: config.agentTimeoutMs,
    sessionLogPath: config.sessionLogPath,
    heartbeatPath: path.join(config.workspaceRoot, '.planning', 'heartbeat.txt'),
    heartbeatIntervalMs: 15_000,
  });

  if (config.parallel) {
    logger.info(
      { maxConcurrent: config.maxConcurrent },
      `Parallel mode: processing up to ${config.maxConcurrent} goals concurrently`,
    );
  } else {
    logger.info('Sequential mode: processing goals one at a time');
  }

  const stateMdPath = path.join(config.workspaceRoot, '.planning', 'STATE.md');
  const heartbeatPath = path.join(config.workspaceRoot, '.planning', 'heartbeat.txt');
  const heartbeatTimeoutMs = 60_000;

  let currentGoal: string | null = null;
  let statusServerClose: (() => Promise<void>) | null = null;
  if (config.statusServerPort) {
    const { close } = createStatusServer(config.statusServerPort, () => ({
      running: !shuttingDown,
      currentGoal: currentGoal ?? undefined,
    }));
    statusServerClose = close;
    logger.info({ port: config.statusServerPort }, 'Status server listening');
  }

  let resumeFrom: Awaited<ReturnType<typeof computeResumePoint>> = null;
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
    resumeFrom = await computeResumePoint(
      config.sessionLogPath,
      stateMdPath,
      pending[0].title ?? '',
    );
    if (resumeFrom) {
      logger.info(
        { phaseNumber: resumeFrom.phaseNumber, planNumber: resumeFrom.planNumber },
        'Resume point detected — will resume first goal from phase/plan',
      );
    }
  }

  for (let i = 0; i < pending.length; i++) {
    const goal = pending[i];
    currentGoal = goal.title;

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
        logger.debug(
          {
            phase: payload.current.phaseNumber,
            plan: payload.current.planNumber,
            status: payload.current.status,
          },
          'state_changed',
        );
      });
      watcher.on('phase_advanced', (payload) => {
        logger.info(
          { fromPhase: payload.fromPhase, toPhase: payload.toPhase, phaseName: payload.phaseName },
          'phase_advanced',
        );
      });
      watcher.on('plan_advanced', (payload) => {
        logger.info(
          {
            phaseNumber: payload.phaseNumber,
            fromPlan: payload.fromPlan,
            toPlan: payload.toPlan,
          },
          'plan_advanced',
        );
      });
      watcher.on('phase_completed', (payload) => {
        logger.info(
          { phaseNumber: payload.phaseNumber, phaseName: payload.phaseName },
          'phase_completed',
        );
      });
      watcher.on('goal_completed', () => {
        logger.info('goal_completed');
      });
      watcher.start();
    } catch (err) {
      logger.warn({ err, stateMdPath }, 'StateWatcher not started — proceeding without state watching');
    }

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
        },
        resumeFrom: i === 0 ? resumeFrom : null,
      });
      logger.info(
        { goal: goal.title, progress: `${i + 1}/${pending.length}` },
        `Completed goal ${i + 1}/${pending.length}: ${goal.title}`,
      );
    } catch (err) {
      logger.error(
        { err, goal: goal.title, progress: `${i + 1}/${pending.length}` },
        `Failed goal ${i + 1}/${pending.length}: ${goal.title} — continuing to next goal`,
      );
    } finally {
      if (watcher) {
        watcher.stop();
      }
    }
  }

  if (!shuttingDown) {
    logger.info('All goals processed');
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
