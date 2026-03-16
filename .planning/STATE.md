# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-16)

**Core value:** The orchestrator loop must never stall, never lose state, and recover from crashes automatically — reliable hands-off goal-to-completion automation is the entire value proposition.
**Current focus:** Phase 1 — Foundation & CLI Scaffold

## Current Position

Phase: 1 of 7 (Foundation & CLI Scaffold)
Plan: Not started
Status: Ready to plan
Last activity: 2026-03-16 — Project initialized

Progress: ░░░░░░░░░░ 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

(None yet)

### Deferred Issues

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-16
Stopped at: Project initialization complete
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
