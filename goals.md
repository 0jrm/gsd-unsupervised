# GSD Autopilot Goals Queue

## Pending
- [ ] Complete Phase 4: State Monitoring & Phase Transitions — execute plans 04-02 and 04-03
- [ ] Complete Phase 5: Crash Detection & Recovery
- [ ] 5-crash-detection-recovery
- Debug & fix STATE.md not updating during GSD lifecycle
- [ ] Add recursive subagent support: daemon can spawn cursor-agent subprocess for complex plans, subagent can spawn further specialist agents. Use existing invocation pattern: cursor-agent --workspace <path> "<prompt>". Wire into orchestrator as an optional execution mode per plan.
- [ ] Add GPU guard to resource-governor (maxGpuFraction + gpuLoadCommand, surfaced in /api/status)
- [ ] Tighten agent support messaging (Cursor as v1.0 default; clearly mark other agents as experimental)
- [ ] Publish gsd-unsupervised v1.0.0 to npm and document npm-based install/usage

- Build WhatsApp command/chat interface for autopilot
  ### WhatsApp command interface
  **Goal:** Allow sending commands ("status", "pause", "resume", "logs last 10", "stop daemon", "restart") via WhatsApp and get replies (status summary, dashboard link, logs snippet).
  **Success criteria:**
  1. Use free Twilio WhatsApp Sandbox (no cost for dev/testing) or self-hosted (Baileys library)
  2. Simple parser → map text to daemon actions (touch .pause-autopilot for "pause", rm for "resume")
  3. Secure: only your number + optional PIN
  4. Reply with dashboard URL (localtunnel/ngrok) + recent logs
  5. Document setup in README + optional in setup.sh

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
