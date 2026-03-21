# Architecture

High-level module roles and data flow for contributors. For product overview and usage, see [README.md](../README.md).

## Agent-agnostic invoker seam

The orchestrator drives GSD via an **AgentInvoker** function-type seam: it does not depend on any specific AI agent implementation. A factory `createAgentInvoker(agentId, config)` returns the appropriate adapter:

- **cursor** — Full implementation: spawns `cursor-agent` with NDJSON streaming, retry policy, heartbeat, and session logging.
- **cn** — Full implementation: spawns Continue CLI (`cn`) in headless mode with heartbeat + session log lifecycle.
- **codex** — Full implementation: spawns Codex CLI (`codex exec`) in non-interactive mode with heartbeat + session log lifecycle.

**Rationale:** Decouples orchestrator core (heartbeat, resume, status server, git checkpoints) from any single agent so Phase 6+ features (dashboard, bootstrap) work with Cursor today and other agents later.

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Orchestrator│────▶│ createAgentInvoker│────▶│ cursor-agent    │
│             │     │ (agentId, config) │     │ cn              │
│             │     │                  │     │ codex           │
└─────────────┘     └──────────────────┘     └─────────────────┘
       │                       │                       │
       │                       │                       ▼
       │                       │              ┌─────────────────┐
       │                       │              │ Underlying CLI  │
       │                       │              │ (cursor-agent,   │
       │                       │              │  etc.)          │
       │                       │              └─────────────────┘
       ▼
  AgentInvoker(command, workspace, logger, logContext) → Promise<AgentResult>
```

## Data flow

1. **CLI** loads config (file + CLI overrides), validates local agent credentials/binary for live runs, then either prints the goals table (dry-run), runs the intake front door (`start`), or calls **daemon**.
2. **start command** (`./start` / `gsd-unsupervised start`) syncs upstream GSD into `.cursor/` and `.codex/`, classifies the request, writes an intake bundle under `.planning/intake/<timestamp>-<slug>/`, updates `goals.md`, and optionally launches the daemon when no healthy daemon is already running.
3. **Daemon** loads goals from `goals.md`, creates one agent invoker via `createAgentInvoker(config.agent, config)`, then for each pending goal:
   - Builds path to `.planning/STATE.md`.
   - Creates **StateWatcher** (chokidar on STATE.md), registers progress listeners, starts it.
   - Calls **orchestrator** with the goal, config, logger, agent, and optional `onProgress`.
   - On exit (success or failure), stops the watcher.
4. **Orchestrator** runs route-aware execution:
   - `quick` goals call `/gsd:quick` directly.
   - `full` goals run the lifecycle state machine: roadmap, phase planning, and shared `runPlan` execution.
   In both cases it passes breadcrumb metadata (`route`, bundle path, session context path, agent brief path) to the selected invoker so fresh sessions and spawned agents can reconstruct context from disk. Plan execution (normal + resume) is routed through a shared `runPlan` path for consistent validation, verify handling, and fail-fast behavior. After each successful agent call it calls `reportProgress(expectedPhase)` (reads STATE.md, calls `onProgress` when provided, and logs a non-fatal structured warning when the STATE.md phase number does not match the orchestrator’s expected phase, including `{ expectedPhase, actualPhase, actualPhaseName, plan, status }` in the log context).
5. **StateWatcher** parses STATE.md on add/change (debounced), compares with previous snapshot, and emits `state_changed`, `phase_advanced`, `plan_advanced`, `phase_completed`, `goal_completed` as appropriate.

## Module roles

| Module | Role |
|--------|------|
| **cli.ts** | Commander options, logger init, config load, API key check, dry-run vs runDaemon. |
| **config.ts** | Zod schema for all options; load from file and merge CLI overrides; safeParse with clear errors. |
| **daemon.ts** | Goal loop, StateWatcher per goal (start before orchestrateGoal, stop in finally), progress event logging, shutdown handlers. |
| **orchestrator.ts** | Route-aware goal execution (`/gsd:quick` vs full lifecycle), roadmap/phase/plan discovery, shared `runPlan` executor, strict fail-fast for invalid plans/verify failures, reportProgress (read STATE.md, onProgress, mismatch warning). Uses stub agent when no invoker passed (tests/dry-run). |
| **lifecycle.ts** | Goal phases (e.g. initializing_project, creating_roadmap, planning_phase, executing_plan), command sequence, getNextCommand. |
| **goals.ts** | Parse goals.md by section (Pending / In Progress / Done), including route + breadcrumb metadata from `###` blocks. |
| **goal-metadata.ts** | Parse/build the structured metadata block stored under queued goals in `goals.md`. |
| **goal-context.ts** | Builds the disk-backed prompt preamble that points agents at `AGENT-BRIEF.md` and `SESSION-CONTEXT.md`. |
| **roadmap-parser.ts** | Parse ROADMAP.md, find phase dirs, discover PLAN.md files, get next unexecuted plan. |
| **state-parser.ts** | Parse "## Current Position" in STATE.md → StateSnapshot (phase, plan, status, progressPercent). readStateMd(path) returns null on missing/parse failure. |
| **resume-pointer.ts** | Pure computeResumePointer(opts): loads session log and STATE.md, derives last plan-complete/phase-complete, returns ResumePointer or null. Side-effect free. |
| **state-watcher.ts** | Chokidar on STATE.md, debounce, readStateMd on change, emit typed progress events; start/stop, getLastSnapshot. |
| **cursor-agent.ts** | createAgentInvoker(agentId, config), runtime adapters for `cursor`, `cn`, `codex`, and API key validators (`CURSOR_API_KEY`, `CONTINUE_API_KEY`, `OPENAI_API_KEY`). Includes retry (cursor), timeout aborts, heartbeat, and session-log lifecycle. |
| **gsd-sync.ts** | Fetch/cache upstream `gsd-build/get-shit-done`, mirror runtime assets into `.cursor/` and `.codex/`, and record `.gsd/upstream/manifest.json`. |
| **intake/bundle.ts** | Writes `.planning/intake/` bundles plus `LATEST.json` / `LATEST.md` stable pointers. |
| **intake/start-command.ts** | Daemon-aware intake front door used by `./start` and `gsd-unsupervised start`. |
| **stream-events.ts** | Parse NDJSON stream from cursor-agent, emit typed events; parseEvent returns null on bad lines. |
| **logger.ts** | Pino init (level, pretty), createChildLogger for component names. |

## Key design choices

- **StateWatcher optional** — If construction fails, daemon logs a warning and continues without watching.
- **reportProgress non-fatal** — State mismatch only logs a structured warning; orchestration does not fail, and pre-phase steps (project init and roadmap creation) use `expectedPhase: 0` to match the daemon-written STATE.md.
- **Stub agent default** — Orchestrator uses a stub when no invoker is passed (tests and dry-run).
- **Single invoker per run** — One selected-runtime invoker is created in the daemon and reused for all goals in the run.
- **Execution truth from session log** — Plan completion is derived from terminal execute-plan statuses in `session-log.jsonl`, not `*-SUMMARY.md` existence.
- **Disk breadcrumbs over transient chat context** — `goals.md` remains the queue of record, while `.planning/intake/` holds the durable session and subagent context for queued goals.
- **Repo-owned overlay files** — Runtime bridge files live outside the synced upstream tree so upstream refreshes remain repeatable.
- **Cursor/Codex parity first** — Upstream sync and breadcrumb guarantees are implemented for `cursor` and `codex`. `cn` can still run queued work but does not yet have equivalent breadcrumb consumption.
- **Per-goal watcher** — Each goal gets its own StateWatcher, started before and stopped after orchestrateGoal.

## Crash detection and recovery

- **Session log** — Append-only `session-log.jsonl` at project root (config `sessionLogPath`). One JSON object per line: `timestamp`, `goalTitle`, `phase`, `phaseNumber`, `planNumber`, `sessionId`, `command`, `status` (`running` | `done` | `crashed` | `timeout` | `verify-failed` | `skipped`), optional `durationMs`, `error`, `failureContext`.
- **inspectForCrashedSessions(logPath)** — Returns the most recent log entry if its status is `running` or `crashed`, else `null`. Used at daemon startup to detect an interrupted session.
- **computeResumePointer(opts)** — Pure function in `resume-pointer.ts` that loads the session log via `readSessionLog` and `readStateMd` for STATE.md. Derives the last known successful execution point from the log: the latest `plan-complete` event (status `done` + phase `/gsd/execute-plan` with `phaseNumber`/`planNumber`), or the latest `phase-complete` (status `done` + phase `/gsd/plan-phase` with `phaseNumber`), falling back to `null`. Returns `ResumePointer { phaseNumber, planNumber }` only when the last entry for the goal is `running` or `crashed`; otherwise returns `null`. Cross-checks STATE.md: if STATE disagrees (e.g. phase in progress but no corresponding completion in the log), favors the more conservative (earlier) pointer. `planNumber: 0` means "first plan of this phase". Missing or unreadable log/STATE returns `null`.
- **Resume path** — When the daemon passes `resumeFrom` to the orchestrator, it fast-forwards (no agent calls) to that phase/plan, runs one `execute-plan` (retry), then continues with the normal plan loop and remaining phases. User-facing logs: "Resuming from phase X plan Y due to previous crash".
- **Heartbeat** — While the agent runs, a heartbeat file (`.planning/heartbeat.txt`) is updated periodically. If the last log entry is `running` and the heartbeat is missing or older than 60s, the daemon treats it as a crash (appends a `crashed` entry) so the next startup can resume.
- **Config** — `requireCleanGitBeforePlan` (default `true`): refuse `execute-plan` when the working tree is dirty. `autoCheckpoint` (default `false`): when enabled and tree is dirty, create a checkpoint commit before running the plan. `sessionLogPath`: path to the session log file.

**Sequence:** Previous run crashes → STATE.md and session log left in partial state → next run inspects them via `computeResumePointer` → either resumes from last complete plan (or first plan of next phase) or starts fresh if the history is unusable.

**Failure modes:** Agent crash (non-zero exit or throw) → log entry `crashed`; next start resumes when unambiguous. Timeout → log entry `timeout`; no resume from that entry. Verify failure after plan execution → `verify-failed` and goal failure. Invalid plan file → `skipped` and goal failure. Dirty git → orchestrator aborts (or creates checkpoint if `autoCheckpoint`). Ambiguous resume (e.g. empty log, goal mismatch, or last entry not running/crashed) → `computeResumePointer` returns `null`; run starts from scratch.

## Status server and heartbeat

- **Status server** — When `statusServerPort` is set (or `--status-server <port>`), the **daemon** starts an Express-based HTTP server before the goal loop and closes it on process exit or shutdown (same lifecycle as the daemon). When dashboard options are provided (stateMdPath, sessionLogPath, workspaceRoot), `GET /` serves a single-page **dashboard** (HTML with inlined CSS/JS): header with current agent and overall status, per-goal card with phase/plan progress bar, recent git commit feed, and token/cost summary. The dashboard fetches `GET /api/status` every 10 seconds and updates the DOM without a full page reload; it uses mobile-first CSS and stacks cards vertically on narrow viewports. Legacy JSON: `GET /status` always returns `{ running, currentGoal?, phaseNumber?, planNumber?, heartbeat?, paused?, pauseFlagPath? }`. Dashboard API: `GET /api/status` returns a richer JSON payload: same fields plus `currentAgentId`, `stateSnapshot`, `sessionLogEntries`, `gitFeed`, and placeholder `tokens`/`cost`. The server is given `stateMdPath`, `sessionLogPath`, and `workspaceRoot` so it can read STATE.md, session-log.jsonl, and the git repo; the daemon passes these from config. On `EADDRINUSE`, status server creation degrades gracefully (returns `server: null`) and the daemon keeps running. **Access from WSL2:** Open `http://localhost:PORT/` in a browser on the Windows host or from another device on the same network (use the machine’s LAN IP and the same port if needed). **Config API:** When `planningConfigPath` is set (path to `.planning/config.json`), `GET /api/config` returns the planning config (including `parallelization`) and `POST /api/config` accepts a JSON body with a `parallelization` object (e.g. `{ "enabled": true }`) and merges it into the file. Invalid input (e.g. non-boolean `parallelization.enabled`) returns 400 and does not crash the daemon. The dashboard’s sequential/parallel toggle is a convenience wrapper around this; the daemon at startup reads `.planning/config.json` and uses `parallelization.enabled` to decide sequential vs parallel goal processing, so the toggle takes effect on the **next** daemon run (or current run if it has not yet started processing goals). It does not affect a wave of execution already in progress. Dependencies: Express and simple-git.
- **Heartbeat** — The invoker writes `.planning/heartbeat.txt` with an ISO timestamp every 15s while the agent runs and removes it on done/crashed/timeout. Missing or stale (>60s) heartbeat with a `running` session is treated as a crash for resume.

## GSD as black box

The orchestrator drives GSD only via commands and file system: it writes no GSD internals, and reads only ROADMAP.md, STATE.md, and phase/plan files under `.planning/`. Upstream GSD assets are mirrored into `.cursor/` and `.codex/` from `.gsd/upstream/get-shit-done`, while repo-owned overlay files stay outside the synced upstream surface.

## STATE.md “Current Position” contract

The daemon and dashboard treat `.planning/STATE.md` as the single source of truth for where a goal is in the GSD lifecycle. Only the `## Current Position` block is parsed; everything else is free-form.

`state-parser.ts` expects the following exact line formats:

- **Phase line**: `Phase: X of Y (Name)` — phase and total phase numbers plus the human-readable phase name in parentheses.
- **Plan line**: `Plan: N of M in current phase` — current plan index and total plans for that phase.
- **Status line**: `Status: <arbitrary status text>` — free-form, but `StateWatcher` treats any value containing “complete” (case-insensitive) as a completed phase.
- **Last activity line** (optional but recommended): `Last activity: <ISO timestamp or human text>` — used for progress logs and resume context.
- **Progress line** (optional): `Progress: [bar] NN%` — visual bar is ignored; only the trailing percentage is parsed into `progressPercent`.

`readStateMd(path)` returns `null` when the file is missing or fails to match this format and never throws; callers must treat `null` as “no reliable state”. `StateWatcher` debounces filesystem events, calls `readStateMd`, emits `state_changed`/`phase_advanced`/`plan_advanced`/`phase_completed`/`goal_completed` based on snapshot diffs, and ignores missing/unparseable state (logs at debug/warn but does not emit progress events).
