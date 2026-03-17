---
phase: 05-crash-detection-recovery
plan: 02
subsystem: infra
tags: crash-recovery, computeResumePoint, daemon, heartbeat-timeout

# Dependency graph
requires:
  - phase: 05-01
    provides: inspectForCrashedSessions, session log with goalTitle/phaseNumber/planNumber, heartbeat file
provides:
  - computeResumePoint() — deterministic resume point; null on ambiguity
  - Daemon calls computeResumePoint and passes resumeFrom to orchestrateGoal for first goal only
  - Missing-heartbeat >60s appends 'crashed' entry so next startup can resume
affects: 05-03 (orchestrator consumes resumeFrom)

# Tech tracking
tech-stack:
  added: []
  patterns: prefer STATE.md for position; fallback to log entry only when both phaseNumber and planNumber >= 1

key-files:
  created: []
  modified: src/session-log.ts, src/daemon.ts, src/orchestrator.ts, src/session-log.test.ts

key-decisions:
  - "Resume only when goalTitle matches first pending goal (trimmed exact match)"
  - "When in doubt return null — start from scratch; no silent skip"
  - "Heartbeat timeout 60s; append crashed entry with same identity so computeResumePoint sees it"

patterns-established:
  - "Crash detection at daemon startup: inspectForCrashedSessions then optional heartbeat stale → append crashed → computeResumePoint"

issues-created: []

# Metrics
duration: ~8min
completed: 2026-03-17
---

# Phase 5 Plan 2: computeResumePoint & Daemon Resume Summary

**Deterministic computeResumePoint(), daemon passes resumeFrom for first goal only, and missing-heartbeat >60s marks session crashed.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 3 (computeResumePoint, daemon wiring, heartbeat timeout)
- **Files modified:** 4

## Accomplishments

- computeResumePoint(sessionLogPath, stateMdPath, firstPendingGoalTitle) returns ResumeFrom | null; prefers STATE.md, fallback to entry.phaseNumber/planNumber when both >= 1
- Daemon calls computeResumePoint before goal loop; passes resumeFrom only when i === 0
- orchestrateGoal options extended with resumeFrom (used in 05-03)
- Missing-heartbeat: if last entry is 'running', check heartbeat file; if missing or mtime >60s, append 'crashed' entry then compute resume point
- Unit tests for computeResumePoint (empty log, goal mismatch, ambiguous, STATE.md match, log fallback)

## Task Commits

1. **Task 1: computeResumePoint** - `87bd65f` (feat)
2. **Tasks 2–3: Daemon resumeFrom + heartbeat timeout** - `fe645a9` (feat)

## Files Created/Modified

- `src/session-log.ts` - readStateMd import, ResumeFrom, computeResumePoint()
- `src/session-log.test.ts` - computeResumePoint tests
- `src/daemon.ts` - computeResumePoint, heartbeat stale check, resumeFrom passed to orchestrateGoal
- `src/orchestrator.ts` - ResumeFrom import, orchestrateGoal options resumeFrom

## Decisions Made

None beyond plan — followed spec (deterministic, no silent skip).

## Deviations from Plan

None.

## Issues Encountered

None.

## Next Phase Readiness

Ready for 05-03-PLAN.md (orchestrator resume path, clean git, checkpoint, isPlanCompleted).

---
*Phase: 05-crash-detection-recovery*
*Completed: 2026-03-17*
