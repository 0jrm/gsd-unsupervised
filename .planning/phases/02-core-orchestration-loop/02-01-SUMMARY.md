---
phase: 02-core-orchestration-loop
plan: 01
subsystem: orchestration
tags: [state-machine, lifecycle, goal-progress]

requires:
  - phase: 01-03
    provides: Daemon loop skeleton, logger, CLI wiring
provides:
  - GoalLifecyclePhase enum with 8 states
  - LIFECYCLE_TRANSITIONS map defining valid state transitions
  - GoalStateMachine class for tracking goal progress and determining next GSD command
  - GsdCommand and GoalProgress interfaces
affects: [02-02-orchestrator-loop, 02-03-cursor-agent-bridge]

tech-stack:
  added: []
  patterns: [string enum for phase readability in logs, defensive copy on getProgress, transition validation with descriptive errors]

key-files:
  created: [src/lifecycle.ts]
  modified: []

key-decisions:
  - "String enum values match GSD lifecycle stages (new, initializing_project, etc.) for log readability"
  - "fail() bypasses transition validation — any state can fail directly to avoid error-in-error-handler scenarios"
  - "getNextCommand() returns null for planning_phase and executing_plan — the orchestrator must discover plan paths externally"
  - "PhaseComplete checks currentPhaseNumber < totalPhases to determine whether to advance or finish"

patterns-established:
  - "Transition validation: advance() checks LIFECYCLE_TRANSITIONS map and throws with current/target/allowed phases"
  - "Defensive copies: getProgress() and setLastCommand() spread objects to prevent external mutation"

issues-created: []

duration: 2min
completed: 2026-03-16
---

# Phase 2 Plan 01: Lifecycle State Machine Summary

**Goal lifecycle state machine with 8 phases, validated transitions, progress tracking, and GSD command routing for the orchestrator loop.**

## Performance
- **Duration:** ~2min
- **Tasks:** 2
- **Files created:** 1

## Accomplishments
- Defined GoalLifecyclePhase string enum covering the full goal lifecycle: new → initializing_project → creating_roadmap → planning_phase → executing_plan → phase_complete → complete, plus failed
- Created LIFECYCLE_TRANSITIONS map encoding which phases can follow which, including self-transitions (executing_plan → executing_plan for multi-plan phases)
- Implemented GoalStateMachine class with transition validation, phase/plan counters, next-command routing, and fail-fast error handling
- getNextCommand() maps each lifecycle phase to the appropriate /gsd/ command with args, or returns null when the orchestrator needs external discovery

## Task Commits
1. **Task 1: Lifecycle types, interfaces, and transition map** - `7fde33a` (feat)
2. **Task 2: GoalStateMachine implementation** - `76df40e` (feat)

## Files Created/Modified
- `src/lifecycle.ts` - GoalLifecyclePhase enum, GsdCommand/GoalProgress interfaces, LIFECYCLE_TRANSITIONS, GoalStateMachine class

## Decisions Made
- fail() sets phase directly without checking LIFECYCLE_TRANSITIONS — any state should be able to transition to failed
- getNextCommand() returns null for executing_plan and planning_phase because the orchestrator needs to discover plan file paths from the filesystem before it can issue execute-plan commands
- PhaseComplete uses currentPhaseNumber < totalPhases comparison to decide between advancing to next phase or completing the goal

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None.

## Next Phase Readiness
Lifecycle state machine ready for consumption by the orchestrator loop (02-02). GoalStateMachine provides getNextCommand() for command routing and advance() for validated state transitions. The orchestrator will create a GoalStateMachine per goal and drive it through the lifecycle.

---
*Phase: 02-core-orchestration-loop*
*Completed: 2026-03-16*
