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
- [x] **Phase 8: CN (Continue CLI) Support** — Add `cn` as first-class agent alongside cursor; adapter, output parsing, GSD rules compatibility
- [ ] **Phase 9: Onboarding & Distribution** — Bundle GSD framework, setup.sh wizard, init/run CLI, launch post, npm publish

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
**Plans**: 2 plans

Plans:
- [ ] 07-01: WSL path resolution and setup script
- [ ] 07-02: WSL bootstrap diagnostics and documentation

### Phase 8: CN (Continue CLI) Support
**Goal**: Add `cn` (Continue's headless CLI) as a first-class supported agent alongside cursor. End-to-end working integration: adapter, plain-text output parsing, GSD rules via .continue/config.yaml, configurable binary path.
**Depends on**: Phase 3 (Agent Integration)
**Research**: Level 1 — Continue CLI docs confirm headless invocation, config format, rules loading
**Plans**: 3 plans

Plans:
- [x] 08-01: cn adapter core (runContinueCli, parseCnOutput, config)
- [x] 08-02: Agent registry, createAgentInvoker, GSD rules compatibility
- [x] 08-03: Tests and documentation

### Phase 9: Onboarding & Distribution
**Goal**: Bundle GSD framework into repo, replace broken init with setup.sh, fix init/run CLI, finalize launch post and npm publish readiness.
**Depends on**: Phase 8
**Plans**: 3 plans

Plans:
- [x] 09-01: GSD framework bundle (workflows, templates, references) and path rewrite
- [x] 09-02: setup.sh wizard, init CLI command
- [ ] 09-03: Launch post, version bump, CHANGELOG, publish prep

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-03-16 |
| 2. Lifecycle | 2/2 | Complete | 2026-03-17 |
| 3. Agent Integration | 2/2 | Complete | 2026-03-17 |
| 4. State Monitoring & Phase Transitions | 2/2 | Complete | 2026-03-17 |
| 5. Crash Detection & Recovery | 2/2 | Complete | 2026-03-17 |
| 6. Status Server | 1/1 | Complete | 2026-03-17 |
| 7. WSL Bootstrap | 2/2 | Complete | 2026-03-17 |
| 8. CN (Continue CLI) Support | 3/3 | Complete | 2026-03-18 |
| 9. Onboarding & Distribution | 2/3 | In progress | — |
