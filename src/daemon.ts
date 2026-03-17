import path from 'node:path';
import type { AutopilotConfig } from './config.js';
import type { Logger } from './logger.js';
import { createChildLogger } from './logger.js';
import { loadGoals, getPendingGoals } from './goals.js';
import { orchestrateGoal } from './orchestrator.js';
import { createCursorAgentInvoker } from './cursor-agent.js';
import { StateWatcher } from './state-watcher.js';

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
  });

  if (config.parallel) {
    logger.info(
      { maxConcurrent: config.maxConcurrent },
      `Parallel mode: processing up to ${config.maxConcurrent} goals concurrently`,
    );
  } else {
    logger.info('Sequential mode: processing goals one at a time');
  }

  for (let i = 0; i < pending.length; i++) {
    const goal = pending[i];

    if (shuttingDown) {
      logger.warn('Shutdown requested — stopping after current goal');
      break;
    }

    logger.info({ goal: goal.title }, `Processing goal: ${goal.title}`);

    const stateMdPath = path.join(config.workspaceRoot, '.planning', 'STATE.md');
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
