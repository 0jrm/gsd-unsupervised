---
phase: 03-agent-integration
plan: 02
subsystem: infra
tags: [stream-parsing, ndjson, cursor-agent, timeout, resume]

requires:
  - phase: 03-agent-integration
    provides: hardened cursor-agent invoker (timeouts, session log, heartbeat)
provides:
  - robust NDJSON stream parsing for cursor-agent output
  - deterministic completion detection using the last terminal result event
affects: [crash-recovery, resume, daemon, monitoring]

tech-stack:
  added: []
  patterns:
    - fail-closed stream parsing that tolerates extra fields and noisy lines

key-files:
  created: []
  modified:
    - src/stream-events.ts
    - src/stream-events.test.ts

key-decisions:
  - "Completion detection prefers the last terminal result event in the stream"

patterns-established:
  - "Stream parsing treats noise (blank, non-JSON, truncated lines) as null events while preserving valid events"

issues-created: []

duration: 5min
completed: 2026-03-17
---

# Phase 3 Plan 2: Stream parsing and completion detection Summary

**NDJSON parsing is more robust and completion detection correctly handles multi-result streams.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-17T13:45:00Z
- **Completed:** 2026-03-17T13:46:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Ensured `extractResult` prefers the last terminal result event so multi-result streams report the final outcome.
- Expanded `parseEvent` tests to cover noisy input (blank, non-JSON, truncated JSON, and noise around valid events).

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix completion extraction to handle multiple result events and prefer the last terminal result** - `10d0d17` (fix/test)
2. **Task 2: Expand parsing coverage for noisy streams (blank lines, non-JSON, partial JSON)** - `10d0d17` (test)

**Plan metadata:** _Included in a later docs commit for this plan_

_Note: TDD tasks may have multiple commits (test → feat → refactor)._

## Files Created/Modified

- `src/stream-events.ts` — Completion extraction scans from the end and returns the last `result` event.
- `src/stream-events.test.ts` — Added coverage for noisy streams and multi-result cases.

## Decisions Made

- None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Stream parsing and completion detection are ready for crash detection and resume work.
- Phase 3 complete; ready for Phase 4 (STATE monitoring & phase transitions).

---
*Phase: 03-agent-integration*
*Completed: 2026-03-17*

