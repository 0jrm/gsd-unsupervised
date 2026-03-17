# Phase 6 Plan 1: 06-01-PLAN.md

---
phase: 06-web-dashboard
plan: 01
type: execute
depends_on: []
files_modified:
  - src/agent-runner.ts
  - src/cursor-agent.ts
  - src/orchestrator.ts
  - src/config.ts
  - src/cli.ts
  - docs/ARCHITECTURE.md
  - README.md
domain: node-cli
---

<objective>
Introduce an `--agent` flag and pluggable agent invoker factory so the orchestrator can target multiple local AI coding CLIs while preserving current Cursor behavior by default.

Purpose: Decouple orchestrator core logic (heartbeat, resume, status server, git checkpoints) from any single AI agent implementation so Phase 6+ features (dashboard, bootstrap) can work with Cursor today and other agents later.
Output: Agent-agnostic invocation seam (`createAgentInvoker` factory + adapters), updated config/CLI wiring for `--agent`, and tests/docs that guarantee `--agent=cursor` behaves exactly like today.
</objective>

<execution_context>
/mnt/c/Users/jrm22n/.cursor/get-shit-done/workflows/execute-plan.md
./summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-crash-detection-recovery/05-04-SUMMARY.md

@docs/ARCHITECTURE.md
@README.md

@src/agent-runner.ts
@src/cursor-agent.ts
@src/orchestrator.ts
@src/config.ts
@src/cli.ts

**Tech stack available:** Node.js, TypeScript, commander, pino, chokidar, vitest
**Established patterns:** Config schema via Zod; CLI options wired through `config.ts`; `AgentInvoker` function-type seam for agent calls; vitest unit/integration tests under `src/` and `tests/`
**Constraining decisions:**
- Phase 3: Orchestrator treats GSD as a black box and drives it via `cursor-agent` CLI; AgentInvoker is the seam.
- Phase 5: Status server and heartbeat already defined; crash/recovery logic depends only on high-level events, not agent internals.
- Project constraint: Existing Cursor behavior must remain identical with `--agent=cursor`.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Define agent-agnostic invoker interface and factory</name>
  <files>src/agent-runner.ts, src/cursor-agent.ts, docs/ARCHITECTURE.md</files>
  <action>
  Formalize an `AgentInvoker` interface (or type alias) that represents "run one GSD command against a given workspace and goal", and implement a `createAgentInvoker(agentId: "cursor" | "claude-code" | "gemini-cli" | "codex"): AgentInvoker` factory that returns the appropriate adapter.
  Keep the existing Cursor behavior entirely inside the `"cursor"` adapter (likely reusing the current cursor-agent wiring from Phase 3), and for non-Cursor agents create thin stub adapters (&lt;50 LOC each) that are clearly marked as TODO but have the same call signature and NDJSON/heartbeat assumptions.
  Update `docs/ARCHITECTURE.md` to document the new agent-agnostic seam, including a short rationale and a sequence diagram showing orchestrator → AgentInvoker → underlying CLI.
  </action>
  <verify>
  - `npm run build` succeeds without new TypeScript errors.
  - `npm test` passes all existing tests (no behavior regressions).
  - `grep -R "AgentInvoker" src | wc -l` shows the new type/factory is the single seam where agents plug in.
  </verify>
  <done>
  - `createAgentInvoker` exists and returns a working `"cursor"` adapter that uses the same CLI flags/behavior as before.
  - Stubs exist for `"claude-code"`, `"gemini-cli"`, and `"codex"` with clear TODOs but no throwing at type level.
  - Architecture docs describe the seam and confirm the orchestrator core does not depend on Cursor-specific details.
  </done>
</task>

<task type="auto">
  <name>Task 2: Thread --agent flag through CLI, config, and orchestrator</name>
  <files>src/cli.ts, src/config.ts, src/orchestrator.ts, README.md</files>
  <action>
  Add an `--agent &lt;name&gt;` CLI flag (defaulting to `"cursor"`) to the main entrypoint in `src/cli.ts`, validate it against the supported set (`cursor`, `claude-code`, `gemini-cli`, `codex`) in the config schema, and surface it via the existing config object that the daemon/orchestrator consumes.
  Update `src/orchestrator.ts` (or wherever AgentInvoker is constructed) to call `createAgentInvoker(config.agent)` and pass the resulting invoker into the lifecycle, ensuring the only callsite that knows about concrete agent IDs is this construction point.
  Update `README.md` with a concise `--agent` section that documents defaults, supported values, and the guarantee that existing behavior is unchanged when `--agent=cursor` (or when the flag is omitted).
  </action>
  <verify>
  - Running `npm run build` succeeds.
  - Running `node dist/cli.js --help` (after build) shows the new `--agent` option with sensible help text.
  - In dry-run or test mode, constructing a config with `agent: "cursor"` results in the same code path as before (verified via unit test assertions or snapshots).
  </verify>
  <done>
  - CLI, config, and orchestrator all accept and propagate `agent` consistently.
  - Default behavior with no `--agent` flag matches current Cursor-only behavior exactly.
  - Invalid agent names fail fast with a clear error message and do not start the daemon.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add tests for agent selection and backward compatibility</name>
  <files>src/config.ts, src/orchestrator.ts, src/agent-runner.ts, src/roadmap-parser.test.ts, tests/</files>
  <action>
  Add focused unit tests that cover: (1) config parsing for the `agent` field (default `"cursor"`, rejection of invalid values), (2) `createAgentInvoker` returning a working Cursor adapter and non-throwing stubs for other agents, and (3) orchestrator construction wiring the selected agent ID into the factory.
  Where practical, use spies or lightweight fakes to assert that, under `agent: "cursor"`, the same lower-level cursor-agent invocation path is called as before (e.g., same CLI arguments, workspace handling, and NDJSON output assumptions), without over-coupling tests to implementation details.
  Ensure tests clarify that non-Cursor agents are currently placeholders by asserting on their shape/contract rather than behavior, and keep the new tests fast and hermetic so the existing test suite remains snappy.
  </action>
  <verify>
  - `npm test` passes and includes new test cases for `agent` config and factory selection.
  - A deliberate invalid agent name in a test (e.g., `"bogus-agent"`) triggers a predictable, user-friendly error path.
  - Coverage tools (if enabled) show that new branching around `agent` selection is exercised.
  </verify>
  <done>
  - All new tests are green and stable.
  - There is explicit test coverage for the default `cursor` path and for rejecting unsupported agents.
  - The project still runs end-to-end with Cursor as before, demonstrating that the abstraction did not regress core behavior.
  </done>
</task>

</tasks>

<verification>
Before declaring this plan complete:
- [ ] `npm run build` succeeds with no TypeScript errors.
- [ ] `npm test` passes all unit and integration tests.
- [ ] Running the CLI with and without `--agent=cursor` behaves identically for a simple goal (no new warnings or errors).
</verification>

<success_criteria>

- Agent-agnostic `createAgentInvoker` seam exists with a fully working Cursor adapter and stubbed adapters for other agents.
- CLI and config accept an `--agent` flag with a safe default and clear validation.
- All existing orchestrator flows (including crash detection, resume, and status server) continue to work unchanged when using Cursor.
- Architecture/README docs clearly describe the new agent abstraction and how it preserves backward compatibility.
  </success_criteria>

<output>
After completion, create `.planning/phases/06-web-dashboard/06-01-SUMMARY.md`:

# Phase 6 Plan 1: Agent-Agnostic Core Summary

**Introduce `--agent` flag and pluggable AgentInvoker factory while preserving existing Cursor behavior.**

## Accomplishments

- Implemented agent abstraction seam and factory.
- Wired `--agent` through CLI/config/orchestrator.
- Added tests covering agent selection and backward compatibility.

## Files Created/Modified

- `src/agent-runner.ts`, `src/cursor-agent.ts`, `src/orchestrator.ts`, `src/config.ts`, `src/cli.ts`
- `docs/ARCHITECTURE.md`, `README.md`

## Decisions Made

- Default agent is `cursor`; other agents use the same NDJSON/heartbeat contract.

## Issues Encountered

- [Document any blockers or deviations, or "None".]

## Next Step

- Ready for 06-02-PLAN.md (status API + dashboard backend).
</output>


================================================================================
# Phase 6 Plan 2: 06-02-PLAN.md

---
phase: 06-web-dashboard
plan: 02
type: execute
depends_on: ["06-01"]
files_modified:
  - package.json
  - src/status-server.ts
  - src/orchestrator.ts
  - docs/ARCHITECTURE.md
  - README.md
domain: node-cli
---

<objective>
Upgrade the minimal status server into an Express-based HTTP API that powers the web dashboard with rich, structured project status, git history, and token/cost metrics, while remaining lightweight and WSL2-friendly.

Purpose: Provide a stable, documented JSON API that the Phase 6 dashboard UI can consume from phones and laptops, exposing current agent, goal/phase/plan progress, recent STATE.md updates, git commits, and basic token/cost tracking, without adding a frontend build step.
Output: An Express-powered status server module, wired into the orchestrator/CLI, with endpoints and types that expose all dashboard data and tests that lock in the contract.
</objective>

<execution_context>
/mnt/c/Users/jrm22n/.cursor/get-shit-done/workflows/execute-plan.md
./summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-crash-detection-recovery/05-04-SUMMARY.md

@docs/ARCHITECTURE.md
@README.md

@src/status-server.ts
@src/state-parser.ts
@src/session-log.ts
@src/git.ts
@session-log.jsonl

**Tech stack available:** Node.js, TypeScript, vitest, existing minimal HTTP status server, session-log.jsonl and STATE.md parsing
**Established patterns:** Status payload struct via `StatusPayload`; file-watcher/state-parser infrastructure; fixture-based integration tests for status server and resume logic
**Constraining decisions:**
- Project constraint: Dashboard must be a plain HTML/CSS/JS app served by Express with no build step.
- Phase 5: Status server already exists and is documented; new API must not break existing expectations for simple `/` and `/status` consumers.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Express and simple-git dependencies and implement rich status API</name>
  <files>package.json, src/status-server.ts, src/git.ts, docs/ARCHITECTURE.md</files>
  <action>
  Add `express` and `simple-git` (or a similarly lightweight git wrapper) as runtime dependencies in `package.json`, keeping the stack minimal and compatible with WSL2.
  Refactor or extend `src/status-server.ts` to expose an Express-based HTTP server that preserves the existing `GET /` and `GET /status` JSON behavior, and additionally serves a richer JSON payload at a dashboard-oriented endpoint (e.g., `GET /api/status`) that includes: current agent ID, current goal, phase/plan, recent STATE.md snapshots, and a small rolling window of session-log entries.
  Use `simple-git` (or the existing git helper) to include a compact git commit feed (e.g., last 10 commits with hash, message, timestamp) and add placeholder fields for token/cost tracking that can be populated later, documenting the shape in `docs/ARCHITECTURE.md`.
  </action>
  <verify>
  - `npm install` (or `npm run build` using the updated lockfile) succeeds with the new dependencies.
  - `npm test` passes existing status-server tests (update expectations if necessary to allow Express).
  - `curl http://localhost:PORT/status` returns the old minimal payload shape, while `curl http://localhost:PORT/api/status` returns the richer dashboard JSON including agent and git feed.
  </verify>
  <done>
  - Express-backed status server runs and still responds correctly to legacy `/` and `/status` routes.
  - A new dashboard JSON endpoint exists with a documented, stable schema.
  - Architecture docs describe the new API surface and dependencies.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire status server lifecycle into orchestrator and document CLI flags</name>
  <files>src/orchestrator.ts, src/status-server.ts, README.md, docs/ARCHITECTURE.md</files>
  <action>
  Ensure the orchestrator owns the lifecycle of the Express status server: start it when the daemon starts (respecting any existing `--status-server` or port flags from earlier phases), and shut it down cleanly on process exit or crash, reusing patterns from Phase 5 crash detection where appropriate.
  Extend or confirm CLI flags to control the status server (enable/disable, port, bind host if needed for WSL2) and update `README.md` with an explicit "Status server and dashboard API" section that shows how to run the daemon with the API enabled and what endpoints are available.
  In `docs/ARCHITECTURE.md`, document how the status server reads from STATE.md, session-log.jsonl, and git to compute its payload, and how it surfaces the current agent ID and goal/phase/plan selection.
  </action>
  <verify>
  - Running the daemon in a dev environment starts the status server without blocking the main orchestrator loop.
  - Stopping the daemon or sending SIGINT cleanly tears down the Express server (no port-in-use errors on restart).
  - `curl` or a browser can reach the status endpoints from both WSL and a phone on the same network (as documented).
  </verify>
  <done>
  - Status server lifecycle is tied cleanly to the orchestrator/daemon.
  - CLI/docs clearly explain how to enable and consume the status API.
  - No regressions in crash detection/recovery behavior.
  </done>
</task>

</tasks>

<verification>
Before declaring this plan complete:
- [ ] `npm run build` succeeds with new Express/simple-git dependencies.
- [ ] `npm test` passes all unit and integration tests, including any updated status-server tests.
- [ ] Manual smoke test: run the daemon with status server enabled, hit `/status` and `/api/status` from a browser and verify payload structure matches documentation.
</verification>

<success_criteria>

- Express-backed status API exists with endpoints suitable for the Phase 6 dashboard.
- Legacy `/` and `/status` routes remain backwards compatible for simple consumers.
- Status payload includes current agent, goal/phase/plan, recent STATE.md/session-log snapshots, and a compact git feed.
- CLI flags and docs make it easy to run the orchestrator with the status server enabled on WSL2.
  </success_criteria>

<output>
After completion, create `.planning/phases/06-web-dashboard/06-02-SUMMARY.md`:

# Phase 6 Plan 2: Status API Backend Summary

**Upgrade status server to Express-based JSON API powering the dashboard with agent-aware project status, git feed, and metrics.**

## Accomplishments

- Added Express/simple-git (or equivalent) and implemented rich status API endpoints.
- Wired status server lifecycle into orchestrator/daemon and CLI flags.
- Updated docs to describe status API schema and usage.

## Files Created/Modified

- `package.json`, `src/status-server.ts`, `src/orchestrator.ts`
- `docs/ARCHITECTURE.md`, `README.md`

## Decisions Made

- Chosen JSON schema for dashboard status payload and commit feed.

## Issues Encountered

- [Document any blockers or deviations, or "None".]

## Next Step

- Ready for 06-03-PLAN.md (HTML/CSS/JS dashboard UI and interactions).
</output>


================================================================================
# Phase 6 Plan 3: 06-03-PLAN.md

---
phase: 06-web-dashboard
plan: 03
type: execute
depends_on: ["06-01", "06-02"]
files_modified:
  - src/status-server.ts
  - docs/ARCHITECTURE.md
  - README.md
domain: web-dashboard
---

<objective>
Implement a mobile-friendly HTML/CSS/JS dashboard served by the status server that visualizes orchestrator state (goals, phases, plans, agent, progress, git feed, token/cost metrics) and allows live toggling between sequential and parallel execution modes.

Purpose: Provide a zero-build, browser-based control panel at `http://localhost:3000` (or configured port) that the user can open on a phone or laptop to monitor and steer long-running orchestrator sessions.
Output: Static dashboard assets (HTML, CSS, JS) served by Express, wired to the JSON status API, with a responsive layout, periodic auto-refresh, an agent indicator, and a working sequential/parallel mode toggle.
</objective>

<execution_context>
/mnt/c/Users/jrm22n/.cursor/get-shit-done/workflows/execute-plan.md
./summary.md
/mnt/c/Users/jrm22n/.cursor/get-shit-done/references/checkpoints.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/06-web-dashboard/06-01-PLAN.md
@.planning/phases/06-web-dashboard/06-02-PLAN.md
@docs/ARCHITECTURE.md
@README.md

@src/status-server.ts

**Tech stack available:** Node.js, Express, plain HTML/CSS/JS
**Established patterns:** No frontend build step; Express serves endpoints and content; status API provides structured JSON for dashboard consumption
**Constraining decisions:**
- Dashboard must be plain HTML/CSS/JS with no React/Vite/webpack.
- Dashboard must display current agent and allow live switching between sequential/parallel modes.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create responsive dashboard HTML/CSS/JS shell and serve it from Express</name>
  <files>src/status-server.ts, docs/ARCHITECTURE.md, README.md</files>
  <action>
  Implement a small dashboard handler in the status server that serves a single static HTML file (plus inlined CSS/JS or a minimal set of static assets) at `GET /` which renders: (1) a header showing current agent and overall orchestrator status, (2) per-goal cards with progress bars for phases/plans, (3) a compact git commit feed, and (4) basic token/cost summary.
  Use modern, mobile-first CSS (e.g., flexbox/grid, prefers-color-scheme) and progressive enhancement so the page looks good on phones and desktops without any framework; fetch the rich JSON status endpoint (from Plan 2) via `fetch` in a small script that auto-refreshes data every 10 seconds without full page reload.
  Update docs to describe the dashboard layout, how it reads from the JSON API, and how to access it from WSL2 (e.g., localhost and local network URLs).
  </action>
  <verify>
  - Running the daemon with the status server enabled allows visiting `http://localhost:PORT/` in a browser to see a styled dashboard.
  - Resizing the browser from desktop to mobile widths keeps content legible and usable (no horizontal scroll, cards stack vertically).
  - Network tab shows periodic JSON fetches from the status API endpoint with no console errors.
  </verify>
  <done>
  - Dashboard loads successfully and shows current agent, at least one goal card with phase/plan progression, and recent commits.
  - Layout is responsive and readable on both desktop and mobile-sized viewports.
  - All assets are static and served directly by Express (no build pipeline).
  </done>
</task>

<task type="auto">
  <name>Task 2: Implement sequential/parallel mode toggle and wire it through to config</name>
  <files>src/status-server.ts, docs/ARCHITECTURE.md, README.md, .planning/config.json</files>
  <action>
  Add a small JSON endpoint (e.g., `GET /api/config` + `POST /api/config`) that exposes and updates the orchestrator's parallelization settings at runtime, at minimum toggling between sequential mode and a `--parallel`-equivalent mode consistent with the existing `.planning/config.json` schema.
  On the dashboard page, add a simple control (e.g., a toggle switch or button group) that reflects the current execution mode and, when changed, issues a POST to the config endpoint to update the setting, with optimistic UI feedback and error handling if the update fails.
  Update docs to explain that this toggle is a convenience wrapper around the underlying parallelization configuration, and describe any safety constraints (e.g., only affects new projects/goals, not currently running execution waves).
  </action>
  <verify>
  - Hitting the config endpoints via `curl` shows the current parallelization mode and confirms that POST updates are persisted (or at least take effect for the running daemon as designed).
  - Toggling the control in the dashboard updates the visual state and the next orchestrator wave respects the new mode.
  - `npm test` still passes, and any new tests for the config API and mode toggle endpoints succeed.
  </verify>
  <done>
  - Dashboard exposes a working sequential/parallel mode toggle wired to real orchestrator configuration.
  - Config changes are validated and do not crash the daemon if invalid input is posted.
  - Documentation clearly explains how and when the toggle affects orchestrator behavior.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Phase 6 web dashboard UI and execution-mode toggle</what-built>
  <how-to-verify>
    1. Start the orchestrator daemon with the status server enabled (per README instructions for Phase 6).
    2. From your WSL-host browser, visit the dashboard URL (e.g., `http://localhost:3000/`) and confirm:
       - Overall status header shows current agent and at least one active or completed goal.
       - Per-goal cards show phase/plan progress bars that update as work proceeds.
       - Recent git commits appear in the commit feed with readable messages and timestamps.
    3. Resize the browser or open the page on your phone:
       - Cards stack vertically on narrow viewports.
       - Text remains legible; no horizontal scrolling is required.
    4. Use the sequential/parallel toggle:
       - Switch modes and confirm the UI reflects the change.
       - Optionally, start a new goal and confirm (via logs or behavior) that the orchestrator respects the new mode.
    5. Check the browser console for errors and the network tab for failed requests; none should be present during normal operation.
  </how-to-verify>
  <resume-signal>Type "approved" once the dashboard looks and behaves as expected across devices, or describe any visual/behavioral issues to address.</resume-signal>
</task>

</tasks>

<verification>
Before declaring this plan complete:
- [ ] `npm run build` and `npm test` succeed after dashboard changes.
- [ ] Dashboard loads and auto-refreshes on desktop and mobile without console errors.
- [ ] Sequential/parallel toggle correctly updates orchestrator configuration and is reflected in the UI.
</verification>

<success_criteria>

- Dashboard UI is implemented as a single-page, zero-build HTML/CSS/JS experience served by Express.
- The page renders correctly on both desktop and mobile and surfaces the key orchestrator signals (agent, goals, phases, plans, git feed, cost/tokens).
- The execution-mode toggle works end-to-end from UI control through status/config API to orchestrator behavior.
- A manual visual verification has been performed and approved.
  </success_criteria>

<output>
After completion, create `.planning/phases/06-web-dashboard/06-03-SUMMARY.md`:

# Phase 6 Plan 3: Dashboard UI and Controls Summary

**Ship the web dashboard UI with live status, progress visualization, and execution-mode controls.**

## Accomplishments

- Implemented responsive HTML/CSS/JS dashboard powered by the status API.
- Added sequential/parallel mode toggle wired through to orchestrator configuration.
- Verified dashboard behavior manually on desktop and mobile.

## Files Created/Modified

- `src/status-server.ts`
- `docs/ARCHITECTURE.md`, `README.md`

## Decisions Made

- Finalized dashboard layout, refresh interval, and config toggle behavior.

## Issues Encountered

- [Document any blockers or deviations, or "None".]

## Next Step

- Phase 6 complete; ready to proceed to Phase 7 (WSL bootstrap/setup).
</output>
