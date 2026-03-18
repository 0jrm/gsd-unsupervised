This is a well-architected autonomous orchestration system with a solid foundation. I'll do a systematic review across six areas, ordered by impact on reliability and growth ceiling.

---

## 1. Process stability — the single highest-leverage area

The log shows the daemon dying on port conflict:

```
Error: listen EADDRINUSE: address already in use :::3000
Emitted 'error' event on Server instance at:
```

This is an unhandled `error` event on the Express server that propagates all the way up and kills the process. A monitoring feature crashing the thing it monitors is the worst possible failure mode.

Beyond this, reviewing the architecture as a whole:---

## 2. Six findings, ordered by leverage

### Finding 1: Status server is an unguarded crash vector (critical)

`src/status-server.ts` throws an unhandled `'error'` event when the port is occupied. Express server startup errors are emitted asynchronously on the `Server` object, not caught by `async/await`. The daemon dies.

**Required fix:** The status server must never crash the daemon. Implementation spec:

```typescript
// In createStatusServer:
await new Promise<void>((resolve, reject) => {
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn({ port }, 'Status server port in use — running without status server');
      resolve(); // non-fatal
    } else {
      reject(err);
    }
  });
  server.listen(port, () => resolve());
});
```

Beyond that, the status server lifecycle must be wrapped in a top-level `try/catch` in `daemon.ts` so any future startup error degrades gracefully instead of propagating.

---

### Finding 2: Dual resume-pointer implementations (design conflict)

`src/session-log.ts` exports `computeResumePoint(logPath, workspaceRoot, goalTitle)`. `tests/resume-integration.test.ts` imports `computeResumePointer` from `src/resume-pointer.ts` with a different signature: `computeResumePointer({ sessionLogPath, stateMdPath, goalTitle })`. These are two separate implementations of the same concept, with different parameter shapes and different derivation strategies (one uses ROADMAP/SUMMARY filesystem walk, the other uses session log events).

This creates a split source of truth for crash recovery. The daemon calls one, the tests verify the other.

**Required design:** Consolidate into a single `src/resume.ts` module. The implementation should:

1. Read session log entries for the given `goalTitle`
2. Check if the last entry has status `running` or `crashed`
3. Cross-check against STATE.md for the conservative fallback (take the earlier of the two)
4. Return `{ phaseNumber, planNumber } | null`

Delete `computeResumePoint` from `session-log.ts`. Remove `resume-pointer.ts` after migrating its logic. Update the daemon, orchestrator, and all tests to use the single consolidated export.

---

### Finding 3: Goals queue parsing is brittle (high)

`goals.md` currently contains at least four distinct formats:

```
- [ ] Complete Phase 4...          ← checkbox
- Debug & fix STATE.md...          ← bare dash, no checkbox
- Build WhatsApp command interface  ← bare dash, no checkbox, has a h3 below
### 5-crash-detection-recovery     ← h3 heading used as goal definition
5-crash-detection-recovery         ← appears twice, once as bare text
```

The `src/goals.ts` parser (not shown) has to handle all of this. This is a design smell: the file format is not a contract. When the daemon reads goals, it should not be doing ad-hoc format detection.

**Required design:** Define a strict schema and validate at startup. Plain prose items without `- [ ]` should either be ignored (with a logged warning) or treated as non-executable context blocks. The parser should:

1. Parse only lines matching `/^- \[([ x])\] (.+)$/` as executable goals
2. Treat `###` sections as metadata blocks attached to the preceding goal if they immediately follow it
3. Log all lines that were skipped with their line numbers
4. Expose a `parseGoals(path): { goals: Goal[], warnings: ParseWarning[] }` interface so the daemon can surface skipped items without silently dropping work

The current `goals.md` has a goal (`5-crash-detection-recovery`) that appears to be both a section header and a pending checkbox goal. These should be deduplicated at the data model level, not the file level.

---

### Finding 4: Lifecycle state machine has split ownership (structural)

`GoalStateMachine` in `src/lifecycle.ts` returns `null` from `getNextCommand()` for `PlanningPhase` and `ExecutingPlan`. The comment in the orchestrator owns that loop. This means the state machine documents the transitions but does not govern them — the orchestrator is separately tracking phase/plan index.

This works today but creates a maintenance trap: two places need to stay synchronized whenever the phase execution logic changes.

**Required design:** The state machine should be the single source of truth for what happens next. Options:

- Option A: Extend `getNextCommand()` to accept a `context: { plans: PlanInfo[], currentPlan: number }` parameter so it can emit `execute-plan` commands directly from the state machine
- Option B: Remove `GoalStateMachine` from the runtime path entirely and use it only as a type-level state tracker, moving all command generation into a pure function `nextCommand(state: OrchestratorState): GsdCommand | null`

Option B is cleaner. It removes the class entirely and replaces it with a pure function that takes all context and returns the next action. This is unit-testable without instantiating a class and aligns with the existing test pattern of directly calling exported functions.

---

### Finding 5: No retry or backoff on agent invocation (reliability)

`src/agent-runner.ts` spawns the agent once and returns. If the agent crashes mid-plan (exit code non-zero, `resultEvent.is_error === true`, or timeout), the orchestrator marks the goal as failed and moves on. There is no retry.

This is a real problem because:
- Network blips during the agent's API calls are transient
- Cursor agent occasionally exits prematurely without completing

**Required design:** Add a `maxRetries: number` (default `2`) and `retryDelayMs: number` (default `5000`) to `RunAgentOptions`. On a retriable failure (timeout, non-zero exit without a result event, or `resultEvent.is_error === true`), wait `retryDelayMs` then retry up to `maxRetries` times. Log each retry attempt with structured context. A final failure after all retries exhausted logs as `status: 'crashed'` in the session log.

Do not retry on explicit user errors (e.g., a plan that the agent successfully executed but returned a non-success result — `is_error: true` with a meaningful `result` string). Distinguish retriable infrastructure failures from application-level failures.

---

### Finding 6: `.planning/config.json` silently overrides daemon config (risk)

`loadConfig()` reads `.planning/config.json` and extracts `autoCheckpoint`, `maxConcurrent`, `maxCpuFraction`, `maxMemoryFraction`. These then override CLI flags and the main config file. This is the GSD workflow config file, not the daemon config file.

The risk: a user sets `maxConcurrent: 1` in the GSD config for single-agent workflow reasons, then the daemon silently runs with `maxConcurrent: 1` even if they passed `--max-concurrent 3`. This override is invisible at runtime and not surfaced in logs.

**Required fix:** In `readPlanningOverrides`, log each override being applied:

```typescript
if (typeof parsed.maxConcurrent === 'number') {
  logger.debug({ from: '.planning/config.json', maxConcurrent: parsed.maxConcurrent }, 
    'Planning config override applied');
  overrides.maxConcurrent = parsed.maxConcurrent;
}
```

Also add a `--ignore-planning-config` CLI flag that skips `readPlanningOverrides` entirely. The daemon startup log should list all active overrides in the config dump.

---

## 3. Missing test coverage for critical paths

The test suite covers: lifecycle transitions, orchestrator progress, roadmap parsing, resume integration, agent wiring, config validation, and stream parsing. What it does not cover:

- Status server port conflict handling (the bug that exists right now)
- `goals.ts` parsing of malformed/mixed-format goals.md
- The `computeResumePoint` vs `computeResumePointer` divergence
- Agent retry behavior
- Graceful degradation when `.planning/` directory is absent or corrupted

These gaps are the ones most likely to cause production incidents.

---

## 4. Directed instructions for cursor-agent

The following should be added to `goals.md` as a new structured goal block and then executed via the GSD framework. These are ordered by impact:

---

**To cursor-agent / GSD:**

Add the following goals to `goals.md` and plan them as a new milestone. Each goal below is a self-contained improvement with clear success criteria. Execute them sequentially.

**Goal: Harden status server — make port conflicts non-fatal**
Success criteria:
1. `createStatusServer` wraps `server.listen()` in a promise that catches `EADDRINUSE` and resolves without throwing
2. The daemon logs a structured warning and continues without a status server when the port is occupied
3. Any other `server.on('error')` errors are logged and re-thrown
4. Add a vitest test that starts two status servers on the same port and asserts the second one degrades gracefully

**Goal: Consolidate resume-pointer implementations**
Success criteria:
1. Delete `computeResumePoint` from `session-log.ts`
2. Confirm `src/resume-pointer.ts` exports `computeResumePointer({ sessionLogPath, stateMdPath, goalTitle })`
3. Update daemon.ts to call `computeResumePointer` instead
4. `tests/resume-integration.test.ts` continues to pass unchanged
5. No duplicate resume logic exists anywhere in `src/`

**Goal: Enforce goals.md schema with a strict parser**
Success criteria:
1. `parseGoals()` only treats `- [ ] ...` and `- [x] ...` lines as executable goals
2. Lines that do not match are collected as `ParseWarning[]` and logged at startup
3. The parser handles multi-line goal definitions (a `- [ ]` line followed by a `###` block of the same slug is treated as one goal with metadata)
4. The existing `goals.md` is cleaned up to use only `- [ ]` format
5. A vitest test covers: checkbox goals, bare-dash lines (skipped), h3 blocks (skipped), and the metadata attachment case

**Goal: Add retry/backoff to agent invocation**
Success criteria:
1. `RunAgentOptions` gains `maxRetries?: number` (default 2) and `retryDelayMs?: number` (default 5000)
2. Retriable failures: timeout, non-zero exit with no result event
3. Non-retriable: `resultEvent.is_error === true` with a populated `result` string
4. Each retry is logged as `{ attempt, maxRetries, reason }` at warn level
5. Session log `status: 'crashed'` is only written after all retries exhausted
6. Vitest test verifies retry count and delay behavior using a mock `spawn`