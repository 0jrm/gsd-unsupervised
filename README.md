### gsd-unsupervised

Autonomous orchestrator that drives Cursor's headless agent through the full [GSD (Get Shit Done)](https://github.com/get-shit-done) lifecycle. It reads goals from a queue, invokes `cursor-agent` with GSD commands, monitors progress via `.planning/STATE.md`, and advances phases automatically. Built for reliable, hands-off goal-to-completion automation on a single machine.

## Features

- **Goal queue** — Define work in `goals.md`; the daemon processes pending goals sequentially or in parallel.
- **GSD lifecycle** — Runs `/gsd/new-project` → `/gsd/create-roadmap` → `/gsd/plan-phase` → `/gsd/execute-plan` in the correct order.
- **Cursor agent integration** — Spawns `cursor-agent` headlessly, streams commands, and handles process lifecycle (timeouts, tree-kill on shutdown).
- **State monitoring** — Watches `.planning/STATE.md` for phase/plan progress and emits events (phase_advanced, plan_advanced, phase_completed, goal_completed).
- **Crash detection & recovery** — Session log at project root, resume from exact phase/plan on next run, heartbeat for liveness.
- **Resource governor** — CPU + memory headroom checks before each agent call so the daemon backs off instead of thrashing your box.
- **Web dashboard** — Optional status server with HTML dashboard and `/api/status` JSON.

## Prerequisites

- **Node.js** ≥ 18
- **Cursor** with GSD rules installed (e.g. in `.cursor/rules/`)
- **cursor-agent** CLI (path configurable; default `agent`)
- **CURSOR_API_KEY** — Required for live runs. Get from Cursor Dashboard → Cloud Agents → User API Keys. Not required for `--dry-run`.

## Install

```bash
git clone <repo-url>
cd gsd-unsupervised
npm install
npm run build
```

### WSL Bootstrap (one command)

On WSL2, from the project root:

```bash
bash setup.sh              # Detect WSL2, sync GSD rules from Windows .cursor into repo
bash setup.sh --dry-run     # Show what would be done (no changes)
bash setup.sh --validate    # Bootstrap + validation checks + orchestrator smoke test
```

**Prerequisites:** WSL2, Cursor installed on Windows with GSD rules in `.cursor/rules`, and (for `--validate`) Node.js ≥18 and npm. A successful run creates or updates `.cursor/rules` in the repo and (with `--validate`) runs the test suite. Re-runs are idempotent.

## Usage

### Quick start

```bash
# Preview the goal queue (no API key needed)
./bin/gsd-unsupervised --dry-run --goals goals.md

# Run the daemon (requires CURSOR_API_KEY)
export CURSOR_API_KEY=your_key_here
./bin/gsd-unsupervised --goals goals.md --verbose
```

### CLI options

| Option | Default | Description |
|--------|---------|-------------|
| `--goals <path>` | `./goals.md` | Path to the goals queue file |
| `--config <path>` | `./.autopilot/config.json` | Config file (optional) |
| `--parallel` | `false` | Enable parallel project execution |
| `--max-concurrent <n>` | `3` | Max concurrent goals when `--parallel` |
| `--verbose` | `false` | Debug logging and pretty output |
| `--dry-run` | `false` | Parse goals and show plan only; no agent calls |
| `--agent <name>` | `cursor` | Agent type: `cursor`, `claude-code`, `gemini-cli`, `codex`. Invalid names fail fast. |
| `--agent-path <path>` | `agent` | Path to cursor-agent binary |
| `--agent-timeout <ms>` | `600000` | Agent invocation timeout (ms) |
| `--status-server <port>` | — | Enable HTTP status server (GET / or /status returns JSON) |

### Agent selection (`--agent`)

The `--agent` flag selects which AI coding agent the orchestrator invokes. Supported values: `cursor` (default), `claude-code`, `gemini-cli`, `codex`. Invalid names fail fast at startup and do not start the daemon. Omitting the flag or using `--agent=cursor` yields identical behavior to the original Cursor-only implementation (backward compatible). Non-Cursor agents are currently stub placeholders (TODO).

### Goals file (`goals.md`)

Use sections **Pending**, **In Progress**, and **Done**. List goals as markdown checkboxes under the right section. The orchestrator processes items in **Pending** and moves them to **In Progress** / **Done** as it runs.

Example:

```markdown
## Pending
- [ ] Complete Phase 5: Crash Detection & Recovery
- [ ] Complete Phase 6: Web Dashboard

## In Progress
<!-- moved here while running -->

## Done
<!-- completed goals -->
```

## Configuration

Config can come from a JSON file (`--config`) and is overridden by CLI options. All fields are optional.

| Field | Default | Description |
|-------|---------|-------------|
| `goalsPath` | `"./goals.md"` | Goals file path |
| `parallel` | `false` | Parallel mode |
| `maxConcurrent` | `3` | Max concurrent goals (1–10) |
| `verbose` | `false` | Verbose logging |
| `logLevel` | `"info"` | `debug` \| `info` \| `warn` \| `error` |
| `workspaceRoot` | `process.cwd()` | Project root (for `.planning/`, etc.) |
| `agent` | `"cursor"` | Agent type: `cursor`, `claude-code`, `gemini-cli`, `codex` |
| `cursorAgentPath` | `"cursor-agent"` | cursor-agent binary path |
| `agentTimeoutMs` | `600000` | Agent timeout (≥ 10000) |
| `sessionLogPath` | `"./session-log.jsonl"` | Session log file |
| `stateWatchDebounceMs` | `500` | STATE.md watcher debounce (≥ 100) |
| `requireCleanGitBeforePlan` | `true` | Refuse execute-plan when git working tree is dirty |
| `autoCheckpoint` | `false` | When true and tree dirty, create a checkpoint commit before plan |
| `statusServerPort` | — | When set, start HTTP status server on this port |

Example `.autopilot/config.json`:

```json
{
  "goalsPath": "./goals.md",
  "verbose": true,
  "stateWatchDebounceMs": 500
}
```

## Project structure

```
├── bin/gsd-unsupervised     # CLI entry (Node)
├── src/
│   ├── cli.ts            # Commander setup, dry-run, daemon entry
│   ├── config.ts         # Zod config schema and loader
│   ├── daemon.ts         # Goal loop, StateWatcher per goal
│   ├── orchestrator.ts   # GSD state machine, agent invoker, reportProgress
│   ├── lifecycle.ts     # Goal phases and command sequence
│   ├── goals.ts         # goals.md parser
│   ├── roadmap-parser.ts # ROADMAP.md / phase / plan discovery
│   ├── state-parser.ts   # STATE.md "Current Position" parser
│   ├── state-watcher.ts  # Chokidar watcher, progress events
│   ├── cursor-agent.ts   # cursor-agent invoker, API key validation
│   ├── logger.ts        # Pino logger init
│   └── ...
├── .planning/            # GSD project state (STATE.md, ROADMAP.md, phases/)
├── goals.md              # Goal queue
└── package.json
```

See `docs/ARCHITECTURE.md` for module roles and data flow.

## Crash detection and recovery

The daemon appends one JSON line per agent run to **session-log.jsonl** at the project root (config `sessionLogPath`, default `./session-log.jsonl`). Each entry includes `goalTitle`, `phaseNumber`, `planNumber`, and `status` (`running` | `done` | `crashed` | `timeout`). On startup, if the last entry is `running` or `crashed` and the first pending goal matches, the daemon computes a resume point from STATE.md (or the log) and passes it to the orchestrator, which re-runs only that plan then continues.

**Example session-log.jsonl (2 lines):**

```jsonl
{"timestamp":"2026-03-17T12:00:00.000Z","goalTitle":"Complete Phase 5","phase":"/gsd/execute-plan","phaseNumber":2,"planNumber":1,"sessionId":null,"command":"/gsd/execute-plan .planning/phases/02-x/02-01-PLAN.md","status":"running"}
{"timestamp":"2026-03-17T12:05:00.000Z","goalTitle":"Complete Phase 5","phase":"/gsd/execute-plan","phaseNumber":2,"planNumber":1,"sessionId":"abc","command":"/gsd/execute-plan .planning/phases/02-x/02-01-PLAN.md","status":"crashed","durationMs":300000,"error":"Agent exited with code 1"}
```

**Corresponding STATE.md Current Position (when crash occurred):**

```markdown
## Current Position
Phase: 2 of 7 (Core Orchestration Loop)
Plan: 1 of 3 in current phase
Status: Executing plan
Last activity: 2026-03-17 — Running 02-01-PLAN.md
Progress: ██░░░░░░░░ 14%
```

Resume uses this to re-run `execute-plan` for phase 2 plan 1 only, then continue.

- **requireCleanGitBeforePlan** (default `true`): the orchestrator refuses to run `execute-plan` when the git working tree has uncommitted changes, unless **autoCheckpoint** is `true`, in which case it creates a checkpoint commit first.
- **How to recover manually:** (1) Inspect `session-log.jsonl` (last line = last run; `status` `crashed` or `running`). (2) Read `.planning/STATE.md` for "Current Position" (phase/plan). (3) Either run the daemon again with the same goal so it resumes automatically, or run `/gsd/execute-plan .planning/phases/<phase-dir>/<phase>-<plan>-PLAN.md` for the failed plan.

**Status server and dashboard:** Use `--status-server <port>` to enable the HTTP status server (e.g. `./bin/gsd-unsupervised --goals goals.md --status-server 3000`). The daemon starts the server before the goal loop and closes it on shutdown. `GET /` serves the HTML dashboard; `GET /status` returns legacy JSON; `GET /api/status` returns rich JSON including `stateSnapshot`, session log window, git feed, and `systemLoad`. `GET /api/config` and `POST /api/config` expose and update `.planning/config.json` (used for the sequential/parallel toggle).

## Development

```bash
npm run build    # Compile TypeScript
npm test         # Run tests (Vitest)
npm run dev      # Watch build
```

Tests include state parser, stream events, lifecycle, session-log, roadmap-parser, status-server, and resume integration. Run with `npm test` or `npm test -- state-parser`. Integration tests (crash/resume): `npm run test:integration`.

## License

MIT
