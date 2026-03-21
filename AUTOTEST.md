Use a WSL shell for this repo. The wrappers now load `nvm`, but raw `npm` commands should still be run from Linux, not from a PowerShell UNC cwd.

The implementation you want to exercise lives mainly in [src/intake/start-command.ts](/home/jrm22n/projects/gsd-unsupervised/src/intake/start-command.ts), [src/gsd-sync.ts](/home/jrm22n/projects/gsd-unsupervised/src/gsd-sync.ts), [src/intake/bundle.ts](/home/jrm22n/projects/gsd-unsupervised/src/intake/bundle.ts), [src/intake/clarifier.ts](/home/jrm22n/projects/gsd-unsupervised/src/intake/clarifier.ts) (classification + clarification), [src/orchestrator.ts](/home/jrm22n/projects/gsd-unsupervised/src/orchestrator.ts), and [src/status-server.ts](/home/jrm22n/projects/gsd-unsupervised/src/status-server.ts).

**How To Test**
1. Regression test the code first.
```bash
cd /home/jrm22n/projects/gsd-unsupervised
source ~/.nvm/nvm.sh && nvm use 22
npm run build
npm test
npm run test:integration
```
Expected result: all three pass. Right now the suite should end with `236 passed` unit tests and `14 passed` integration tests.

2. Test non-destructive `./start` quick-mode intake.
```bash
./start "Fix README typo" --body "Edit README.md only" --update-only
grep -A8 -n "Fix README typo" goals.md
cat .planning/intake/LATEST.json
cat .gsd/upstream/manifest.json
find .planning/intake -maxdepth 2 -type f | sort | tail -n 8
```
Expected result: console prints `Queued: Fix README typo`, `Route: quick`, and a bundle path. `goals.md` gets a new pending item with `Route: quick`, bundle path, session context path, and agent brief path. `.planning/intake/<timestamp>-fix-readme-typo/` exists with `REQUEST.md`, `FIRST-PRINCIPLES.md`, `STANDARDS.md`, `SESSION-CONTEXT.md`, `AGENT-BRIEF.md`, and `manifest.json`. `.gsd/upstream/manifest.json` contains the synced upstream repo URL and SHA.

3. Test non-destructive `./start` full-route intake.
```bash
printf 'Implement docs updates across README and architecture docs. Preserve current command names.\n' | ./start "Integrate docs workflow" --body "" --update-only
grep -A8 -n "Integrate docs workflow" goals.md
cat .planning/intake/LATEST.md
```
Expected result: route is `full`. If the clarifier agent is available, you will see a draft spec and questions before the final prompt. If it is not available, the flow still works, but you may just get the final “accept/edit spec” prompt with little or no generated draft. The goal still queues and the bundle still gets written.

4. Test daemon health behavior.
```bash
./start "Fix one more typo" --body "README only"
```
Expected result:
- If `.gsd/state.json` does not exist: `Daemon state not initialized. Updated queue only.`
- If state exists but daemon is not healthy: you get the prompt `Type RUN ... or press ENTER for update only`.
- If daemon is already healthy: `Daemon already running (pid ...). Updated queue only.`

5. Test live quick execution in a disposable clone.
```bash
git clone /home/jrm22n/projects/gsd-unsupervised /tmp/gsd-unsupervised-e2e
cd /tmp/gsd-unsupervised-e2e
./run
```
In another shell:
```bash
cd /tmp/gsd-unsupervised-e2e
./start "Fix README typo" --body "Edit README.md only"
tail -f logs/orchestrator.log
grep -n "/gsd:quick" session-log.jsonl | tail
cat .planning/STATE.md
```
Expected result: the queued goal is picked up automatically, `session-log.jsonl` shows `/gsd:quick`, and `STATE.md` moves through a single quick phase/plan. If your agent runtime is valid and the command succeeds, you see a `done` terminal entry.

6. Test live full-route execution.
```bash
cd /tmp/gsd-unsupervised-e2e
printf 'Implement docs updates across README and architecture docs. Preserve current command names.\n' | ./start "Integrate docs workflow" --body ""
grep -nE '/gsd/plan-phase|/gsd/execute-plan' session-log.jsonl | tail -n 20
tail -f logs/orchestrator.log
```
Expected result: this goal does not use `/gsd:quick`. In an already-initialized workspace, `/gsd/new-project` and `/gsd/create-roadmap` may be skipped, so the visible execution often starts at `/gsd/plan-phase` and `/gsd/execute-plan`.

7. Test the dashboard and APIs.
```bash
PORT=$(node -e "console.log(require('./.gsd/state.json').statusServerPort || 3000)")
curl "http://localhost:$PORT/status"
curl "http://localhost:$PORT/api/status"
curl -X POST "http://localhost:$PORT/api/config" -H 'Content-Type: application/json' -d '{"parallelization":{"enabled":true}}'
```
Expected result: `/status` returns the minimal payload, `/api/status` returns the richer payload including `stateSnapshot`, `sessionLogEntries`, `gitFeed`, and placeholders for `tokens` and `cost`, and the config POST updates `.planning/config.json`.

8. Test the current dashboard intake behavior, which is still legacy.
```bash
curl -X POST "http://localhost:$PORT/api/goals/intake" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Fix README typo","body":"Edit README.md only"}'
```
Expected result: you get `{ "status": "queued", ... }` for simple requests or `{ "status": "pending", ... }` for ambiguous ones. Important: this path does **not** create the new intake bundle yet. Only `./start` does that.

**Dashboard Layout**
When `GET /` opens, the page is a single centered column, mobile-first, max width about 720px, defined in [src/status-server.ts](/home/jrm22n/projects/gsd-unsupervised/src/status-server.ts). It contains:
- A header with `GSD Autopilot`, a `Running/Stopped` badge, and an `N active` badge.
- A `Current goal` card with the goal title, a green progress bar, and a `Phase X/Y · Plan N/M — status` line.
- A `Recent commits` card showing recent git hashes, messages, and timestamps.
- A `Tokens / cost` card, which currently shows placeholders only.
- An `Execution mode` card with a sequential/parallel toggle.
- An `Add goal` form at the bottom with title and body fields.
- If `GSD_DASHBOARD_TOKEN` is set, the form also shows a password field for the token.

What it does **not** show yet: a session-log table, system-load charts, or token/cost analytics, even though `/api/status` already exposes some of that data.

**What Will Fail**
- `./start` can fail offline, because [src/gsd-sync.ts](/home/jrm22n/projects/gsd-unsupervised/src/gsd-sync.ts) always clones/fetches upstream GSD from GitHub before queueing.
- Full-route execution will fail fast on invalid plans, verify failures, or dirty git when `requireCleanGitBeforePlan: true` and `autoCheckpoint: false`, by design in [src/orchestrator.ts](/home/jrm22n/projects/gsd-unsupervised/src/orchestrator.ts).
- Requests submitted through the dashboard or SMS will fail your “new breadcrumb pipeline” expectation, because those routes still queue goals through the older intake flow in [src/status-server.ts](/home/jrm22n/projects/gsd-unsupervised/src/status-server.ts), without writing `.planning/intake/...`.
- Requests that depend on `cn` consuming the breadcrumb bundle are not guaranteed to behave correctly; `cn` is warned but not fully integrated.
- Multi-repo or infra-spanning requests like “update service A, service B, and Terraform in another repo” are a bad fit because the daemon operates on one `workspaceRoot`.

**What Will Be Extremely Inefficient**
- Small tasks with long or vague titles, like `Add dark mode to dashboard`, because `classifyGoal` in [src/intake/clarifier.ts](/home/jrm22n/projects/gsd-unsupervised/src/intake/clarifier.ts) only auto-quick-routes very short titles or obvious single-file cases. That means unnecessary clarifier agent round-trips.
- Broad requests like `Build a new CRM from scratch with auth, billing, analytics, AI chat, and mobile app`, because they score as large-scope and push the full lifecycle hard.
- Pure thinking/reporting requests like `Compare three architectures and write a recommendation memo`, because this pipeline is execution-oriented and will still try to convert them into an implementation goal.
- Requests whose title looks tiny but whose body is actually cross-cutting, like `Fix auth.ts` with a body that really means “redesign auth across frontend and backend”; that can mis-route into `quick` and be the wrong shape of execution.

If you want, I can turn this into a concrete acceptance checklist you can run line by line in a scratch clone.