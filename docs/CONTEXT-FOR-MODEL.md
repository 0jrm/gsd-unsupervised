# GSD Unsupervised — Model Context

Compact context for assistants working in this repo. This document tracks current implementation (not historical plans).

## Project in one paragraph

`gsd-unsupervised` is a local daemon that executes GSD workflows from a `goals.md` queue. It runs agent commands (`/gsd/new-project`, `/gsd/create-roadmap`, `/gsd/plan-phase`, `/gsd/execute-plan`), watches `.planning/STATE.md`, records session events in `session-log.jsonl`, and resumes after crashes. It supports multiple runtimes (`cursor`, `cn`, `codex`) with strict fail-fast behavior for invalid plans and verify failures.

## Current capabilities

- Goal queue intake from `goals.md` with hot reload.
- Lifecycle orchestration across roadmap phases and plans.
- Runtime adapters:
  - `cursor` (NDJSON stream + retry policy)
  - `cn` (Continue CLI)
  - `codex` (Codex CLI via `codex exec`)
  - `claude-code` and `gemini-cli` are stubs.
- Shared plan execution path in orchestrator for normal + resume flow.
- Execution truth derived from session-log terminal statuses, not summary-file presence.
- Verify hook (`verifyCommand`) with fail-fast handling.
- Pause safety: after repeated failures daemon creates `.pause-autopilot`; `gsd-unsupervised unpause` clears it.
- Status/dashboard server with `/status`, `/api/status`, `/api/config`, dashboard intake routes, and optional ngrok.
- Optional Twilio notifications.

## Core files

- `src/cli.ts`: default CLI action, `run`, `init`, `add-goal`, `new-project`, `unpause`, `validate-agent`, SMS test commands.
- `src/config.ts`: config schema + planning overrides.
- `src/daemon.ts`: main worker loop, state consistency checks, pause behavior, status server lifecycle, goal hot reload.
- `src/orchestrator.ts`: phase/plan orchestration, shared `runPlan`, strict invalid-plan/verify fail-fast behavior.
- `src/roadmap-parser.ts`: roadmap parsing and session-log-based plan execution status derivation.
- `src/cursor-agent.ts`: runtime adapters and credentials validation for cursor/cn/codex.
- `src/status-server.ts`: dashboard API/routes and graceful status-server startup fallback on `EADDRINUSE`.
- `src/resume-pointer.ts`: computes resume pointer from session log + STATE snapshot.

## Runtime model

1. CLI resolves config and validates selected runtime credentials/binary.
2. Daemon loads pending goals and starts worker(s) (sequential or pool).
3. For each goal, orchestrator drives GSD command flow.
4. Agent invoker appends `running` then terminal status to session log and maintains heartbeat file.
5. On restart, daemon checks session log and resumes when last matching entry indicates interrupted work.

## Session log status model

- Runtime lifecycle: `running`, `done`, `crashed`, `timeout`
- Orchestrator-level fail-fast statuses: `verify-failed`, `skipped`
- Plan completion truth uses terminal execute-plan statuses only (`done|skipped|verify-failed|crashed|timeout`).

## Operational notes

- `.planning/STATE.md` is read-only for daemon logic; agent owns updates.
- `session-log.jsonl` is append-only through `appendSessionLog`.
- Pause flag path is `<workspace>/.pause-autopilot`.
- Dashboard status includes `paused` and `pauseFlagPath`.
- `createStatusServer` degrades gracefully when the port is already in use.

## Related docs

- `README.md`: user-facing setup and usage.
- `docs/ARCHITECTURE.md`: module roles and data flow.
- `AGENTS.md`: command contract and run rules for agents.
- `.codex/README.md`: codex runtime integration notes.

Last synchronized with implementation: 2026-03-20.
