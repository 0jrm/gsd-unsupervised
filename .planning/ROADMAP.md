# Roadmap: GSD Autopilot

## Overview

Build a local automation orchestrator that drives Cursor's headless agent through the full GSD lifecycle with zero manual intervention. Starting from a CLI daemon that reads a goal queue, we layer on cursor-agent integration, state monitoring, crash recovery, a live web dashboard, and a one-command WSL bootstrap — each phase delivering a complete, verifiable capability on top of the last.

## Domain Expertise

None

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & CLI Scaffold** — Node.js project setup, CLI entry point, config management, goals.md parser
- [x] **Phase 2: Core Orchestration Loop** — Sequential goal processing, GSD command sequencing, lifecycle state machine
- [x] **Phase 3: Cursor Agent Integration** — Spawn cursor-agent headlessly, pipe GSD commands, capture output, handle process lifecycle
- [x] **Phase 4: State Monitoring & Phase Transitions** — File watching on STATE.md, progress detection, automatic phase advancement
- [x] **Phase 5: Crash Detection & Recovery** — Process health monitoring, dead agent detection, resume from exact failure point
- [x] **Phase 6: Web Dashboard** — Express server, plain HTML/CSS/JS dashboard with live status, progress bars, git feed, token tracking
- [x] **Phase 7: WSL Bootstrap & Setup** — setup.sh script, WSL detection, path resolution, GSD rules copy, install validation

## Phase Details

### Phase 1: Foundation & CLI Scaffold
**Goal**: Working CLI daemon that parses goals.md, accepts --parallel flag, and has config/logging infrastructure ready for the orchestration loop
**Depends on**: Nothing (first phase)
**Research**: Unlikely (standard Node.js project setup, established CLI patterns)
**Plans**: 3 plans

Plans:
- [x] 01-01: Project scaffold, config, logger
- [x] 01-02: Goals parser and queue
- [x] 01-03: CLI entry and --parallel flag

### Phase 2: Core Orchestration Loop
**Goal**: State machine that processes goals sequentially, knows the GSD command order (new-project → create-roadmap → plan-phase → execute-plan), and advances through phases — but stubs out the actual agent calls
**Depends on**: Phase 1
**Research**: Unlikely (internal state machine logic, standard patterns)
**Plans**: 3 plans

Plans:
- [x] 02-01: Lifecycle state machine
- [x] 02-02: GSD command sequencing
- [x] 02-03: Stub agent invoker

### Phase 3: Cursor Agent Integration
**Goal**: Replace stubs with real cursor-agent spawning — invoke it headlessly, pipe GSD commands, capture output, and handle process lifecycle
**Depends on**: Phase 2
**Research**: Likely (external tool integration, critical behavioral unknown)
**Research topics**: cursor-agent CLI interface and headless invocation flags; command piping and output streaming format; how cursor-agent handles interactive prompts mid-execution — does it hang, timeout, buffer, or can it be driven non-interactively?
**Plans**: 3 plans

Plans:
- [x] 03-01: cursor-agent spawn and workspace
- [x] 03-02: Command piping and output capture
- [x] 03-03: Process lifecycle and session_id

### Phase 4: State Monitoring & Phase Transitions
**Goal**: Chokidar-based file watcher on .planning/STATE.md that detects progress changes and triggers automatic phase advancement in the orchestrator
**Depends on**: Phase 3
**Research**: Unlikely (chokidar is well-established, STATE.md parsing is internal logic)
**Plans**: 3 plans

Plans:
- [x] 04-01: File watcher on STATE.md
- [x] 04-02: Progress parsing and phase detection
- [x] 04-03: Automatic phase advancement

### Phase 5: Crash Detection & Recovery
**Goal**: Detect when cursor-agent dies mid-phase, parse STATE.md for last known position, and automatically resume from exactly that point with no lost work
**Depends on**: Phase 4
**Research**: Unlikely (Node.js process management, internal patterns)
**Plans**: 4 plans

Plans:
- [x] 05-01: Process health and dead-agent detection
- [x] 05-02: Resume from last known position
- [x] 05-03: Git checkpoint and session-log
- [x] 05-04: Docs and recovery tests

### Phase 6: Web Dashboard
**Goal**: Mobile-friendly Express dashboard at localhost:3000 with live agent status, per-project progress bars, recent STATE.md updates, git commit feed, cost/token tracking, auto-refresh, and sequential/parallel mode toggle. Agent-agnostic seam (--agent flag, pluggable factory).
**Depends on**: Phase 5
**Research**: Unlikely (Express + plain HTML/CSS/JS, no frameworks, established patterns)
**Plans**: 3 plans

Plans:
- [x] 06-01: Agent-agnostic seam and --agent flag
- [x] 06-02: Status API and dashboard backend
- [x] 06-03: Dashboard UI (HTML/CSS/JS)

### Phase 7: WSL Bootstrap & Setup
**Goal**: One-command setup.sh that detects WSL, resolves Windows .cursor path, copies GSD rules, validates the install, and gets the full stack running
**Depends on**: Phase 6
**Research**: Unlikely (shell scripting, well-documented WSL path patterns)
**Plans**: 2 plans

Plans:
- [x] 07-01: WSL script and rules sync
- [x] 07-02: Validation and smoke checks

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & CLI Scaffold | 3/3 | Complete | 2026-03-16 |
| 2. Core Orchestration Loop | 3/3 | Complete | 2026-03-16 |
| 3. Cursor Agent Integration | 3/3 | Complete | 2026-03-16 |
| 4. State Monitoring & Phase Transitions | 3/3 | Complete | 2026-03-16 |
| 5. Crash Detection & Recovery | 4/4 | Complete | 2026-03-17 |
| 6. Web Dashboard | 3/3 | Complete | 2026-03-16 |
| 7. WSL Bootstrap & Setup | 2/2 | Complete | 2026-03-16 |
