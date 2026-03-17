# GSD Autopilot Goals Queue

## Pending
- [ ] Complete Phase 4: State Monitoring & Phase Transitions — execute plans 04-02 and 04-03
- [ ] Complete Phase 5: Crash Detection & Recovery
- [ ] 5-crash-detection-recovery
- Debug & fix STATE.md not updating during GSD lifecycle
  ### Debug & fix STATE.md not updating
  **Goal:** Investigate why .planning/STATE.md is not being updated after successful /gsd/new-project, /gsd/create-roadmap, /gsd/plan-phase N, /gsd/execute-plan commands. Propose root cause(s) and concrete fixes (prompt changes, rule updates, orchestrator patches). Implement the most likely fix(es) and verify with a test run.
  **Success criteria:**
  1. Run a full minimal lifecycle (/gsd/new-project → /gsd/create-roadmap → /gsd/plan-phase 1 → /gsd/execute-plan ...) and confirm STATE.md shows correct advancing phase/plan/status/progress after each step.
  2. No more "State mismatch" warnings in orchestrator logs during normal execution.
  3. Document the cause and fix in PROJECT.md (Decisions section) and in a new SUMMARY.md in a debug phase if needed.
  4. Test that crash/resume still works after the fix (kill agent mid-plan → restart daemon → resumes correctly).

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
