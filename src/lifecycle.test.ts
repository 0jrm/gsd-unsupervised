import { describe, it, expect } from 'vitest';
import {
  GoalLifecyclePhase,
  GoalStateMachine,
} from './lifecycle.js';

describe('GoalStateMachine transitions', () => {
  it('starts in the new phase with zeroed counters', () => {
    const sm = new GoalStateMachine('Test goal');
    const progress = sm.getProgress();

    expect(progress.phase).toBe(GoalLifecyclePhase.New);
    expect(progress.currentPhaseNumber).toBe(0);
    expect(progress.totalPhases).toBe(0);
    expect(progress.currentPlanIndex).toBe(0);
    expect(progress.totalPlansInPhase).toBe(0);
    expect(sm.isTerminal()).toBe(false);
  });

  it('allows valid forward transitions based on LIFECYCLE_TRANSITIONS', () => {
    const sm = new GoalStateMachine('Test goal');

    // new -> initializing_project
    sm.advance(GoalLifecyclePhase.InitializingProject);
    expect(sm.getPhase()).toBe(GoalLifecyclePhase.InitializingProject);

    // initializing_project -> creating_roadmap
    sm.advance(GoalLifecyclePhase.CreatingRoadmap);
    expect(sm.getPhase()).toBe(GoalLifecyclePhase.CreatingRoadmap);

    // creating_roadmap -> planning_phase
    sm.advance(GoalLifecyclePhase.PlanningPhase);
    expect(sm.getPhase()).toBe(GoalLifecyclePhase.PlanningPhase);

    // planning_phase -> executing_plan
    sm.advance(GoalLifecyclePhase.ExecutingPlan);
    expect(sm.getPhase()).toBe(GoalLifecyclePhase.ExecutingPlan);

    // executing_plan can transition to itself (multiple plans in a phase)
    sm.advance(GoalLifecyclePhase.ExecutingPlan);
    expect(sm.getPhase()).toBe(GoalLifecyclePhase.ExecutingPlan);

    // executing_plan -> phase_complete
    sm.advance(GoalLifecyclePhase.PhaseComplete);
    expect(sm.getPhase()).toBe(GoalLifecyclePhase.PhaseComplete);

    // phase_complete -> complete
    sm.advance(GoalLifecyclePhase.Complete);
    expect(sm.getPhase()).toBe(GoalLifecyclePhase.Complete);
    expect(sm.isTerminal()).toBe(true);
    expect(sm.isComplete()).toBe(true);
  });

  it('throws helpful error for invalid transitions with current, target, and allowed set', () => {
    const sm = new GoalStateMachine('Test goal');

    expect(() =>
      sm.advance(GoalLifecyclePhase.PlanningPhase),
    ).toThrowError(
      /Invalid transition: new → planning_phase\. Allowed transitions from 'new': \[initializing_project]/,
    );
  });

  it('moves to failed phase and records error when fail() is called', () => {
    const sm = new GoalStateMachine('Test goal');

    sm.fail('something went wrong');

    const progress = sm.getProgress();
    expect(progress.phase).toBe(GoalLifecyclePhase.Failed);
    expect(progress.error).toBe('something went wrong');
    expect(sm.isFailed()).toBe(true);
    expect(sm.isTerminal()).toBe(true);
  });
});

