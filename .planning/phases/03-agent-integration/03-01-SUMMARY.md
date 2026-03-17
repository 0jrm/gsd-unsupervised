---
phase: 03-agent-integration
plan: 01
subsystem: infra
tags: [cursor-agent, subprocess, timeout, heartbeat, session-log, vitest]

requires:
  - phase: 02-lifecycle
    provides: orchestrator lifecycle + execute-plan loop using AgentInvoker seam
provides:
  - deterministic timeout classification via `RunAgentResult.timedOut`
  - hermetic tests for spawn args/env/timeout abort and invoker session logging + heartbeat lifecycle
affects: [03-02, crash-recovery, resume, daemon, monitoring]

tech-stack:
  added: []
  patterns:
    - explicit timeout signal separate from stderr diagnostics
    - hermetic subprocess tests via `spawn`/`tree-kill` mocks

key-files:
  created:
    - src/agent-runner.spawn.test.ts
    - src/cursor-agent.invoker.test.ts
  modified:
    - src/agent-runner.ts
    - src/cursor-agent.ts

key-decisions:
  - "Timeout is signaled by `RunAgentResult.timedOut`, not inferred from stderr text"

patterns-established:
  - "Invoker classification uses explicit fields (timeout vs crash) for deterministic resume behavior"

issues-created: []

duration: 10min
completed: 2026-03-17
---

# Phase 3 Plan 1: Agent invoker hardening Summary

**Cursor agent invocation is now deterministic and well-covered (spawn args, timeout/abort, session logging, heartbeat).**

## Performance

- **Duration:** 10 min
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Made timeouts a first-class signal (`RunAgentResult.timedOut`) and removed stderr-substring classification.
- Added hermetic subprocess tests that lock down spawn args/env merging and timeout abort behavior.
- Added invoker tests that verify session-log statuses and heartbeat write/cleanup across success/timeout/crash outcomes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Make timeouts first-class in the runAgent result** - `8ca8ee1` (fix)
2. **Task 2: Add unit tests for spawn args, env passthrough, and timeout abort behavior** - `285448f` (test)
3. **Task 3: Add invoker-level tests for session log entries and heartbeat lifecycle** - `73ff017` (test)

## Files Created/Modified

- `src/agent-runner.ts` — Explicit `timedOut` field in `RunAgentResult`
- `src/cursor-agent.ts` — Invoker classifies timeout vs crash via explicit boolean
- `src/agent-runner.spawn.test.ts` — Hermetic tests for spawn args/env/timeout abort
- `src/cursor-agent.invoker.test.ts` — Tests for session log entries and heartbeat lifecycle

## Decisions Made

None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Step

Ready for 03-02-PLAN.md (Stream parsing and completion detection)

---
*Phase: 03-agent-integration*
*Completed: 2026-03-17*

