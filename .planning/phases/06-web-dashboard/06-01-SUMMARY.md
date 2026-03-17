---
phase: 06-web-dashboard
plan: 01
subsystem: orchestration
tags: agent-invoker, cursor-agent, cli, config, zod

# Dependency graph
requires:
  - phase: 05-crash-detection-recovery
    provides: Session log, heartbeat, resume, status server
provides:
  - Agent-agnostic createAgentInvoker factory
  - --agent flag with config validation
  - Stub adapters for claude-code, gemini-cli, codex
affects: Phase 6 dashboard, Phase 7 bootstrap

# Tech tracking
tech-stack:
  added: []
  patterns: Pluggable agent seam via factory

key-files:
  created: []
  modified:
    - src/agent-runner.ts
    - src/cursor-agent.ts
    - src/orchestrator.ts
    - src/config.ts
    - src/cli.ts
    - src/daemon.ts
    - docs/ARCHITECTURE.md
    - README.md

key-decisions:
  - "Default agent is cursor; other agents use same NDJSON/heartbeat contract"
  - "Invalid agent names fail fast at config validation, daemon does not start"

patterns-established:
  - "createAgentInvoker(agentId, config) factory as single agent construction point"

issues-created: []

# Metrics
duration: ~15 min
completed: 2026-03-16
---

# Phase 6 Plan 1: Agent-Agnostic Core Summary

**Introduce `--agent` flag and pluggable AgentInvoker factory while preserving existing Cursor behavior.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-16
- **Completed:** 2026-03-16
- **Tasks:** 3/3
- **Files modified:** 8

## Accomplishments

- Implemented agent abstraction seam and `createAgentInvoker(agentId, config)` factory.
- Wired `--agent` through CLI/config/daemon with validation and fail-fast for invalid names.
- Added tests covering agent selection, config parsing, and daemon wiring.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define agent-agnostic invoker interface and factory** - `65cfad7` (feat)
2. **Task 2: Thread --agent flag through CLI, config, and daemon** - `930d2d3` (feat)
3. **Task 3: Add tests for agent selection and backward compatibility** - `cb856d8` (test)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `src/agent-runner.ts` — AgentId type, SUPPORTED_AGENTS, isSupportedAgent
- `src/cursor-agent.ts` — createAgentInvoker factory, stub adapters
- `src/config.ts` — agent field in schema (default cursor)
- `src/cli.ts` — --agent flag, CURSOR_API_KEY only when agent=cursor
- `src/daemon.ts` — createAgentInvoker(config.agent, config)
- `docs/ARCHITECTURE.md` — Agent seam documentation and sequence diagram
- `README.md` — --agent section and config table
- `src/agent-runner.test.ts`, `src/config.test.ts`, `src/cursor-agent.test.ts`, `tests/agent-wiring.test.ts` — New tests

## Decisions Made

- Default agent is `cursor`; other agents use the same NDJSON/heartbeat contract.
- Invalid agent names fail fast at config load; daemon does not start.

## Issues Encountered

None.

## Next Step

- Ready for 06-02-PLAN.md (status API + dashboard backend).

---
*Phase: 06-web-dashboard*
*Completed: 2026-03-16*
