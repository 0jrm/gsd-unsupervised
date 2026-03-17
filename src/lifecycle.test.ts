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

describe('GoalStateMachine getNextCommand', () => {
  it('returns /gsd/new-project for the initial new phase', () => {
    const sm = new GoalStateMachine('Test goal');

    const cmd = sm.getNextCommand();

    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe('/gsd/new-project');
    expect(cmd!.args).toBeUndefined();
    expect(cmd!.description).toMatch(/Initialize project/i);
  });

  it('returns /gsd/create-roadmap after initializing_project', () => {
    const sm = new GoalStateMachine('Test goal');

    sm.advance(GoalLifecyclePhase.InitializingProject);
    const cmd = sm.getNextCommand();

    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe('/gsd/create-roadmap');
    expect(cmd!.args).toBeUndefined();
    expect(cmd!.description).toMatch(/Create roadmap/i);
  });

  it('returns /gsd/plan-phase N in creating_roadmap using currentPhaseNumber', () => {
    const sm = new GoalStateMachine('Test goal');

    sm.advance(GoalLifecyclePhase.InitializingProject);
    sm.advance(GoalLifecyclePhase.CreatingRoadmap);
    sm.setPhaseInfo(1, 3);

    const cmd = sm.getNextCommand();

    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe('/gsd/plan-phase');
    expect(cmd!.args).toBe('1');
    expect(cmd!.description).toContain('phase 1');
  });

  it('returns null while in planning_phase or executing_plan', () => {
    const sm = new GoalStateMachine('Test goal');

    sm.advance(GoalLifecyclePhase.InitializingProject);
    sm.advance(GoalLifecyclePhase.CreatingRoadmap);
    sm.advance(GoalLifecyclePhase.PlanningPhase);

    expect(sm.getNextCommand()).toBeNull();

    sm.advance(GoalLifecyclePhase.ExecutingPlan);
    expect(sm.getNextCommand()).toBeNull();
  });

  it('returns /gsd/plan-phase for the next phase when phase_complete and more phases remain', () => {
    const sm = new GoalStateMachine('Test goal');

    sm.advance(GoalLifecyclePhase.InitializingProject);
    sm.advance(GoalLifecyclePhase.CreatingRoadmap);
    sm.setPhaseInfo(1, 3);
    sm.advance(GoalLifecyclePhase.PlanningPhase);
    sm.advance(GoalLifecyclePhase.ExecutingPlan);
    sm.advance(GoalLifecyclePhase.PhaseComplete);

    const cmd = sm.getNextCommand();

    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe('/gsd/plan-phase');
    expect(cmd!.args).toBe('2');
    expect(cmd!.description).toContain('phase 2');
  });

  it('returns null when phase_complete and already on the final phase', () => {
    const sm = new GoalStateMachine('Test goal');

    sm.advance(GoalLifecyclePhase.InitializingProject);
    sm.advance(GoalLifecyclePhase.CreatingRoadmap);
    sm.setPhaseInfo(3, 3);
    sm.advance(GoalLifecyclePhase.PlanningPhase);
    sm.advance(GoalLifecyclePhase.ExecutingPlan);
    sm.advance(GoalLifecyclePhase.PhaseComplete);

    expect(sm.getNextCommand()).toBeNull();
  });
});


