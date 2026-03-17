# Roadmap: Unsupervised GSD (GSD CLI)

## Overview

Journey from a greenfield CLI to an autonomous orchestrator: foundation (CLI, config, goal queue), lifecycle state machine and command sequence, Cursor agent integration for plan execution, state monitoring and phase transitions, crash detection and resume, HTTP status server, and WSL bootstrap for path resolution and setup.

## Domain Expertise

None

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** — CLI scaffold, config, goals from markdown, roadmap/phase discovery
- [ ] **Phase 2: Lifecycle** — GSD state machine, command sequence (New → Planning → Executing → Complete)
- [ ] **Phase 3: Agent Integration** — Cursor agent invoker, execute-plan invocation, stream parsing
- [ ] **Phase 4: State Monitoring & Phase Transitions** — STATE.md watching, progress events, phase/plan advancement
- [ ] **Phase 5: Crash Detection & Recovery** — Session log, resume-from phase/plan, heartbeat
- [ ] **Phase 6: Status Server** — HTTP status endpoint, daemon graceful shutdown
- [ ] **Phase 7: WSL Bootstrap** — Setup script, path resolution (Cursor, clip.exe, WSL)

## Phase Details

### Phase 1: Foundation
**Goal**: CLI entrypoint, config (JSON with goals path, agent, timeouts, gates), goals from markdown (pending/in progress/done), roadmap and phase discovery from `.planning/` (ROADMAP.md, phase dirs, PLAN.md).
**Depends on**: Nothing (first phase)
**Research**: Unlikely (project setup, established patterns)
**Plans**: 3 plans

Plans:
- [ ] 01-01: CLI scaffold (Commander, ESM, entrypoint)
- [ ] 01-02: Config and goals (config.json, goals markdown parsing)
- [ ] 01-03: Roadmap and phase discovery (.planning layout, PLAN.md discovery)

### Phase 2: Lifecycle
**Goal**: GSD state machine and command sequence — New → Initializing → Creating roadmap → Planning phase → Executing plan → Phase complete → Complete/Failed.
**Depends on**: Phase 1
**Research**: Unlikely (internal state machine)
**Plans**: 2 plans

Plans:
- [ ] 02-01: State machine (states, transitions)
- [ ] 02-02: Command sequence and orchestration loop

### Phase 3: Agent Integration
**Goal**: Invoke Cursor agent for GSD commands (e.g. execute-plan); configurable agent path and timeout; stream parsing for progress/completion.
**Depends on**: Phase 2
**Research**: Likely (Cursor agent invocation, subprocess, stream parsing)
**Research topics**: Cursor CLI/agent invocation from Node, stream parsing, timeout handling
**Plans**: 2 plans

Plans:
- [ ] 03-01: Agent invoker (subprocess, path, timeout)
- [ ] 03-02: Stream parsing and completion detection

### Phase 4: State Monitoring & Phase Transitions
**Goal**: STATE.md watching, state parser, phase transition detection, progress events.
**Depends on**: Phase 3
**Research**: Unlikely (file watching, existing patterns)
**Plans**: 2 plans

Plans:
- [ ] 04-01: STATE.md watcher and parser
- [ ] 04-02: Phase/plan advancement and progress events

### Phase 5: Crash Detection & Recovery
**Goal**: Session logging, resume-from phase/plan, heartbeat for crash detection.
**Depends on**: Phase 4
**Research**: Unlikely (session log format, resume logic)
**Plans**: 2 plans

Plans:
- [ ] 05-01: Session log and resume state
- [ ] 05-02: Heartbeat and crash detection

### Phase 6: Status Server
**Goal**: Optional HTTP status server for daemon; graceful shutdown. (CLI and status endpoint only for v1 — no full web UI.)
**Depends on**: Phase 5
**Research**: Unlikely (express already in stack)
**Plans**: 1 plan

Plans:
- [ ] 06-01: HTTP status server and graceful shutdown

### Phase 7: WSL Bootstrap
**Goal**: Setup script, path resolution for WSL (Cursor, clip.exe, workspace paths).
**Depends on**: Phase 6
**Research**: Likely (WSL path resolution, Cursor paths)
**Research topics**: WSL path resolution, Cursor CLI paths, clip.exe on WSL
**Plans**: 1 plan

Plans:
- [ ] 07-01: WSL path resolution and setup script

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-03-16 |
| 2. Lifecycle | 2/2 | Complete | 2026-03-17 |
| 3. Agent Integration | 2/2 | Complete | 2026-03-17 |
| 4. State Monitoring & Phase Transitions | 0/2 | Not started | - |
| 5. Crash Detection & Recovery | 0/2 | Not started | - |
| 6. Status Server | 0/1 | Not started | - |
| 7. WSL Bootstrap | 0/1 | Not started | - |
