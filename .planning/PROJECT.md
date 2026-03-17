# GSD Autopilot

## What This Is

A local automation orchestrator that drives Cursor's headless agent through the full GSD lifecycle — from goal intake to shipped code — with zero manual intervention. It reads goals from a queue, triggers `cursor-agent` with GSD commands, monitors progress via `.planning/STATE.md`, recovers from crashes, and advances phases automatically. A mobile-friendly web dashboard provides real-time visibility, and a WSL bootstrap script makes the whole stack one-command installable.

## Core Value

The orchestrator loop must never stall, never lose state, and recover from crashes automatically — reliable hands-off goal-to-completion automation is the entire value proposition.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] CLI daemon reads `goals.md` queue and processes goals sequentially by default
- [ ] `--parallel` flag enables up to 3 concurrent project executions
- [ ] Orchestrator triggers `cursor-agent` headlessly with GSD commands in order: `/gsd/new-project` → `/gsd/create-roadmap` → `/gsd/plan-phase` → `/gsd/execute-plan`
- [ ] Monitors `.planning/STATE.md` for progress and phase transitions
- [ ] Crash detection: if `cursor-agent` dies mid-phase, orchestrator detects it, reads STATE.md for last known position, and resumes from exactly that point
- [ ] No lost work, no manual intervention on failure
- [ ] Mobile-friendly web dashboard at localhost:3000 with live agent status, current phase, progress bars per project, recent STATE.md updates, git commit feed, and cost/token tracking
- [ ] Dashboard auto-refreshes every 10 seconds, accessible via local network from phone
- [ ] Dashboard toggle for sequential/parallel mode
- [ ] WSL setup script (`setup.sh`) that detects WSL, resolves Windows `.cursor` path (`/mnt/c/Users/$USER/.cursor`), copies GSD rules, and validates the install
- [ ] One-command bootstrap: `./setup.sh` gets the full stack running

### Out of Scope

- Multi-machine / remote orchestration — v1 is local-only
- Authentication / multi-user — dashboard is local, no login
- Cost optimization / billing integration — token tracking is display-only, no budget enforcement
- Cloud sync — everything stays on local filesystem
- Push notifications to phone — dashboard is pull-only (auto-refresh)
- LLM model selection — uses Cursor account defaults
- Project templates — goals.md is plain text, user writes the goal
- Rollback / undo — git history is the safety net
- Forking or modifying GSD internals — orchestrator treats GSD as a black box

## Context

- Runs on WSL2 on Windows — not native Linux, not macOS
- Cursor's headless `cursor-agent` CLI is the execution engine
- GSD framework rules are already installed in `.cursor/rules/` — orchestrator drives them via commands, never modifies them
- GSD's own `/gsd/execute-phase` already parallelizes plans internally, so parallelism exists at two levels: across projects (orchestrator) and within projects (GSD)
- Collaborating with Claude researcher agent for hard design problems and key architecture decisions
- Interactive workflow for phase planning, YOLO mode for execution

## Constraints

- **Runtime**: Must run on WSL2 specifically — the `.cursor` path resolution, file watching, and process management all target WSL2-on-Windows
- **No build step**: Dashboard is plain HTML/CSS/JS served by Express — no React, no Vite, no webpack
- **Execution engine**: Must use `cursor-agent` CLI (headless Cursor agent), not Cursor IDE
- **GSD as black box**: Uses GSD rules as-is from `.cursor/rules/` — no forking or modifying GSD internals in v1
- **Stack**: Node.js, Express, chokidar (file watching), simple-git (commit feed), plain HTML/CSS dashboard

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Sequential-by-default with `--parallel` opt-in | Safe, predictable, easy to monitor; parallel is experimental | — Pending |
| Orchestrator treats GSD as black box | Avoids coupling to GSD internals; clean separation of lifecycle management vs code generation | — Pending |
| Plain HTML/CSS dashboard, no framework | Zero build step, instant load, no dependency churn | — Pending |
| Dashboard + bootstrap are phase 2 priority | Orchestrator loop is the core value; everything else serves it | — Pending |
| Interactive for planning, YOLO for execution | Human reviews phase plans but execution runs hands-off | — Pending |

---

## Environment / Bootstrap (Phase 7)

A one-command WSL bootstrap is provided by `setup.sh` at the project root. It detects WSL2, resolves the Windows `.cursor` path (`/mnt/c/Users/<user>/.cursor`), and syncs GSD rules into the repo’s `.cursor/rules`. Run `./setup.sh` or `bash setup.sh` from the repo root; use `--check-env` or `--check-cursor` to verify without making changes.

---
*Last updated: 2026-03-16 after initialization*

## Vision Update – 2026-03-16 (Agent-Agnostic + Dashboard)

Unsupervised GSD must become the universal autopilot layer for ANY local AI coding CLI.

**Phase 6 Requirements (non-negotiable):**
- --agent flag (default: "cursor")
- Pluggable factory: createAgentInvoker("cursor" | "claude-code" | "gemini-cli" | "codex")
- All core logic (heartbeat, resume, status-server, git checkpoint, session-log) stays 100% generic
- Dashboard must display current agent + allow live switching
- Each new adapter <50 LOC, reuses exact NDJSON + heartbeat pattern
- Goal: become the “Docker for AI coding agents”

Existing Cursor behavior must remain identical with --agent=cursor.

