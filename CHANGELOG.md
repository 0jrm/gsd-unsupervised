# Changelog

## [Unreleased]

### Added — Phase 5: Crash detection and recovery

- **Session log** — Append-only `session-log.jsonl` at project root with `goalTitle`, `phaseNumber`, `planNumber`, and `status` per run. Used to detect interrupted sessions and compute a deterministic resume point.
- **Resume** — On startup, if the last session was `running` or `crashed` and the first pending goal matches, the daemon passes `resumeFrom` to the orchestrator, which fast-forwards to that phase/plan, re-runs that plan once, then continues. No silent skip; when in doubt the run starts from scratch.
- **Heartbeat** — `.planning/heartbeat.txt` is updated every 15s while the agent runs. Missing or stale (>60s) heartbeat with a `running` session is treated as a crash so the next start can resume.
- **Clean git** — `requireCleanGitBeforePlan` (default `true`) refuses `execute-plan` when the working tree is dirty. `autoCheckpoint` (default `false`) optionally creates a checkpoint commit before the plan.
- **Status server** — `--status-server <port>` (or config `statusServerPort`) exposes GET / and GET /status returning JSON for dashboards/phone.
- **Docs** — README section "Crash detection and recovery" with example session-log and STATE.md mapping and "How to recover manually". ARCHITECTURE.md documents recovery, config, and failure modes.

See [README#crash-detection-and-recovery](README.md#crash-detection-and-recovery) for usage and manual recovery steps.
