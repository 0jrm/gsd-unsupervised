# GSD Autopilot Goals Queue

## Pending
- [ ] Complete Phase 4: State Monitoring & Phase Transitions — execute plans 04-02 and 04-03
- [ ] Complete Phase 5: Crash Detection & Recovery
- [ ] 5-crash-detection-recovery

### 5-crash-detection-recovery
**Goal:** Detect any cursor-agent death mid-phase, read last known STATE.md + session-log, resume exactly from the last completed plan/phase with zero lost work.
**Success criteria:**
1. Auto-detect crash (exit code, "crashed" log, missing heartbeat >60 s).
2. Automatic resume on daemon restart (or --force-fresh override).
3. 30 s heartbeat + optional --status-server for phone visibility.
4. git reset --hard to last-known-good commit on resume.
5. Per-goal session isolation (parallel-ready).
6. Full e2e test: kill agent mid-plan → autopilot resumes and finishes.
7. Zero regression on 1–4; new vitest crash suite.

- [ ] Complete Phase 6: Web Dashboard with SSE live feed
- [ ] Complete Phase 7: WSL Bootstrap & Setup

## In Progress
<!-- orchestrator moves goals here while running -->

## Done
<!-- orchestrator moves goals here on completion -->
