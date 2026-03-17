# Architecture

High-level module roles and data flow for contributors. For product overview and usage, see [README.md](../README.md).

## Data flow

1. **CLI** loads config (file + CLI overrides), validates `CURSOR_API_KEY` (unless `--dry-run`), then either prints the goals table (dry-run) or calls **daemon**.
2. **Daemon** loads goals from `goals.md`, creates one **cursor-agent** invoker, then for each pending goal:
   - Builds path to `.planning/STATE.md`.
   - Creates **StateWatcher** (chokidar on STATE.md), registers progress listeners, starts it.
   - Calls **orchestrator** with the goal, config, logger, agent, and optional `onProgress`.
   - On exit (success or failure), stops the watcher.
3. **Orchestrator** runs the GSD lifecycle state machine: loads roadmap, discovers phases/plans, and for each step invokes the **agent** with the right GSD command (`/gsd/new-project`, `/gsd/create-roadmap`, `/gsd/plan-phase`, `/gsd/execute-plan`, etc.). After each successful agent call it calls `reportProgress(expectedPhase)` (reads STATE.md, calls `onProgress`, logs a warning if phase mismatch).
4. **StateWatcher** parses STATE.md on add/change (debounced), compares with previous snapshot, and emits `state_changed`, `phase_advanced`, `plan_advanced`, `phase_completed`, `goal_completed` as appropriate.

## Module roles

| Module | Role |
|--------|------|
| **cli.ts** | Commander options, logger init, config load, API key check, dry-run vs runDaemon. |
| **config.ts** | Zod schema for all options; load from file and merge CLI overrides; safeParse with clear errors. |
| **daemon.ts** | Goal loop, StateWatcher per goal (start before orchestrateGoal, stop in finally), progress event logging, shutdown handlers. |
| **orchestrator.ts** | Goal state machine, roadmap/phase/plan discovery, agent invocation order, reportProgress (read STATE.md, onProgress, mismatch warning). Uses stub agent when no invoker passed (tests/dry-run). |
| **lifecycle.ts** | Goal phases (e.g. initializing_project, creating_roadmap, planning_phase, executing_plan), command sequence, getNextCommand. |
| **goals.ts** | Parse goals.md by section (Pending / In Progress / Done), return list of goals with status. |
| **roadmap-parser.ts** | Parse ROADMAP.md, find phase dirs, discover PLAN.md files, get next unexecuted plan. |
| **state-parser.ts** | Parse "## Current Position" in STATE.md → StateSnapshot (phase, plan, status, progressPercent). readStateMd(path) returns null on missing/parse failure. |
| **state-watcher.ts** | Chokidar on STATE.md, debounce, readStateMd on change, emit typed progress events; start/stop, getLastSnapshot. |
| **cursor-agent.ts** | createCursorAgentInvoker(config), validateCursorApiKey(); invoker spawns cursor-agent with NDJSON streaming, tree-kill on timeout/abort, session logging. |
| **stream-events.ts** | Parse NDJSON stream from cursor-agent, emit typed events; parseEvent returns null on bad lines. |
| **logger.ts** | Pino init (level, pretty), createChildLogger for component names. |

## Key design choices

- **StateWatcher optional** — If construction fails, daemon logs a warning and continues without watching.
- **reportProgress non-fatal** — State mismatch only logs a warning; orchestration does not fail.
- **Stub agent default** — Orchestrator uses a stub when no invoker is passed (tests and dry-run).
- **Single invoker per run** — One cursor-agent invoker is created in the daemon and reused for all goals in the run.
- **Per-goal watcher** — Each goal gets its own StateWatcher, started before and stopped after orchestrateGoal.

## GSD as black box

The orchestrator drives GSD only via commands and file system: it writes no GSD internals, and reads only ROADMAP.md, STATE.md, and phase/plan files under `.planning/`. GSD rules live in `.cursor/rules/` and are not modified by this project.
