export enum GoalLifecyclePhase {
  New = 'new',
  InitializingProject = 'initializing_project',
  CreatingRoadmap = 'creating_roadmap',
  PlanningPhase = 'planning_phase',
  ExecutingPlan = 'executing_plan',
  PhaseComplete = 'phase_complete',
  Complete = 'complete',
  Failed = 'failed',
}

export interface GsdCommand {
  command: string;
  args?: string;
  description: string;
}

export interface GoalProgress {
  goalTitle: string;
  phase: GoalLifecyclePhase;
  currentPhaseNumber: number;
  totalPhases: number;
  currentPlanIndex: number;
  totalPlansInPhase: number;
  lastCommand?: GsdCommand;
  error?: string;
}

export const LIFECYCLE_TRANSITIONS: Record<GoalLifecyclePhase, GoalLifecyclePhase[]> = {
  [GoalLifecyclePhase.New]: [GoalLifecyclePhase.InitializingProject],
  [GoalLifecyclePhase.InitializingProject]: [GoalLifecyclePhase.CreatingRoadmap],
  [GoalLifecyclePhase.CreatingRoadmap]: [GoalLifecyclePhase.PlanningPhase],
  [GoalLifecyclePhase.PlanningPhase]: [GoalLifecyclePhase.ExecutingPlan, GoalLifecyclePhase.PhaseComplete],
  [GoalLifecyclePhase.ExecutingPlan]: [GoalLifecyclePhase.ExecutingPlan, GoalLifecyclePhase.PhaseComplete],
  [GoalLifecyclePhase.PhaseComplete]: [GoalLifecyclePhase.PlanningPhase, GoalLifecyclePhase.Complete],
  [GoalLifecyclePhase.Complete]: [],
  [GoalLifecyclePhase.Failed]: [],
};

export class GoalStateMachine {
  private progress: GoalProgress;

  constructor(goalTitle: string) {
    this.progress = {
      goalTitle,
      phase: GoalLifecyclePhase.New,
      currentPhaseNumber: 0,
      totalPhases: 0,
      currentPlanIndex: 0,
      totalPlansInPhase: 0,
    };
  }

  getProgress(): GoalProgress {
    return { ...this.progress };
  }

  getPhase(): GoalLifecyclePhase {
    return this.progress.phase;
  }

  isComplete(): boolean {
    return this.progress.phase === GoalLifecyclePhase.Complete;
  }

  isFailed(): boolean {
    return this.progress.phase === GoalLifecyclePhase.Failed;
  }

  isTerminal(): boolean {
    return this.isComplete() || this.isFailed();
  }

  advance(to: GoalLifecyclePhase): void {
    const allowed = LIFECYCLE_TRANSITIONS[this.progress.phase];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid transition: ${this.progress.phase} → ${to}. ` +
        `Allowed transitions from '${this.progress.phase}': [${allowed.join(', ')}]`,
      );
    }
    this.progress.phase = to;
  }

  setPhaseInfo(currentPhase: number, totalPhases: number): void {
    this.progress.currentPhaseNumber = currentPhase;
    this.progress.totalPhases = totalPhases;
  }

  setPlanInfo(currentPlan: number, totalPlans: number): void {
    this.progress.currentPlanIndex = currentPlan;
    this.progress.totalPlansInPhase = totalPlans;
  }

  getNextCommand(): GsdCommand | null {
    switch (this.progress.phase) {
      case GoalLifecyclePhase.New:
        return { command: '/gsd/new-project', description: 'Initialize project' };

      case GoalLifecyclePhase.InitializingProject:
        return { command: '/gsd/create-roadmap', description: 'Create roadmap' };

      case GoalLifecyclePhase.CreatingRoadmap:
        return {
          command: '/gsd/plan-phase',
          args: String(this.progress.currentPhaseNumber),
          description: `Plan phase ${this.progress.currentPhaseNumber}`,
        };

      case GoalLifecyclePhase.PlanningPhase:
        return null;

      case GoalLifecyclePhase.ExecutingPlan:
        return null;

      case GoalLifecyclePhase.PhaseComplete:
        if (this.progress.currentPhaseNumber < this.progress.totalPhases) {
          const next = this.progress.currentPhaseNumber + 1;
          return {
            command: '/gsd/plan-phase',
            args: String(next),
            description: `Plan phase ${next}`,
          };
        }
        return null;

      case GoalLifecyclePhase.Complete:
      case GoalLifecyclePhase.Failed:
        return null;
    }
  }

  fail(error: string): void {
    this.progress.phase = GoalLifecyclePhase.Failed;
    this.progress.error = error;
  }

  setLastCommand(cmd: GsdCommand): void {
    this.progress.lastCommand = { ...cmd };
  }
}
