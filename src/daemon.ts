import type { AutopilotConfig } from './config.js';
import type { Logger } from './logger.js';
import { loadGoals, getPendingGoals } from './goals.js';
import { orchestrateGoal } from './orchestrator.js';

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
    try {
      await orchestrateGoal({
        goal,
        config,
        logger,
        isShuttingDown: () => shuttingDown,
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
