---
phase: 3
plan: 3
subsystem: cursor-agent, config, cli, daemon
tags: [agent-invoker, api-key-validation, cli-options, session-logging, wiring]
requires: [runAgent, abortAgent, appendSessionLog, AgentInvoker, AgentResult, GsdCommand]
provides: [createCursorAgentInvoker, validateCursorApiKey, CursorAgentConfig, agentTimeoutMs, sessionLogPath]
affects: [orchestrator, daemon, cli, config]
tech-stack: [typescript, node:process, pino]
key-files: [src/cursor-agent.ts, src/config.ts, src/cli.ts, src/daemon.ts]
key-decisions:
  - invoker never throws — all failures map to { success: false, error }
  - non-interactive directive prepended to every prompt
  - API key validated before daemon start, skipped in dry-run
  - stubAgent preserved as default fallback in orchestrator
duration: ~5 minutes
completed: 2026-03-16
---

# 03-03 SUMMARY: Wire Real Cursor-Agent Invoker into Orchestrator, Daemon, and CLI

## Performance

- **Duration:** ~5 minutes
- **Tasks:** 2
- **Files created:** 1 (cursor-agent.ts)
- **Files modified:** 3 (config.ts, cli.ts, daemon.ts)

## Accomplishments

1. **Cursor Agent Invoker** (`createCursorAgentInvoker`) — factory function returning an `AgentInvoker` that maps GsdCommand to a full cursor-agent prompt with non-interactive directive, calls `runAgent`, logs session state transitions (running → done/crashed/timeout) via `appendSessionLog`, and streams debug-level events via pino. Never throws — all agent failures are returned as `{ success: false, error }`.

2. **API Key Validation** (`validateCursorApiKey`) — pre-flight check that `CURSOR_API_KEY` is set and non-empty, with actionable error message pointing to Cursor Dashboard → Cloud Agents → User API Keys.

3. **Config Schema Extension** — added `agentTimeoutMs` (default 600000ms / 10min, min 10000ms) and `sessionLogPath` (default `./session-log.jsonl`) to `AutopilotConfigSchema`.

4. **CLI Options** — added `--agent-path <path>` (default `agent`) and `--agent-timeout <ms>` (default `600000`), mapped to config overrides. API key validated before daemon start; skipped during `--dry-run`.

5. **Daemon Wiring** — daemon creates real invoker via `createCursorAgentInvoker` from config fields and passes it to `orchestrateGoal`. The `stubAgent` default in `orchestrator.ts` is preserved for tests and dry-run scenarios.

## Task Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `4b0c93d` | `feat(03-03): implement real cursor-agent invoker` |
| 2 | `0599ff2` | `feat(03-03): wire cursor-agent invoker into daemon and CLI` |

## Files Created/Modified

| File | Action |
|------|--------|
| `src/cursor-agent.ts` | Created — createCursorAgentInvoker, validateCursorApiKey, CursorAgentConfig |
| `src/config.ts` | Modified — added agentTimeoutMs and sessionLogPath fields |
| `src/cli.ts` | Modified — added --agent-path, --agent-timeout options; API key validation |
| `src/daemon.ts` | Modified — imports and creates real invoker, passes to orchestrateGoal |

## Decisions Made

1. **Invoker never throws** — all cursor-agent failures (timeout, crash, bad exit code) are caught and returned as `{ success: false, error }`. Only truly unexpected bugs in our code propagate as exceptions.
2. **Non-interactive directive prefix** — every prompt starts with "Execute in non-interactive/YOLO mode" to prevent the agent from asking interactive questions.
3. **Session log bracketing** — a 'running' entry is written before invocation; a final entry (done/crashed/timeout) is written after, enabling crash-recovery (Phase 5) to detect interrupted sessions.
4. **stubAgent preserved** — the default agent in `orchestrator.ts` remains the stub, so tests and dry-run work without cursor-agent or API key.
5. **API key validation in CLI, not daemon** — validation happens early with a user-friendly stderr message and clean exit, rather than deep in the agent invocation stack.
6. **Timeout detection via stderr content** — checks for "timed out" string in stderr to distinguish timeout from other failures, matching the convention set in agent-runner.ts.

## Deviations from Plan

- None. All tasks implemented as specified.

## Issues Encountered

- None.

## Next Phase Readiness

- The full cursor-agent integration pipeline is complete: CLI → config → daemon → invoker → runAgent → stream-events
- Phase 4 (State Monitoring & Phase Transitions) can build on the session log infrastructure
- Phase 5 (Crash Detection & Recovery) can use `getLastRunningSession` to find interrupted runs
