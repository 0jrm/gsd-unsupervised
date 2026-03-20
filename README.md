### gsd-unsupervised

Autonomous orchestrator that drives headless agents through the full [GSD (Get Shit Done)](https://github.com/get-shit-done) lifecycle. It reads goals from a queue, invokes the selected agent (`cursor`, `cn`, or `codex`) with GSD commands, monitors progress via `.planning/STATE.md`, and advances phases automatically. Built for reliable, hands-off goal-to-completion automation on a single machine.

## Features

- **Goal queue** — Define work in `goals.md`; the daemon processes pending goals sequentially or in parallel.
- **GSD lifecycle** — Runs `/gsd/new-project` → `/gsd/create-roadmap` → `/gsd/plan-phase` → `/gsd/execute-plan` in the correct order.
- **Agent runtime integration** — Supports Cursor (`cursor-agent`), Continue CLI (`cn`), and Codex CLI (`codex`) with heartbeat + session-log lifecycle handling.
- **State monitoring** — Watches `.planning/STATE.md` for phase/plan progress and emits events (phase_advanced, plan_advanced, phase_completed, goal_completed).
- **Crash detection & recovery** — Session log at project root, resume from exact phase/plan on next run, heartbeat for liveness.
- **Resource governor** — CPU + memory headroom checks before each agent call so the daemon backs off instead of thrashing your box.
- **Local status dashboard** — Optional HTTP server (`--status-server <port>`) serving an HTML dashboard and `/api/status` JSON. Use `--ngrok` to have the daemon run `ngrok http <port>` so the dashboard is reachable via a public URL while the process runs. The dashboard is most useful during long-running agent execution; if a goal completes quickly or before the server is up, the dashboard may be empty.
- **Optional SMS (Twilio)** — Notifications for goal complete, goal failed, and daemon paused; requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_TO`. If unset, the daemon runs without SMS (no warnings or errors).

## Requirements

Node ≥ 18, tmux, and one runtime (`cursor`, `cn`, or `codex`) for live execution. (`claude-code` and `gemini-cli` currently map to stubs.)

## Prerequisites

- **Node.js** ≥ 18
- **GSD rules installed** for your chosen runtime (typically under `.cursor/rules/`)
- **One live agent runtime configured**:
  - `cursor`: `cursor-agent` binary + `CURSOR_API_KEY`
  - `cn`: `cn` binary + `CONTINUE_API_KEY`
  - `codex`: `codex` binary + `OPENAI_API_KEY`
- **Important:** The `run` script sources `.env` from the **workspace** where you run `./run`. Put credentials in that workspace `.env` (not in another repo).

### Using cn (Continue CLI)

You can use [Continue's headless CLI](https://docs.continue.dev/guides/cli) (`cn`) instead of Cursor as the agent:

1. **Install cn**: `npm install -g @continuedev/cli` or `curl -fsSL https://raw.githubusercontent.com/continuedev/continue/main/extensions/cli/scripts/install.sh | bash`.
2. **Config**: Fill in the `models` section in `.continue/config.yaml` (at project root). The file references GSD rules from `.cursor/rules/`; add your model (e.g. Anthropic, OpenAI) per [Continue config reference](https://docs.continue.dev/reference).
3. **Set agent**: `--agent cn` or `"agent": "cn"` in `.planning/config.json`.
4. **CONTINUE_API_KEY**: Required for CI/headless use. Get from [continue.dev/settings/api-keys](https://continue.dev/settings/api-keys).
5. **Binary path**: Use `GSD_CN_BIN` env or `continueCliPath` in config if `cn` is not on PATH.

cn outputs plain text (not NDJSON). GSD rules load from `.continue/config.yaml`, which references `.cursor/rules/`.

### Using codex (Codex CLI)

You can use Codex CLI as the agent runtime:

1. **Install codex CLI** and ensure `codex` is on PATH (or set binary path via config/env).
2. **Set agent**: `--agent codex` or `"agent": "codex"` in `.planning/config.json`.
3. **OPENAI_API_KEY**: Required for unattended Codex runs.
4. **Binary path override**: Use `GSD_CODEX_BIN` env or `codexCliPath` in config.

### WSL Support & Paths

This project is WSL-aware and includes helpers and a diagnostics script for path resolution when running under WSL2:

- **WSL detection** lives in `src/config/wsl.ts`, which can answer whether the current process is running under WSL and convert `/mnt/<drive>/...` paths to Windows-style `X:\...` paths.
- **Centralized path resolution** is provided by `src/config/paths.ts`:
  - `getCursorBinaryPath` prefers `GSD_CURSOR_BIN`, then `cursorAgentPath`, then `cursor-agent` (with `/mnt/*` → Windows path mapping when possible).
  - `getCnBinaryPath` prefers `GSD_CN_BIN`, then `continueCliPath`, then `cn`.
  - `getCodexBinaryPath` prefers `GSD_CODEX_BIN`, then `codexCliPath`, then `codex`.
  - `getClipExePath` returns `GSD_CLIP_EXE` when set; under WSL it otherwise returns `C:\Windows\System32\clip.exe`; outside WSL it returns `null`.
  - `getWorkspaceDisplayPath` exposes both the WSL path and, when possible, a corresponding Windows path for the workspace root.
- **WSL bootstrap** in `src/bootstrap/wsl-bootstrap.ts` wires these helpers together and is invoked from the CLI startup so the daemon has a single place to understand the current environment.
- **Diagnostics script** at `scripts/bootstrap-wsl.sh` runs a focused WSL environment check from your shell and prints suggested values for `GSD_CURSOR_BIN` and `GSD_CLIP_EXE`.

When `clip.exe` cannot be resolved (for example, on non-WSL Linux), clipboard integration should be treated as optional by higher-level tooling: consumers should check for `null` and simply skip clipboard-related features instead of failing daemon startup. The diagnostics script helps you see exactly what the project can and cannot infer about your environment.

## Quick Start

```bash
# 1. Install
npm install -g gsd-unsupervised
# or clone and use locally:
git clone https://github.com/0jrm/gsd-unsupervised && cd gsd-unsupervised && npm install

# 2. Initialize in your project
cd your-project
./setup.sh   # runs npm install, copies run script, builds
# or non-interactively:
npx gsd-unsupervised init --agent cursor --goals ./goals.md

# 2b. Put agent credentials in this project's .env (example for cursor)
echo "CURSOR_API_KEY=your_key" >> .env
# For cn use CONTINUE_API_KEY; for codex use OPENAI_API_KEY.

# 3. Add a goal
echo "- [ ] Add dark mode to the dashboard" >> goals.md

# 4. Start the daemon
./run
# Attach to watch: tmux attach -t gsd-self
```

That's it. The daemon will read goals.md, invoke your agent, and SMS you when done (if Twilio is configured).

## Install

From npm (recommended):

```bash
npm install -g gsd-unsupervised
```

From source:

```bash
git clone https://github.com/0jrm/gsd-unsupervised
cd gsd-unsupervised
npm install
npm run build
```

### WSL Bootstrap & Diagnostics

On WSL2, from the project root you can run a quick diagnostics pass:

```bash
bash scripts/bootstrap-wsl.sh
```

This script:

- Detects WSL.
- Shows your workspace path in both WSL and Windows form when possible.
- Reports current and suggested values for `GSD_CURSOR_BIN` and `GSD_CLIP_EXE`.
- Exits non-zero when it detects WSL but cannot infer a reliable Windows mapping for the workspace, so you can catch misconfigurations early.

For a deeper explanation of how WSL detection and path resolution work (and more examples of environment variable configuration), see `docs/wsl-bootstrap.md`.

## Usage

### Two modes

- **SELF** — Daemon improves this repo (`gsd-unsupervised`). Workspace and goals live here; state in `.gsd/state.json`.
- **PROJECT** — Daemon works on another repo. You run `npx gsd-unsupervised init` in that repo; state and goals live under that repo’s `.gsd/`.

### First-time setup (any repo)

```bash
./setup.sh
# or non-interactively:
npx gsd-unsupervised init --agent cursor --goals ./goals.md
```

`setup.sh` asks: agent type, goals path, status port, optional Twilio. It runs `npm install`, builds, copies the `run` script, and writes `.gsd/state.json` and `goals.md`. Then start with `./run`. Ensure `CURSOR_API_KEY` is in the workspace's `.env` before running.

### Recommended (dashboard + public URL)

From the project root you can use the **`run`** script (reads `.gsd/state.json`, loads `.env`, starts daemon + optional ngrok + tmux):

```bash
./run
```

If not yet initialized, run `./setup.sh` or `npx gsd-unsupervised init` first.

Or run the daemon explicitly with the status server and ngrok:

```bash
export CURSOR_API_KEY=your_key_here
./bin/gsd-unsupervised --goals goals.md --status-server 4173 --ngrok --verbose
```

Extra args are passed through (e.g. `./run --parallel`).

- **Status server** on port `4173`: open `http://localhost:4173` for the HTML dashboard.
- **ngrok** runs `ngrok http 4173` for the same process; the public URL appears in the terminal. When the daemon exits, ngrok is stopped.

Requires [ngrok](https://ngrok.com/) on your PATH and an ngrok authtoken (e.g. `ngrok config add-authtoken <token>`). Set `CURSOR_API_KEY` in the workspace's `.env` (the project where you run `./run`).

### Other ways to run

```bash
# Preview the goal queue (no API key needed)
./bin/gsd-unsupervised --dry-run --goals goals.md

# Run without dashboard
./bin/gsd-unsupervised --goals goals.md --verbose

# Dashboard only (no ngrok, localhost only)
./bin/gsd-unsupervised --goals goals.md --status-server 4173 --verbose
```

### Operational commands

```bash
# Run from .gsd/state.json (used by ./run)
gsd-unsupervised run [--state ./.gsd/state.json]

# Clear daemon pause flag (.pause-autopilot)
gsd-unsupervised unpause [--state ./.gsd/state.json]

# Validate local agent setup; optional live smoke test
gsd-unsupervised validate-agent --agent codex --network
```

### CLI options (default command)

| Option | Default | Description |
|--------|---------|-------------|
| `--goals <path>` | `./goals.md` | Path to the goals queue file |
| `--config <path>` | `./.autopilot/config.json` | Config file (optional) |
| `--parallel` | `false` | Enable parallel project execution |
| `--max-concurrent <n>` | `3` | Max concurrent goals when `--parallel` |
| `--verbose` | `false` | Debug logging and pretty output |
| `--dry-run` | `false` | Parse goals and show plan only; no agent calls |
| `--agent <name>` | `cursor` | Agent type: `cursor`, `cn`, `claude-code`, `gemini-cli`, `codex`. Invalid names fail fast. |
| `--agent-path <path>` | `agent` | Path to cursor-agent binary |
| `--agent-timeout <ms>` | `600000` | Agent invocation timeout (ms) |
| `--status-server <port>` | — | Enable local HTTP status server: GET / = dashboard HTML, GET /status or /api/status = JSON |
| `--ngrok` | `false` | Start `ngrok http <port>` when status server is enabled; tunnel and process share the same lifecycle |
| `--ignore-planning-config` | `false` | Ignore `.planning/config.json` runtime overrides |

### Agent selection (`--agent`)

| Agent | Status | Notes |
|-------|--------|-------|
| `cursor` | Supported | Default. CURSOR_API_KEY required. |
| `cn` | Supported | Continue CLI. `npm install -g @continuedev/cli`, set CONTINUE_API_KEY. |
| `codex` | Supported | Codex CLI via `codex exec`; set OPENAI_API_KEY for unattended runs. |
| `claude-code` | Stub | Coming soon. |
| `gemini-cli` | Stub | Coming soon. |

Invalid names fail fast at startup.

### Goals file (`goals.md`)

Use sections **Pending**, **In Progress**, and **Done**. List goals as markdown checkboxes under the right section. The orchestrator processes items in **Pending** and moves them to **In Progress** / **Done** as it runs.

Example:

```markdown
## Pending
- [ ] Your next goal

## In Progress
<!-- moved here while running -->

## Done
<!-- completed goals -->
```

All roadmap phases (1–7) are implemented: Foundation, Lifecycle, Agent Integration, State Monitoring, Crash Detection & Recovery, Status Server, WSL Bootstrap. Use `goals.md` for new work items.

## Configuration

Config can come from a JSON file (`--config`) and is overridden by CLI options. All fields are optional.

| Field | Default | Description |
|-------|---------|-------------|
| `goalsPath` | `"./goals.md"` | Goals file path |
| `parallel` | `false` | Parallel mode |
| `maxConcurrent` | `3` | Max concurrent goals (1–10) |
| `maxCpuFraction` | `0.8` | CPU headroom guard (fraction of total capacity) |
| `maxMemoryFraction` | `0.8` | Memory headroom guard (fraction of total memory) |
| `maxGpuFraction` | — | Optional GPU headroom guard (0.1–1.0) when GPU metrics are available |
| `verbose` | `false` | Verbose logging |
| `logLevel` | `"info"` | `debug` \| `info` \| `warn` \| `error` |
| `workspaceRoot` | `process.cwd()` | Project root (for `.planning/`, etc.) |
| `agent` | `"cursor"` | Agent type: `cursor`, `cn`, `claude-code`, `gemini-cli`, `codex` |
| `cursorAgentPath` | `"cursor-agent"` | cursor-agent binary path |
| `continueCliPath` | `"cn"` | cn (Continue CLI) binary path; used when `agent` is `cn` |
| `codexCliPath` | `"codex"` | codex binary path; used when `agent` is `codex` |
| `agentTimeoutMs` | `600000` | Agent timeout (≥ 10000) |
| `sessionLogPath` | `"./session-log.jsonl"` | Session log file |
| `stateWatchDebounceMs` | `500` | STATE.md watcher debounce (≥ 100) |
| `requireCleanGitBeforePlan` | `true` | Refuse execute-plan when git working tree is dirty |
| `autoCheckpoint` | `false` | When true and tree dirty, create a checkpoint commit before plan |
| `statusServerPort` | — | When set, start local HTTP status server on this port (dashboard + /api/status) |
| `ngrok` | `false` | When true and status server is enabled, run `ngrok http <port>` for the process lifetime |
| `statePath` | — | Path to `.gsd/state.json` for daemon heartbeat/progress writes |
| `goalsReloadDebounceMs` | `500` | Debounce for goals hot-reload watcher (`0` disables debounce) |
| `retryPolicy` | `{ maxAttempts: 3, backoffMs: [5000, 30000, 120000], nonRetryableExitCodes: [1, 127] }` | Retry policy used by cursor-agent runtime |
| `verifyCommand` | — | Optional command to run after each successful `/gsd/execute-plan` (for example `npm test`) |
| `verifyTimeoutMs` | `120000` | Timeout for `verifyCommand` |
| `autoFixOnVerifyFail` | `false` | Queue a fix goal when verify fails |

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

The daemon appends one JSON line per agent run to **session-log.jsonl** at the project root (config `sessionLogPath`, default `./session-log.jsonl`). Each entry includes `goalTitle`, `phaseNumber`, `planNumber`, and `status` (`running` | `done` | `crashed` | `timeout` | `verify-failed` | `skipped`). On startup, if the last entry is `running` or `crashed` and the first pending goal matches, the daemon computes a resume point from STATE.md (or the log) and passes it to the orchestrator, which re-runs only that plan then continues.

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

- **Strict execution truth:** Plan completion is derived from session-log terminal outcomes, not `*-SUMMARY.md` file presence. Invalid plan files (`skipped`) and verify failures (`verify-failed`) fail the goal.

- **Pause behavior:** After three failed attempts for the same goal, the daemon writes `.pause-autopilot` and sleeps until unpaused. Use `gsd-unsupervised unpause` (or remove the flag file manually).

**Status server and dashboard:** Use `--status-server <port>` to enable the local HTTP status server (e.g. `./bin/gsd-unsupervised --goals goals.md --status-server 4173`). Add `--ngrok` to have the daemon run `ngrok http <port>` for the same lifecycle: the public URL appears in ngrok’s output and the tunnel is closed when the daemon exits. `GET /` serves the HTML dashboard; `GET /status` returns legacy JSON; `GET /api/status` returns rich JSON including `stateSnapshot`, session log window, git feed, `systemLoad`, `paused`, and `pauseFlagPath`. `GET /api/config` and `POST /api/config` expose and update `.planning/config.json` (used for the sequential/parallel toggle). When exposing the dashboard publicly (e.g. via ngrok), set `GSD_DASHBOARD_TOKEN` so that adding goals requires `Authorization: Bearer <token>`.

**Hot-reload and webhook:** The daemon watches `goals.md` and merges new pending goals into the queue when the file changes. With the status server running: **POST /api/goals** (JSON `{ "title": "...", "priority": 1 }`) appends to goals and enqueues; **POST /api/todos** (JSON `{ "title": "...", "area": "api" }`) creates `.planning/todos/pending/`; **POST /webhook/twilio** accepts inbound SMS (e.g. `add <goal>` or `todo <task>`) and replies with TwiML. Point your Twilio number webhook at `<ngrok-url>/webhook/twilio`.

**Parallel goal pool:** With `--parallel`, a worker pool of size `--max-concurrent` is used; a per-workspace mutex keeps one goal running at a time for a single workspace (phase-level parallel inside execute-phase still applies).

**SMS (Twilio):** Optional. Three message types: goal started `[gsd] Started: …`, goal complete, goal crashed `[gsd] Crashed: …`. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, and `TWILIO_TO` in `.env`. `setup.sh` prompts for Twilio credentials when you answer `y` to SMS notifications. If Twilio vars are unset, the daemon skips SMS silently (no warnings). To verify delivery, run `npx gsd-unsupervised test-sms`.

**State and heartbeat:** When started via `./run` or `gsd-unsupervised run --state .gsd/state.json`, the daemon writes to `.gsd/state.json` (PID, current goal, progress, `lastHeartbeat`). You can use `lastHeartbeat` in an external cron or script to send a periodic "alive" SMS (e.g. every 30 min) or alert if the heartbeat is stale (e.g. >10 min).

## Development

```bash
npm run build    # Compile TypeScript
npm test         # Run tests (Vitest)
npm run dev      # Watch build
```

Tests include state parser, stream events, lifecycle, session-log, roadmap-parser, status-server, and resume integration. Run with `npm test` or `npm test -- state-parser`. Integration tests (crash/resume): `npm run test:integration`.

## License

MIT
