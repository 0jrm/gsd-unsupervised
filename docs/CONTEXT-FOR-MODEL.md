# GSD Autopilot — Context for Smart Model (Assistant / CEO)

This document gives a capable model enough context to act as a useful assistant and strategic “CEO” for the project: what the project is, what it does, how it works, and where everything lives.

---

## 1. Project in One Paragraph

**GSD Autopilot** is a local Node.js orchestrator that drives Cursor’s headless **cursor-agent** through the full **GSD (Get Shit Done)** lifecycle with minimal human intervention. It reads a **goal queue** (`goals.md`), runs **cursor-agent** with the correct sequence of GSD commands (`/gsd/new-project` → `/gsd/create-roadmap` → `/gsd/plan-phase` → `/gsd/execute-plan`, etc.), watches **`.planning/STATE.md`** for progress, and (when Phase 5 is done) will detect crashes and resume from the last known position. The **core value proposition**: the loop must never stall, never lose state, and recover automatically — reliable hands-off goal-to-completion. Target environment: **WSL2 on Windows**. GSD rules live in the user’s `.cursor/rules/`; the orchestrator treats GSD as a **black box** (commands + files only, no forking of GSD).

---

## 2. Capabilities

### 2.1 Implemented (Phases 1–4)

| Capability | Description |
|------------|-------------|
| **CLI & config** | Single binary entry (`unsupervised-gsd`), Commander-based flags, Zod-validated config (file + CLI overrides). |
| **Goal queue** | Parses `goals.md` by sections: **Pending**, **In Progress**, **Done**. Processes items under Pending; status is section-based, not checkbox state. |
| **Dry-run** | `--dry-run` prints goal summary and config (including `stateWatchDebounceMs`); no API key required, no agent runs. |
| **Sequential execution** | Daemon processes pending goals one after another; `--parallel` and `--max-concurrent` exist for future parallel mode. |
| **GSD lifecycle state machine** | Phases: New → InitializingProject → CreatingRoadmap → PlanningPhase ⇄ ExecutingPlan ⇄ PhaseComplete → … → Complete (or Failed). Commands issued in strict order; planning/executing steps are driven by roadmap and plan discovery, not by `getNextCommand()` (which returns `null` there). |
| **cursor-agent integration** | Spawns **cursor-agent** with fixed flags: `-p --force --trust --approve-mcps --workspace <dir> --output-format stream-json`. **--workspace** is mandatory (GSD rules load from workspace). NDJSON stream parsed; `session_id` from `session_init`; session log written to `session-log.jsonl`. Timeout and abort use **tree-kill** (process tree). |
| **API key** | `CURSOR_API_KEY` env required for live runs; validated at startup (skipped in dry-run). |
| **STATE.md parser** | Parses only the **“## Current Position”** block: phase (X of Y), plan, status, lastActivity, progress percent. Returns `null` on missing section or malformed content. `readStateMd(path)` returns `null` on missing file or parse failure (no throw). |
| **StateWatcher** | Chokidar on `.planning/STATE.md`, debounced (default 500 ms). Emits: `ready`, `state_changed`, `phase_advanced`, `plan_advanced`, `phase_completed`, `goal_completed` (once per watcher). Daemon creates one watcher per goal (start before orchestrateGoal, stop in `finally`). Watcher failure is non-fatal (log warning, continue). |
| **Orchestrator progress** | After each successful agent call, `reportProgress(expectedPhase)` runs: read STATE.md, call optional `onProgress(snapshot)`, and log a **non-fatal structured warning** when `snapshot.phaseNumber !== expectedPhase`, including `{ expectedPhase, actualPhase, actualPhaseName, plan, status }` in the log context. Pre-phase steps (project init and roadmap creation) use `expectedPhase: 0` so they align with the daemon-written STATE.md. |
| **Shutdown** | First SIGINT/SIGTERM sets a flag (graceful); second forces exit. Shutdown is checked between lifecycle steps. |
| **Tests** | Vitest; state-parser and stream-events have solid coverage. Orchestrator uses a **stub agent** when no invoker is passed (tests and dry-run). |

### 2.2 Planned (Phases 5–7)

| Phase | Goal |
|-------|------|
| **5. Crash Detection & Recovery** | Detect when cursor-agent dies mid-phase; read STATE.md for last position; resume from that point with no lost work. Session log format already supports `running|done|crashed`. |
| **6. Web Dashboard** | Express server, plain HTML/CSS/JS (no framework), localhost:3000: live agent status, progress bars, recent STATE.md, git commit feed, token tracking, auto-refresh, sequential/parallel toggle. |
| **7. WSL Bootstrap** | `setup.sh`: detect WSL, resolve Windows `.cursor` path (`/mnt/c/Users/$USER/.cursor`), copy GSD rules, validate install, one-command setup. |

### 2.3 Out of Scope (v1)

Multi-machine orchestration; auth/multi-user dashboard; cost enforcement; cloud sync; push notifications; LLM selection; modifying GSD internals; rollback (git is the safety net).

---

## 3. How It Works (Workings)

### 3.1 Invocation Flow

1. **CLI** (`cli.ts`): Parse argv → init logger → load config (file + CLI) → if not dry-run, validate `CURSOR_API_KEY` → if dry-run, load goals, print table, exit; else register shutdown handlers and `runDaemon(config, logger)`.
2. **Daemon** (`daemon.ts`): Load goals → get pending list → create **one** cursor-agent invoker for the run → for each pending goal:
   - Build path to `.planning/STATE.md`.
   - Create **StateWatcher** (child logger, `stateWatchDebounceMs`), attach listeners (state_changed debug; phase_advanced, plan_advanced, phase_completed, goal_completed info), `watcher.start()`.
   - Call **orchestrateGoal** with goal, config, logger, agent, `isShuttingDown`, `onProgress` (logs snapshot at debug).
   - In `finally`: `watcher.stop()`.
3. **Orchestrator** (`orchestrator.ts`): Build **GoalStateMachine** for the goal. Run the lifecycle:
   - **New** → run `/gsd/new-project` via agent → `reportProgress(1)` → advance to InitializingProject.
   - **InitializingProject** → run `/gsd/create-roadmap` → `reportProgress(1)` → advance to CreatingRoadmap.
   - **CreatingRoadmap** → load ROADMAP.md, get phase count → for each phase:
     - Advance to PlanningPhase → run `/gsd/plan-phase N` → `reportProgress(N)`.
     - Find phase dir, discover plans, get next unexecuted plan; if none, mark phase complete and continue.
     - Loop: advance to ExecutingPlan → run `/gsd/execute-plan <path>` for that plan → `reportProgress(N)`; repeat until no more plans, then PhaseComplete.
     - If more phases, next PlanningPhase; else Complete.
   - On any agent failure: `sm.fail(message)`, return.
4. **StateWatcher**: On add/change (debounced), `readStateMd` → compare with previous snapshot → emit typed events; update `lastSnapshot`. First successful parse emits `ready` and logs “STATE.md first detected”.

### 3.2 Key Interfaces

- **AgentInvoker**: `(command: GsdCommand, workspaceDir: string, logger: Logger) => Promise<AgentResult>`.
- **StateSnapshot**: `phaseNumber`, `totalPhases`, `phaseName`, `planNumber`, `totalPlans`, `status`, `lastActivity`, `progressPercent` (number | null).
- **ProgressEvent**: `state_changed` | `phase_advanced` | `plan_advanced` | `phase_completed` | `goal_completed` with typed payloads.
- **Config**: goalsPath, parallel, maxConcurrent, verbose, logLevel, workspaceRoot, cursorAgentPath, agentTimeoutMs, sessionLogPath, stateWatchDebounceMs (all with defaults/schema in `config.ts`).

### 3.3 GSD Command Order (Orchestrator → Agent)

- `/gsd/new-project` (once)
- `/gsd/create-roadmap` (once)
- For each phase N: `/gsd/plan-phase N`, then for each plan in that phase: `/gsd/execute-plan <path-to-PLAN.md>` (discovered from `.planning/phases/` and ROADMAP).

The orchestrator does **not** call `/gsd/execute-phase`; it drives at plan granularity (execute-plan per PLAN.md). GSD’s own execute-phase can parallelize inside a phase; that’s separate.

### 3.4 Session Log and Crash Recovery

Format: `{"ts":"...","goal":"...","phase":"...","session_id":"...","status":"running|done|crashed"}`. The daemon uses `computeResumePointer` (session log + STATE.md) to derive the last known successful plan-complete or phase-complete. When the last entry for the goal is `running` or `crashed`, it passes `resumeFrom` to the orchestrator, which skips already-completed work and resumes from the indicated phase/plan. By default the system does not skip ahead; it only resumes when the log and STATE indicate an interrupted run. Re-running a plan after a crash is acceptable; the system will not re-run plans that already have a successful `plan-complete` entry unless the user explicitly opts out (future phase).

---

## 4. Directory Tree with Comments and Metadata

```
gsd-cli-test/
├── bin/
│   └── unsupervised-gsd          # Entry: #!/usr/bin/env node; imports '../dist/cli.js'. ESM static import to avoid double main().
│
├── src/                        # TypeScript source (emit to dist/)
│   ├── cli.ts                  # Commander program, options, initLogger, loadConfig, dry-run vs runDaemon, validateCursorApiKey before run.
│   ├── config.ts               # AutopilotConfigSchema (Zod), loadConfig(configPath?, cliOverrides?). safeParse; file then CLI overrides.
│   ├── daemon.ts                # runDaemon: load goals, create invoker, per-goal StateWatcher + orchestrateGoal, shutdown handlers (SIGINT/SIGTERM).
│   ├── orchestrator.ts          # orchestrateGoal: GoalStateMachine, roadmap/phase/plan discovery, agent( command ), reportProgress(expectedPhase). Stub agent default.
│   ├── lifecycle.ts            # GoalLifecyclePhase enum, GsdCommand, GoalStateMachine (advance, getNextCommand, fail, setPhaseInfo, setPlanInfo). getNextCommand returns null for planning_phase/executing_plan.
│   ├── goals.ts                # loadGoals(path), getPendingGoals(goals). Parser: sections ## Pending / ## In Progress / ## Done; status from section, not checkbox.
│   ├── roadmap-parser.ts       # parseRoadmap(roadmapPath), findPhaseDir(phasesRoot, phaseNum), discoverPlans(phaseDir), getNextUnexecutedPlan(plans).
│   ├── state-parser.ts         # parseStateMd(content) → StateSnapshot | null, readStateMd(filePath) → StateSnapshot | null. Only "## Current Position" block.
│   ├── state-watcher.ts        # StateWatcher class (EventEmitter). chokidar on stateMdPath, debounce, readStateMd on change, emit ProgressEvent. start/stop, getLastSnapshot.
│   ├── cursor-agent.ts         # createCursorAgentInvoker(opts), validateCursorApiKey(). Invoker: spawn cursor-agent, NDJSON stream, tree-kill, session log.
│   ├── agent-runner.ts         # Lower-level spawn/stream/kill helpers used by cursor-agent invoker.
│   ├── stream-events.ts        # Parse NDJSON from cursor-agent; typed events; parseEvent returns null on bad line (no throw). discriminatedUnion on 'type'.
│   ├── session-log.ts          # Append session entries (ts, goal, phase, session_id, status).
│   ├── logger.ts               # initLogger(opts), createChildLogger(logger, component). Pino.
│   ├── state-parser.test.ts    # Vitest: parseStateMd/readStateMd cases (valid, missing section, malformed, progress variants).
│   └── stream-events.test.ts   # Vitest: NDJSON parsing, unknown types passthrough.
│
├── dist/                       # Compiled JS (from tsc). Do not edit; gitignore in practice or explicit.
│
├── .planning/                  # GSD project state (written by GSD / cursor-agent; read by orchestrator)
│   ├── PROJECT.md              # Vision, requirements, constraints, key decisions. Product/CEO reference.
│   ├── ROADMAP.md              # Phase list and status (1–7), phase details, progress table.
│   ├── STATE.md                # Current position (phase, plan, status, progress%), metrics, accumulated context, session continuity. Single source of truth for “where we are”.
│   ├── config.json             # GSD workflow config (optional).
│   ├── agent-history.json      # GSD/agent history (optional).
│   ├── phases/                 # One dir per phase: NN-name/
│   │   ├── 01-foundation-cli-scaffold/
│   │   │   ├── 01-01-PLAN.md, 01-01-SUMMARY.md, 01-02-*, 01-03-*   # Plan docs and completion summaries.
│   │   ├── 02-core-orchestration-loop/
│   │   │   └── 02-01-*, 02-02-*, 02-03-*
│   │   ├── 3-cursor-agent-integration/
│   │   │   └── 03-01-*, 03-02-*, 03-03-*, 3-RESEARCH.md
│   │   ├── 04-state-monitoring-phase-transitions/
│   │   │   └── 04-01-*, 04-02-*, 04-03-*
│   │   └── 5-crash-detection-recovery/
│   │       └── 5-CONTEXT.md    # Phase 5 context (no plans yet).
│   └── todos/
│       ├── pending/            # Deferred tasks (e.g. 2026-03-16-*.md).
│       └── (debug/ if used)
│
├── docs/
│   ├── ARCHITECTURE.md         # Module roles and data flow for contributors.
│   └── CONTEXT-FOR-MODEL.md    # This file: project brief for a smart model (assistant/CEO).
│
├── goals.md                    # Goal queue: ## Pending / ## In Progress / ## Done. Orchestrator reads Pending.
├── run.sh                      # Convenience: run daemon with --goals goals.md --verbose, log to logs/orchestrator.log (background).
├── session-log.jsonl           # Runtime: one line per session (ts, goal, phase, session_id, status). Used for crash recovery (Phase 5).
├── logs/                       # Optional log output (e.g. orchestrator.log).
│
├── package.json                # name: unsupervised-gsd, type: module, main/bin, scripts: build/start/dev/test, engines node>=18, deps (chokidar, commander, pino, tree-kill, zod), devDeps (typescript, vitest, @types/node).
├── tsconfig.json               # TypeScript compiler options (emit to dist/).
├── vitest.config.ts            # Vitest config.
├── .gitignore                  # node_modules/, dist/, *.tgz
├── .cursor/                    # Cursor IDE config (e.g. cli.json). Not required for headless runs.
└── README.md                   # User-facing: overview, install, usage, CLI options, goals format, config, project structure, roadmap.
```

### Metadata Summary

| Path / area | Purpose |
|-------------|---------|
| `bin/unsupervised-gsd` | Single CLI entry; delegates to compiled `dist/cli.js`. |
| `src/*.ts` | All app and test logic; ESM; tests next to or beside implementation. |
| `.planning/` | GSD state: PROJECT, ROADMAP, STATE, phases (PLAN/SUMMARY), todos. Authoritative for “what we’re building” and “where we are”. |
| `STATE.md` | Current position (phase, plan, status, progress); read by state-parser and StateWatcher; critical for Phase 5 resume. |
| `goals.md` | Input queue; section-based status; daemon processes Pending. |
| `session-log.jsonl` | Runtime session log; foundation for crash detection and resume. |
| `docs/` | ARCHITECTURE (contributors), CONTEXT-FOR-MODEL (this brief). |

---

## 5. Decisions and Conventions (Quick Reference)

- **Sequential by default**; parallel is opt-in and experimental.
- **GSD is a black box**: only commands and files; no modification of GSD rules.
- **StateWatcher optional**: if construction fails, daemon logs and continues.
- **reportProgress mismatch**: log warning only; do not fail the run.
- **Stub agent**: default in orchestrator when no invoker passed (tests, dry-run).
- **One invoker per daemon run**; one StateWatcher per goal.
- **Graceful shutdown**: first signal sets flag; second force-exits.
- **CURSOR_API_KEY**: required for live run; not required for `--dry-run`.
- **cursor-agent flags**: `-p --force --trust --approve-mcps --workspace <dir> --output-format stream-json`; `--workspace` mandatory.

---

## 6. How You (the Model) Can Act as Assistant and CEO

- **Assistant**: Use this doc + `README.md` + `docs/ARCHITECTURE.md` to answer “how does X work?”, “where is Y?”, “what’s the next step?”. Prefer `.planning/STATE.md` and `.planning/ROADMAP.md` for current position and roadmap; use `docs/CONTEXT-FOR-MODEL.md` for overall design and conventions.
- **CEO**: Use `.planning/PROJECT.md` for vision and constraints; ROADMAP for phases and status; STATE for progress and velocity. Suggest prioritization (e.g. Phase 5 before dashboard), flag risks (e.g. cursor-agent behavior changes), and keep “no stall, no lost state, recover automatically” as the north star. When proposing changes, respect “GSD as black box” and the existing lifecycle and interfaces.

---

*Document generated for model context. Last aligned with codebase and .planning: 2026-03-16.*
