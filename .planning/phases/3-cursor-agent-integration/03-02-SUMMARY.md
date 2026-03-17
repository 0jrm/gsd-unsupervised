---
phase: 3
plan: 2
subsystem: agent-runner, session-log
tags: [spawn, ndjson, process-management, tree-kill, session-tracking]
requires: [stream-events, parseEvent, extractSessionId, extractResult]
provides: [runAgent, abortAgent, RunAgentOptions, RunAgentResult, appendSessionLog, readSessionLog, getLastRunningSession, SessionLogEntry]
affects: [cursor-agent-integration, orchestrator, crash-recovery]
tech-stack: [typescript, node:child_process, node:readline, tree-kill, node:fs/promises]
key-files: [src/agent-runner.ts, src/session-log.ts]
key-decisions:
  - spawn with array args (no shell:true) for safety
  - tree-kill for process tree termination with SIGTERM→SIGKILL fallback
  - NDJSON append-only session log for crash-safe persistence
  - Null-tolerant RunAgentResult (sessionId/resultEvent can be null)
duration: ~5 minutes
completed: 2026-03-16
---

# 03-02 SUMMARY: Agent Runner with Spawn, Lifecycle Handling, and Session Logging

## Performance

- **Duration:** ~5 minutes
- **Tasks:** 2
- **Files created:** 2 (agent-runner.ts, session-log.ts)
- **Files modified:** 1 (package.json — tree-kill dependency)

## Accomplishments

1. **Agent Runner** (`runAgent`) — spawns Cursor headless agent with full arg construction, wires stdout through readline for NDJSON event parsing via `parseEvent`, collects stderr, and resolves with structured `RunAgentResult` containing sessionId, resultEvent, events array, exitCode, and stderr.

2. **Process Abort** (`abortAgent`) — graceful process tree kill using tree-kill: sends SIGTERM first, falls back to SIGKILL after 5 seconds if process doesn't exit.

3. **Lifecycle Handling** — timeout support via configurable `timeoutMs` that triggers `abortAgent` and annotates stderr. Exit code validation warns when agent exits 0 but produces no result event. Spawn failures reject with descriptive error including the attempted agentPath.

4. **Session Log** (`session-log.ts`) — NDJSON-based append-only log with `appendSessionLog` (atomic via 'a' flag), `readSessionLog` (skips malformed lines), and `getLastRunningSession` (reverse scan for status 'running').

## Task Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `43a5318` | `feat(03-02): create agent runner with spawn and NDJSON streaming` |
| 2 | `adcffc0` | `feat(03-02): add lifecycle handling and session logging` |

## Files Created/Modified

| File | Action |
|------|--------|
| `src/agent-runner.ts` | Created — runAgent, abortAgent, RunAgentOptions, RunAgentResult |
| `src/session-log.ts` | Created — appendSessionLog, readSessionLog, getLastRunningSession, SessionLogEntry |
| `package.json` | Modified — added tree-kill dependency |
| `package-lock.json` | Modified — lockfile update |

## Decisions Made

1. **Array args with no `shell: true`** — prevents injection and ensures proper escaping of workspace paths and prompts
2. **tree-kill over child.kill** — kills entire process tree, not just the direct child, which is critical for agent subprocesses
3. **SIGTERM → SIGKILL escalation** — gives process 5s to clean up before force-killing
4. **NDJSON session log format** — append-only with 'a' flag is safe for concurrent writes; one JSON object per line for simple parsing and crash safety
5. **Null-tolerant result types** — sessionId and resultEvent can be null since the agent may crash before emitting them; callers decide how to interpret
6. **No `@types/tree-kill`** — package ships its own `.d.ts` declarations; the npm package `@types/tree-kill` does not exist

## Deviations from Plan

- **`@types/tree-kill` not installed** — the package does not exist on npm. tree-kill v1.2.2 ships its own `index.d.ts`, so no separate types package is needed. devDependencies entry omitted.
- **Timeout and exit validation implemented in Task 1** — the timeout mechanism and exit code handling were naturally part of the `close` handler built in Task 1. Task 2 refined the exit validation with the "no result event" warning rather than adding it from scratch.

## Issues Encountered

- `@types/tree-kill` returned 404 from npm registry — resolved by confirming tree-kill bundles its own types.

## Next Phase Readiness

- `runAgent` is ready for the orchestrator to replace `stubAgent` with a real Cursor agent invocation
- `abortAgent` is ready for the daemon's shutdown handler to cleanly terminate running agents
- `SessionLogEntry` and log functions are ready for crash-recovery (Phase 5) to detect and resume interrupted sessions
