import { EventEmitter } from 'node:events';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Logger } from './logger.js';
import { readStateFile } from './state-index.js';
import type { StateSnapshot } from './state-types.js';

/** Progress event payloads emitted by StateWatcher */
export type ProgressEvent =
  | { type: 'state_changed'; previous: StateSnapshot | null; current: StateSnapshot }
  | { type: 'phase_advanced'; fromPhase: number; toPhase: number; phaseName: string }
  | { type: 'plan_advanced'; phaseNumber: number; fromPlan: number; toPlan: number }
  | { type: 'phase_completed'; phaseNumber: number; phaseName: string }
  | { type: 'goal_completed'; progressPercent: number };

export interface StateWatcherOptions {
  stateMdPath: string;
  debounceMs?: number;
  logger: Logger;
}

/**
 * Watches STATE.md for changes, parses content, and emits typed progress events.
 * Used by the daemon and dashboard for real-time progress visibility.
 */
export class StateWatcher extends EventEmitter {
  private readonly stateMdPath: string;
  private readonly debounceMs: number;
  private readonly logger: Logger;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshot: StateSnapshot | null = null;
  private goalCompleteEmitted = false;

  constructor(options: StateWatcherOptions) {
    super();
    const { stateMdPath, debounceMs = 500, logger } = options;
    this.stateMdPath = stateMdPath;
    this.debounceMs = debounceMs;
    this.logger = logger;
  }

  start(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = chokidar.watch(this.stateMdPath, {
      persistent: true,
      ignoreInitial: false,
    });

    const onFileEvent = () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.handleChange();
      }, this.debounceMs);
    };

    this.watcher.on('add', onFileEvent);
    this.watcher.on('change', onFileEvent);
    this.watcher.on('error', (err: unknown) => {
      this.logger.warn({ err }, 'StateWatcher file error');
    });
  }

  private async handleChange(): Promise<void> {
    let snapshot: StateSnapshot | null = null;
    try {
      snapshot = await readStateFile(this.stateMdPath, this.logger);
    } catch (err) {
      this.logger.warn({ err }, 'StateWatcher read failed, keeping last snapshot');
      return;
    }

    if (snapshot === null) {
      this.logger.debug('STATE.md missing or unparseable');
      return;
    }

    const previous = this.lastSnapshot;

    if (previous !== null) {
      const isNoop =
        previous.phaseNumber === snapshot.phaseNumber &&
        previous.totalPhases === snapshot.totalPhases &&
        previous.phaseName === snapshot.phaseName &&
        previous.planNumber === snapshot.planNumber &&
        previous.totalPlans === snapshot.totalPlans &&
        previous.status === snapshot.status &&
        (previous.progressPercent ?? null) === (snapshot.progressPercent ?? null) &&
        (previous.gitSha ?? null) === (snapshot.gitSha ?? null);

      if (isNoop) {
        this.logger.debug(
          {
            phase: snapshot.phaseNumber,
            plan: snapshot.planNumber,
            status: snapshot.status,
          },
          'state_noop',
        );
        return;
      }
    }

    if (previous === null) {
      this.emit('ready', snapshot);
      this.logger.info({ path: this.stateMdPath }, 'STATE.md first detected');
    }

    this.emit('state_changed', { previous, current: snapshot });
    this.logger.info(
      {
        phase: snapshot.phaseNumber,
        plan: snapshot.planNumber,
        status: snapshot.status,
        progressPercent: snapshot.progressPercent,
      },
      'state_changed',
    );

    if (previous !== null) {
      if (snapshot.phaseNumber > previous.phaseNumber) {
        const phaseName = snapshot.phaseName;
        this.emit('phase_advanced', {
          fromPhase: previous.phaseNumber,
          toPhase: snapshot.phaseNumber,
          phaseName,
        });
        this.logger.info(
          { fromPhase: previous.phaseNumber, toPhase: snapshot.phaseNumber, phaseName },
          'phase_advanced',
        );
      }
      if (
        snapshot.phaseNumber === previous.phaseNumber &&
        snapshot.planNumber > previous.planNumber
      ) {
        this.emit('plan_advanced', {
          phaseNumber: snapshot.phaseNumber,
          fromPlan: previous.planNumber,
          toPlan: snapshot.planNumber,
        });
        this.logger.info(
          {
            phaseNumber: snapshot.phaseNumber,
            fromPlan: previous.planNumber,
            toPlan: snapshot.planNumber,
          },
          'plan_advanced',
        );
      }
      const statusComplete = /complete/i.test(snapshot.status);
      const prevComplete = /complete/i.test(previous.status);
      if (
        statusComplete &&
        (previous.phaseNumber !== snapshot.phaseNumber || !prevComplete)
      ) {
        this.emit('phase_completed', {
          phaseNumber: snapshot.phaseNumber,
          phaseName: snapshot.phaseName,
        });
        this.logger.info(
          { phaseNumber: snapshot.phaseNumber, phaseName: snapshot.phaseName },
          'phase_completed',
        );
      }
    }

    if (
      snapshot.phaseNumber === snapshot.totalPhases &&
      /complete/i.test(snapshot.status)
    ) {
      if (!this.goalCompleteEmitted) {
        this.goalCompleteEmitted = true;
        const progressPercent = snapshot.progressPercent ?? 100;
        this.emit('goal_completed', { progressPercent });
        this.logger.info({ progressPercent }, 'goal_completed');
      }
    }

    this.lastSnapshot = snapshot;
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.removeAllListeners();
  }

  getLastSnapshot(): StateSnapshot | null {
    return this.lastSnapshot;
  }
}
