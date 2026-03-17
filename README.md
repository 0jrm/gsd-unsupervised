# GSD Autopilot

Autonomous orchestrator that drives Cursor's headless agent through the full [GSD (Get Shit Done)](https://github.com/get-shit-done) lifecycle. It reads goals from a queue, invokes `cursor-agent` with GSD commands, monitors progress via `.planning/STATE.md`, and advances phases automatically. Built for reliable, hands-off goal-to-completion automation.

## Features

- **Goal queue** — Define work in `goals.md`; the daemon processes pending goals sequentially (or in parallel with `--parallel`).
- **GSD lifecycle** — Runs `/gsd/new-project` → `/gsd/create-roadmap` → `/gsd/plan-phase` → `/gsd/execute-plan` (and related commands) in the correct order.
- **Cursor agent integration** — Spawns `cursor-agent` headlessly, streams commands, and handles process lifecycle (timeouts, tree-kill on shutdown).
- **State monitoring** — Watches `.planning/STATE.md` for phase/plan progress and emits events (phase_advanced, plan_advanced, phase_completed, goal_completed).
- **Planned** — Crash detection & recovery, web dashboard, WSL bootstrap (see [Roadmap](#roadmap)).

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
./bin/gsd-autopilot --dry-run --goals goals.md

# Run the daemon (requires CURSOR_API_KEY)
export CURSOR_API_KEY=your_key_here
./bin/gsd-autopilot --goals goals.md --verbose
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
| `--agent-path <path>` | `agent` | Path to cursor-agent binary |
| `--agent-timeout <ms>` | `600000` | Agent invocation timeout (ms) |

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
| `cursorAgentPath` | `"cursor-agent"` | cursor-agent binary path |
| `agentTimeoutMs` | `600000` | Agent timeout (≥ 10000) |
| `sessionLogPath` | `"./session-log.jsonl"` | Session log file |
| `stateWatchDebounceMs` | `500` | STATE.md watcher debounce (≥ 100) |

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
├── bin/gsd-autopilot     # CLI entry (Node)
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

## Development

```bash
npm run build    # Compile TypeScript
npm test         # Run tests (Vitest)
npm run dev      # Watch build
```

Tests include state parser, stream events, and lifecycle; run with `npm test` or `npm test -- state-parser`.

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1. Foundation & CLI | ✅ | Project setup, CLI, config, goals parser |
| 2. Orchestration loop | ✅ | Sequential goals, GSD command order, lifecycle state machine |
| 3. Cursor agent | ✅ | Headless cursor-agent, streaming, process lifecycle |
| 4. State monitoring | ✅ | STATE.md watcher, progress events, daemon wiring |
| 5. Crash detection | 🔲 | Detect dead agent, resume from STATE.md |
| 6. Web dashboard | 🔲 | Live status, progress, git feed at localhost:3000 |
| 7. WSL bootstrap | 🔲 | setup.sh, GSD rules copy, one-command install |

Detailed plans live in `.planning/ROADMAP.md` and `.planning/phases/`.

## License

MIT
