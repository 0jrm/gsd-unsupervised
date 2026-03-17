# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-16)

**Core value:** The orchestrator loop must never stall, never lose state, and recover from crashes automatically — reliable hands-off goal-to-completion automation is the entire value proposition.
**Current focus:** Phase 2 — Core Orchestration Loop (complete)

## Current Position

Phase: 2 of 7 (Core Orchestration Loop)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-03-16 — Completed 02-03-PLAN.md

Progress: █████░░░░░ 29%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: ~3min
- Total execution time: ~18min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 - Foundation | 3/3 | ~9min | ~3min |
| 2 - Orchestration | 3/3 | ~9min | ~3min |

**Recent Trend:**
- Last 3 plans: 2min, 3min, 4min
- Trend: Stable

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- ESM static import in bin shim (avoids double main() invocation)
- Config uses safeParse with formatted errors for user-friendly validation
- Goals parser uses section headers for status (not checkbox state)
- Logger singleton pattern with initLogger/getLogger for easy module access
- Graceful shutdown: first SIGINT sets flag, second force-exits
- fail() bypasses transition validation — any state can fail directly
- getNextCommand() returns null for planning_phase/executing_plan — orchestrator discovers paths externally
- AgentInvoker is a function type (simplest seam for Phase 3 swap)
- Per-goal try/catch in daemon: one goal failing doesn't abort queue
- Shutdown polling between every lifecycle step with progress context

### Pending Todos

3 pending todo(s) in `.planning/todos/pending/`

### Deferred Issues

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-16
Stopped at: Completed 02-03-PLAN.md — Phase 2 complete
Resume file: None

## Architecture Decisions (Pre-Phase 1)

### Session Tracking
- Each cursor-agent invocation writes session_id to session-log.jsonl
- Format: {"ts":"...","goal":"...","phase":"...","session_id":"...","status":"running|done|crashed"}
- Orchestrator reads this on startup to detect interrupted sessions
- Crash recovery: find last "running" entry → re-run that phase from last git commit

### Invocation Pattern (from Phase 3 research)
- All cursor-agent calls use: -p --force --trust --approve-mcps --workspace <dir> --output-format stream-json
- --workspace is MANDATORY — without it GSD rules don't load
- session_id captured from first NDJSON event {"type":"session_init"}

### Auth (Phase 7 concern)
- Headless cursor-agent requires CURSOR_API_KEY env var
- setup.sh must check for it and guide user to obtain it
- Without it, every orchestrator invocation will fail silently

### Auth (Phase 7 concern)
- Headless cursor-agent requires CURSOR_API_KEY env var
- setup.sh must check for it and guide user to obtain it
- Without it, every orchestrator invocation will fail silently
