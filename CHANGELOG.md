# Changelog

## [Unreleased]

## [1.0.2] — 2026-03-18

### Summary

Phases 1–6 complete: lifecycle, roadmap/plans, agent invoker, stream parsing, crash detection and recovery, state monitoring. Agent retry policy with configurable backoff and non-retryable exit codes. SMS notifications for goal started, goal complete, and goal crashed (including when all retries exhausted). Crash recovery via session log, heartbeat timeout, and resume pointer.

### Added — Phase 5 & 6: Crash recovery and state monitoring

- **Session log** — Append-only `session-log.jsonl` with `goalTitle`, `phaseNumber`, `planNumber`, `status` per run; used for resume.
- **Resume** — On startup, if last session was `running` or `crashed` and goal matches, daemon passes `resumeFrom` to orchestrator.
- **Heartbeat** — `.planning/heartbeat.txt` updated every 15s while agent runs; stale/missing treated as crash.
- **Retry policy** — `runAgentWithRetry` with `DEFAULT_RETRY_POLICY` (3 attempts, backoff 5s/30s/120s, non-retryable exit codes 1/127).
- **SMS coverage** — Goal started `[gsd] Started: …`, goal complete, goal crashed `[gsd] Crashed: …` (fire-and-forget). `test-sms-all` CLI to send all three message types.
- **Clean git** — `requireCleanGitBeforePlan`, `autoCheckpoint`; status server and ngrok support.

See [README#crash-detection-and-recovery](README.md#crash-detection-and-recovery) for usage and manual recovery steps.
