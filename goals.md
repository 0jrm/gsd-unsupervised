# GSD Autopilot Goals Queue

**Implementation reference:** See [docs/architecture_redesign.md](docs/architecture_redesign.md) for the original systematic review and directed instructions — process stability, resume-pointer consolidation, goals schema, lifecycle state machine, agent retry/backoff, and config overrides. Use it when implementing hardening and reliability work.

## Next 48h (see .planning/OPPORTUNITY.md)
- [ ] Publish gsd-unsupervised to npm
- [ ] Wire SMS for goal started + goal crashed (goal complete already sent)
- [ ] Write launch blog post ("daemon that runs my AI agent overnight"), link npm + paid tier

## Pending
- [ ] Add `./run` as the canonical entry point: reads .gsd/state.json, loads .env, starts daemon + ngrok + tmux, resumes previous state
- [ ] Add `npx gsd-unsupervised init` onboarding wizard: collects project name, goals path, Twilio config, writes .gsd/state.json and .env
- [ ] Implement .gsd/state.json as single source of truth: daemon writes PID, current goal, progress, ngrokUrl, lastHeartbeat on every state change
- [ ] Add PROJECT mode: daemon can target a different workspaceRoot than its own repo, with separate goals.md and state.json
- [ ] Complete Phase 4: State Monitoring & Phase Transitions — execute plans 04-02 and 04-03
- [ ] Complete Phase 5: Crash Detection & Recovery
- [ ] 5-crash-detection-recovery
- [ ] Debug & fix STATE.md not updating during GSD lifecycle
- [ ] Add recursive subagent support: daemon can spawn cursor-agent subprocess for complex plans, subagent can spawn further specialist agents. Use existing invocation pattern: cursor-agent --workspace <path> "<prompt>". Wire into orchestrator as an optional execution mode per plan.
- [ ] Add GPU guard to resource-governor (maxGpuFraction + gpuLoadCommand, surfaced in /api/status)
- [ ] Tighten agent support messaging (Cursor as v1.0 default; clearly mark other agents as experimental)
- [ ] Publish gsd-unsupervised v1.0.0 to npm and document npm-based install/usage
- [ ] Cost tracking per goal: token count (from result event or estimate), cost estimate; surface in /api/status and dashboard (placeholders exist)

- [ ] Build WhatsApp command/chat interface for autopilot
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

### Critical next steps
- [ ] [Critical] Align `goals.md` with current roadmap: remove or mark completed any phase 4–7 items that are already shipped in code, so the daemon’s queue reflects reality.
- [ ] [Critical] Add an end‑to‑end integration test that runs the daemon against a sample `.planning/` + `goals.md` workspace and verifies a full goal lifecycle (new → planning → executing → complete) without manual intervention.
- [ ] [Critical] Flesh out install/usage docs for `npm` users in `README.md` (global install, local `npx`, example `config.json`, and status server usage) and link them from `goals.md`.
- [ ] [Critical] Review and tighten default safety/config (resource governor thresholds, YOLO vs guarded mode, agent selection messaging) so a new user can’t accidentally run dangerous configs.

### High‑leverage improvements
- [ ] [High] Ship PROJECT mode end‑to‑end (multi‑workspace targeting, separate `goals.md`/state, and status server visibility) and document a realistic “manage a different repo” example.
- [ ] [High] Add richer status server output and dashboard UX (per‑goal progress, recent events, cost placeholders, and links to logs/session history).
- [ ] [High] Improve resume‑after‑crash UX: clearer log messages, dry‑run mode to show what would be resumed, and a simple CLI flag to force a fresh run when state is inconsistent.

### Obvious wins
- [ ] [Obvious] Clean up duplicate/obsolete items in `goals.md` (e.g., duplicate “hello world” tasks, outdated phase completion todos) so the queue stays readable.
- [ ] [Obvious] Add a minimal “Getting Started” example folder with a toy `.planning/` + `goals.md` that users can point the daemon at to see a full run in under 5 minutes.
- [ ] [Obvious] Wire a straightforward CI job (Node 18+, `npm test` and `npm run build`) to guard future changes.

## In Progress
<!-- orchestrator moves goals here while running -->

## Done
<!-- orchestrator moves goals here on completion -->
- [ ] Add a hello world comment to src/logger.ts
- [ ] Add a hello world comment to src/logger.ts
