---
phase: 02-core-orchestration-loop
plan: 03
subsystem: orchestration
tags: [orchestrator, agent-invoker, lifecycle-loop, daemon-wiring]

requires:
  - phase: 02-01
    provides: GoalStateMachine, GoalLifecyclePhase, GsdCommand, GoalProgress
  - phase: 02-02
    provides: parseRoadmap, findPhaseDir, discoverPlans, getNextUnexecutedPlan
provides:
  - orchestrateGoal() function driving goals through full GSD lifecycle
  - AgentInvoker type as clean seam for Phase 3 cursor-agent integration
  - AgentResult interface for agent call outcomes
  - Stub agent simulating cursor-agent calls with logging
  - Daemon loop wired to orchestrator with per-goal error isolation
affects: [03-cursor-agent-integration]

tech-stack:
  added: []
  patterns: [AgentInvoker function type as dependency injection seam, shutdown polling between lifecycle steps, per-goal try/catch in daemon loop]

key-files:
  created: [src/orchestrator.ts]
  modified: [src/daemon.ts]

key-decisions:
  - "AgentInvoker is a function type (not class/interface) — simplest seam for Phase 3 to swap stub with real cursor-agent spawning"
  - "Shutdown checked between every lifecycle step (not mid-agent-call) — clean stopping points with progress logging"
  - "Agent failures cause early return with sm.fail() rather than throwing — distinguishes agent errors from orchestrator bugs"
  - "Per-goal try/catch in daemon: one goal failing doesn't abort the entire queue"
  - "GSD commands built manually in phase/plan loops rather than relying solely on getNextCommand() — orchestrator owns command construction for plan-phase and execute-plan"

patterns-established:
  - "Dependency injection via optional parameter: agent?: AgentInvoker defaults to stubAgent internally"
  - "Shutdown polling via isShuttingDown callback: daemon passes () => shuttingDown, orchestrator checks between steps"
  - "Progress logging with structured data: { phase, plan, cmd } fields on every lifecycle log line"

issues-created: []

duration: 4min
completed: 2026-03-16
---

# Phase 2 Plan 03: Orchestrator Loop & Daemon Wiring Summary

**Orchestrator drives goals through the full GSD lifecycle with stub agent calls, wired into the daemon loop with per-goal error isolation and graceful shutdown.**

## Performance
- **Duration:** ~4min
- **Tasks completed:** 2 of 3 (Task 3 is a checkpoint pending user approval)
- **Files created:** 1
- **Files modified:** 1

## Accomplishments
- Built `orchestrateGoal()` that sequences a goal through all GSD lifecycle phases: new-project → create-roadmap → plan-phase (per phase) → execute-plan (per plan) → complete
- Defined `AgentInvoker` function type as the clean injection seam Phase 3 will replace with real cursor-agent spawning
- Implemented stub agent that logs each GSD command with 100ms simulated delay
- Wired orchestrator into daemon loop replacing the old `processGoal` stub
- Per-goal try/catch ensures one goal failure doesn't abort the queue; progress logged as `{i}/{total}`
- Shutdown polling between every lifecycle step with structured progress in shutdown log messages

## Task Commits
1. **Task 1: Build orchestrator with stub agent** — `1931197` (feat)
2. **Task 2: Wire orchestrator into daemon loop** — `a734fe0` (refactor)

## Files Created/Modified
- `src/orchestrator.ts` — AgentResult, AgentInvoker, stubAgent, orchestrateGoal(), logShutdown()
- `src/daemon.ts` — Replaced processGoal with orchestrateGoal call, added per-goal error handling and progress logging, removed Goal type import

## Decisions Made
- Commands for plan-phase and execute-plan are constructed manually in the orchestrator loop rather than exclusively using `getNextCommand()`, since the orchestrator needs to thread phase numbers and plan paths from filesystem discovery
- Agent call failures (result.success === false) trigger `sm.fail()` and early return rather than throwing, keeping agent errors distinct from unexpected orchestrator exceptions
- The `logShutdown` helper extracts progress from the state machine so shutdown messages always include current phase/plan context

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None.

## Pending
- **Task 3 (checkpoint: human-verify)** — Manual verification that the CLI runs end-to-end showing full lifecycle per goal with stub agent. Awaiting user approval.

## Next Phase Readiness
Phase 2 orchestration loop is functionally complete. The orchestrator sequences goals through the full GSD lifecycle with validated state transitions, roadmap/plan discovery, and graceful shutdown. The `AgentInvoker` type provides the clean seam Phase 3 needs to swap the stub with real cursor-agent spawning.

---
*Phase: 02-core-orchestration-loop*
*Completed: 2026-03-16*
