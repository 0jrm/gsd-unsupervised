# GSD Autopilot

Autonomous orchestrator that drives Cursor's headless agent through the full [GSD (Get Shit Done)](https://github.com/get-shit-done) lifecycle. It reads goals from a queue, invokes `cursor-agent` with GSD commands, monitors progress via `.planning/STATE.md`, and advances phases automatically. Built for reliable, hands-off goal-to-completion automation.

## Features

- **Goal queue** — Define work in `goals.md`; the daemon processes pending goals sequentially (or in parallel with `--parallel`).
- **GSD lifecycle** — Runs `/gsd/new-project` → `/gsd/create-roadmap` → `/gsd/plan-phase` → `/gsd/execute-plan` (and related commands) in the correct order.
- **Cursor agent integration** — Spawns `cursor-agent` headlessly, streams commands, and handles process lifecycle (timeouts, tree-kill on shutdown).
- **State monitoring** — Watches `.planning/STATE.md` for phase/plan progress and emits events (phase_advanced, plan_advanced, phase_completed, goal_completed).
- **Crash detection & recovery** — Session log at project root, resume from exact phase/plan on next run, heartbeat for liveness (see [Crash detection and recovery](#crash-detection-and-recovery)).
- **Planned** — Web dashboard, WSL bootstrap (see [Roadmap](#roadmap)).

## Prerequisites

- **Node.js** ≥ 18
- **Cursor** with GSD rules installed (e.g. in `.cursor/rules/`)
- **cursor-agent** CLI (path configurable; default `agent`)
- **CURSOR_API_KEY** — Required for live runs. Get from Cursor Dashboard → Cloud Agents → User API Keys. Not required for `--dry-run`.

## Install

```bash
git clone <repo-url>
cd gsd-cli-test
npm install
npm run build
```

## Usage

### Quick start

```bash
# Preview the goal queue (no API key needed)
./bin/unsupervised-gsd --dry-run --goals goals.md

# Run the daemon (requires CURSOR_API_KEY)
export CURSOR_API_KEY=your_key_here
./bin/unsupervised-gsd --goals goals.md --verbose
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
├── bin/unsupervised-gsd     # CLI entry (Node)
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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module roles and data flow.

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

**Status server and dashboard:** Use `--status-server <port>` to enable the HTTP status server (e.g. `./bin/unsupervised-gsd --goals goals.md --status-server 3000`). The daemon starts the server before the goal loop and closes it on shutdown (SIGINT/SIGTERM). **GET /** — web dashboard (HTML): current agent, status, goal card with phase/plan progress, recent commits, token/cost summary; auto-refreshes every 10s from the JSON API. **GET /status** — legacy JSON `{ running, currentGoal?, phaseNumber?, planNumber?, heartbeat? }`. **GET /api/status** — dashboard JSON with same fields plus `currentAgentId`, `stateSnapshot`, `sessionLogEntries`, `gitFeed`, and placeholder `tokens`/`cost`. Open `http://localhost:PORT/` in a browser (on the WSL host or from another device on the same network via the machine’s IP). The dashboard includes an **execution mode** toggle (sequential/parallel); it updates `.planning/config.json` and takes effect on the next daemon run (or at startup if you start the daemon after toggling). **GET /api/config** and **POST /api/config** expose and update that config when the status server is started with dashboard options. **Heartbeat:** While the agent runs, `.planning/heartbeat.txt` is updated every 15s; if it’s missing or older than 60s with a `running` session, the next startup treats it as a crash and can resume.

## Development

```bash
npm run build    # Compile TypeScript
npm test         # Run tests (Vitest)
npm run dev      # Watch build
```

Tests include state parser, stream events, lifecycle, session-log, roadmap-parser, status-server, and resume integration. Run with `npm test` or `npm test -- state-parser`. Integration tests (crash/resume): `npm run test:integration`.

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1. Foundation & CLI | ✅ | Project setup, CLI, config, goals parser |
| 2. Orchestration loop | ✅ | Sequential goals, GSD command order, lifecycle state machine |
| 3. Cursor agent | ✅ | Headless cursor-agent, streaming, process lifecycle |
| 4. State monitoring | ✅ | STATE.md watcher, progress events, daemon wiring |
| 5. Crash detection | ✅ | Session log, resume from phase/plan, heartbeat, clean git, status server |
| 6. Web dashboard | 🔲 | Live status, progress, git feed at localhost:3000 |
| 7. WSL bootstrap | 🔲 | setup.sh, GSD rules copy, one-command install |

Detailed plans live in `.planning/ROADMAP.md` and `.planning/phases/`.

## License

MIT
