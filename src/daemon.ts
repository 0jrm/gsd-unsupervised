import type { AutopilotConfig } from './config.js';
import type { Logger } from './logger.js';
import type { Goal } from './goals.js';
import { loadGoals, getPendingGoals } from './goals.js';

let shuttingDown = false;

async function processGoal(
  goal: Goal,
  _config: AutopilotConfig,
  logger: Logger,
): Promise<void> {
  logger.info({ goal: goal.title }, 'TODO: orchestrate goal via cursor-agent');
}

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

  for (const goal of pending) {
    if (shuttingDown) {
      logger.warn('Shutdown requested — stopping after current goal');
      break;
    }

    logger.info({ goal: goal.title }, `Processing goal: ${goal.title}`);
    await processGoal(goal, config, logger);
    logger.info({ goal: goal.title }, `Completed goal: ${goal.title}`);
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
