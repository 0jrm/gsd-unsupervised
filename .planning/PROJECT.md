# Unsupervised GSD (GSD CLI)

## What This Is

A CLI and daemon that autonomously orchestrates the GSD (Get Shit Done) workflow by driving a Cursor agent through phases and plans. It reads goals from a markdown file, discovers roadmaps and plans under `.planning/phases/`, and invokes the agent to execute plans in sequence. It is for users who want hands-off execution of GSD phases with optional status visibility and resume after interruption.

## Core Value

Reliable autonomous execution of GSD phases and plans via the Cursor agent—so that multi-phase work progresses without manual step-by-step confirmation when running in YOLO/non-interactive mode.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Goals from markdown (pending / in progress / done) drive a queue of work
- [ ] Roadmap and phase discovery from `.planning/` (ROADMAP.md, phase dirs, PLAN.md files)
- [ ] Lifecycle: New → Initializing project → Creating roadmap → Planning phase → Executing plan → Phase complete → Complete/Failed
- [ ] Cursor agent invocation for GSD commands (e.g. execute-plan) with configurable agent path and timeout
- [ ] Git checkpoints / clean-working-tree checks before running plans when configured
- [ ] State watching and phase transition detection (STATE.md, state parser)
- [ ] Daemon mode with graceful shutdown and optional HTTP status server
- [ ] Session logging and resume-from phase/plan for crash recovery
- [ ] Config via JSON (goals path, parallelization, agent type, timeouts, gates) with CLI overrides

### Out of Scope

- Web UI or dashboard — CLI and status endpoint only for v1
- Multiple concurrent projects in one process — single workspace per process
- Non-Cursor agents as first-class — cursor is primary; others experimental

## Context

- TypeScript/Node, ESM, Commander for CLI. Uses chokidar, simple-git, pino, express (status server).
- Integrates with GSD rule files and `.planning/` layout (PROJECT.md, ROADMAP.md, STATE.md, phases with PLAN.md).
- Cursor agent is invoked as subprocess; API key validation for cursor agent type.
- Workspace root is the project directory; goals file and config path are configurable.

## Constraints

- **Tech stack**: Node ≥18, TypeScript, existing dependencies (commander, chokidar, simple-git, pino, zod, etc.) — stay within current stack.
- **Compatibility**: Must work in WSL and environments where Cursor CLI/agent is available.
- **Safety**: Destructive or external-service actions should remain gated when not in YOLO mode (config-driven).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| YOLO mode for this project init | User requested non-interactive; auto-approve confirmations | — Pending |
| Standard planning depth | Balanced scope and speed for phase/plan breakdowns | — Pending |
| Parallelization disabled | Sequential execution recommended for reliability | — Pending |

---
*Last updated: 2026-03-17 after initialization*
