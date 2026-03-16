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
  [GoalLifecyclePhase.PlanningPhase]: [GoalLifecyclePhase.ExecutingPlan],
  [GoalLifecyclePhase.ExecutingPlan]: [GoalLifecyclePhase.ExecutingPlan, GoalLifecyclePhase.PhaseComplete],
  [GoalLifecyclePhase.PhaseComplete]: [GoalLifecyclePhase.PlanningPhase, GoalLifecyclePhase.Complete],
  [GoalLifecyclePhase.Complete]: [],
  [GoalLifecyclePhase.Failed]: [],
};
