---
phase: 03-cursor-agent-integration
plan: 04
type: execute
depends_on: ["03-03"]
files_modified: [src/cursor-agent.ts, src/agent-runner.ts, src/session-log.ts, src/daemon.ts, src/cli.ts, src/config.ts, src/cursor-agent.test.ts, src/agent-runner.test.ts]
---

<objective>
Harden the `cursor-agent` integration for fully non-interactive/YOLO execution so the orchestrator can drive `/gsd/new-project`, `/gsd/create-roadmap`, `/gsd/plan-phase`, and `/gsd/execute-plan` end-to-end without hanging or asking questions.

Purpose: Ensure every agent invocation is explicitly non-interactive, time-bounded, observable, and recoverable so the orchestrator loop never stalls and always knows whether `cursor-agent` is running, done, or crashed.
Output: Updated `cursor-agent` adapter and runner with standardized non-interactive directive, timeout/inactivity guards, structured error mapping, session logging, and basic tests/smoke harness.
</objective>

<execution_context>
/mnt/c/Users/jrm22n/.cursor/get-shit-done/workflows/execute-plan.md
./summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/3-cursor-agent-integration/3-RESEARCH.md
@.planning/phases/3-cursor-agent-integration/03-01-SUMMARY.md
@.planning/phases/3-cursor-agent-integration/03-02-SUMMARY.md
@.planning/phases/3-cursor-agent-integration/03-03-SUMMARY.md
@src/stream-events.ts
@src/agent-runner.ts
@src/session-log.ts
@src/cursor-agent.ts
@src/orchestrator.ts
@src/daemon.ts
@src/cli.ts
@src/config.ts

**Tech stack available:** Node.js 18+, TypeScript, zod, pino logger, commander, readline-based NDJSON parsing, existing cursor-agent adapter and runner.
**Established patterns:** ESM modules (type: module), Zod schemas for validation, AgentInvoker function type seam, append-only `session-log.jsonl`, non-interactive directive prepended to prompts.

**Constraining decisions:**
- `cursor-agent` must be invoked with `-p --force --trust --approve-mcps --workspace <dir> --output-format stream-json`.
- `--workspace` is mandatory so GSD rules load correctly.
- `CURSOR_API_KEY` must be present in non-dry-run mode; dry-run skips real invocations.
- Session tracking uses `session-log.jsonl` with `session_id` from stream-json system.init events.
- The orchestrator must remain agent-agnostic by Phase 6, so the adapter stays behind the AgentInvoker seam.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Standardize non-interactive/YOLO directive and injection</name>
  <files>src/cursor-agent.ts, src/orchestrator.ts, src/cursor-agent.test.ts</files>
  <action>
    Introduce a reusable non-interactive directive constant in `src/cursor-agent.ts`, e.g. `NON_INTERACTIVE_YOLO_PROMPT`, that clearly states:
    "Execute in non-interactive/YOLO mode. Auto-approve all confirmations. Do not ask the user any questions — make reasonable decisions autonomously. Follow the GSD rules and this project's constraints."

    Update `createCursorAgentInvoker` so every GSD command prompt is constructed as:
    [NON_INTERACTIVE_YOLO_PROMPT] + two newlines + [GSD command built from GsdCommand + args].

    Ensure this applies uniformly for `/gsd/new-project`, `/gsd/create-roadmap`, `/gsd/plan-phase <n>`, and `/gsd/execute-plan <path>` by relying on the orchestrator's existing `GsdCommand` abstraction rather than special-casing individual commands.

    Add/extend tests in `src/cursor-agent.test.ts` (or create them if missing) to assert that the final prompt passed into `runAgent` always begins with the directive string and contains the raw `/gsd/...` command afterwards.
  </action>
  <verify>Run `npm test -- cursor-agent` (or the equivalent test script) and confirm cursor-agent tests pass, including assertions that the non-interactive directive is present in all prompts.</verify>
  <done>Non-interactive directive extracted into a constant, all AgentInvoker prompts prepend it, and tests enforce that no GSD command is sent without the directive.</done>
</task>

<task type="auto">
  <name>Task 2: Harden timeouts, inactivity detection, and error mapping</name>
  <files>src/agent-runner.ts, src/session-log.ts, src/config.ts, src/agent-runner.test.ts, src/session-log.test.ts</files>
  <action>
    Extend `runAgent` in `src/agent-runner.ts` to support both a total timeout and an inactivity timeout:
    - Respect `timeoutMs` for maximum wall-clock duration: if exceeded, abort the process tree, mark the run as timed out, and capture a clear error message such as "cursor-agent timed out after X ms".
    - Track the timestamp of the last received NDJSON event; if no events arrive for `inactivityTimeoutMs`, treat the run as stalled, abort the process tree, and surface a "no output from cursor-agent for Y ms" error.

    Ensure `RunAgentResult` (or equivalent) includes enough detail (exitCode, stderr snippet, timeout/stall flags) for callers to distinguish success, normal failure, timeout, and stall.

    In `src/session-log.ts`, add or refine entries so each invocation writes:
    - A `status: "running"` entry as soon as a session_id is known (or with null session_id if never emitted).
    - A `status: "done"` entry on normal completion with duration.
    - A `status: "crashed"` or `"timeout"` entry on non-zero exit, timeout, or inactivity stall, including a brief error summary.

    Update `src/config.ts` to surface `agentTimeoutMs` and `agentInactivityTimeoutMs` fields in the config schema with safe defaults (for example, 10 minutes total timeout and 2 minutes inactivity).

    Add or extend tests in `src/agent-runner.test.ts` and `src/session-log.test.ts` that simulate:
    - A process that never exits (to trigger timeout).
    - A process that stops emitting output but stays alive (to trigger inactivity).
    - Correct mapping of these conditions into RunAgentResult and session-log entries.
  </action>
  <verify>Run `npm test -- agent-runner session-log` (or full `npm test`) and confirm tests covering timeout, inactivity, and session-log behaviors pass; additionally run `npx tsc --noEmit` to ensure type safety.</verify>
  <done>Agent runner enforces both total and inactivity timeouts, maps all failure modes to structured results, and session-log records running/done/crashed/timeout states reliably.</done>
</task>

<task type="auto">
  <name>Task 3: Enforce environment safety and provide a non-interactive smoke harness</name>
  <files>src/cli.ts, src/daemon.ts, src/config.ts, src/status-server.ts, src/cursor-agent.test.ts</files>
  <action>
    In `src/config.ts` and `src/cli.ts`, ensure configuration exposes:
    - `cursorAgentPath` (defaulting to `agent` or `cursor-agent`).
    - `agentTimeoutMs` and `agentInactivityTimeoutMs` as CLI flags and config fields.

    In `src/cli.ts`, validate `process.env.CURSOR_API_KEY` at startup for non-dry-run modes:
    - If missing, print a clear error explaining how to obtain and set the key.
    - Exit with status code 1 without attempting to spawn `cursor-agent`.
    - Skip this validation when `--dry-run` is enabled so developers can exercise the orchestrator without a real agent.

    Add or refine a simple smoke harness path (either a dedicated CLI command or a small goal) that:
    - Runs a trivial `/gsd` command through the real adapter with the non-interactive directive.
    - Prints parsed NDJSON events and detected `session_id` so developers can verify headless operation.

    Extend tests (or add new ones) to confirm:
    - Non-dry-run execution without `CURSOR_API_KEY` fails fast with the expected message.
    - Dry-run mode bypasses the check and does not attempt agent invocation.
    - Configuration values for timeouts and agent path are respected when spawning `cursor-agent`.
  </action>
  <verify>Run `npm test` to confirm new and existing tests pass, and manually run the CLI help (`node dist/cli.js --help` after build) to confirm the new agent-related options and behavior are documented as expected.</verify>
  <done>Config and CLI enforce safe environment requirements, non-dry-run mode never calls cursor-agent without CURSOR_API_KEY, and a basic smoke harness exists to exercise non-interactive cursor-agent integration end-to-end.</done>
</task>

</tasks>

<verification>
Before declaring this plan complete:
- [ ] `npx tsc --noEmit` passes with no TypeScript errors.
- [ ] `npm test` (or equivalent) passes, including new cursor-agent, agent-runner, and session-log tests.
- [ ] Running the smoke harness executes a trivial `/gsd` command non-interactively and records a `running` → `done` transition in `session-log.jsonl`.
- [ ] Starting the daemon without `CURSOR_API_KEY` in non-dry-run mode fails fast with a clear error and no hanging processes.
</verification>

<success_criteria>

- All tasks completed and verified.
- All orchestrator-invoked GSD commands include the standardized non-interactive/YOLO directive.
- NDJSON output is streamed, time-bounded, and mapped into structured results with explicit timeout/stall handling.
- `session-log.jsonl` reliably captures running/done/crashed/timeout for every cursor-agent invocation.
- The orchestrator can process at least one real goal end-to-end in YOLO mode without interactive prompts or hangs.
  </success_criteria>

<output>
After completion, create `.planning/phases/3-cursor-agent-integration/03-04-SUMMARY.md` with:
- A concise description of how non-interactive/YOLO guarantees were implemented.
- Files touched and any new config or CLI options added.
- Notes on timeout/inactivity behavior and session-log semantics.
- Instructions for running the smoke harness to validate non-interactive cursor-agent behavior in future.
</output>
