# gsd-unsupervised — Agent Instructions

Standing instructions for every agent run (daemon-invoked or manual).

## Commands

| Command | Purpose |
|---------|---------|
| `/gsd/help` | Show command reference |
| `/gsd/new-project` | Initialize project with brief |
| `/gsd/create-roadmap` | Create roadmap and phases |
| `/gsd/map-codebase` | Map existing codebase |
| `/gsd/discuss-phase <N>` | Articulate vision for a phase |
| `/gsd/research-phase <N>` | Research ecosystem for a phase |
| `/gsd/list-phase-assumptions <N>` | Preview planned approach |
| `/gsd/plan-phase <N>` | Create execution plan |
| `/gsd/execute-plan <path>` | Execute a PLAN.md |
| `/gsd/execute-phase <N>` | Execute all plans in a phase |
| `/gsd/status` | Check background agent status |
| `/gsd/progress` | Check project status, route next |
| `/gsd/add-phase` / `/gsd/insert-phase` / `/gsd/remove-phase` | Roadmap edits |
| `/gsd/resume-work` | Resume from previous session |
| `/gsd/verify-work` | Verify completed work |

## .planning/ contract

- **STATE.md** — "## Current Position" with Phase N of M, Plan N of M, Status, Progress %. Agent updates it; daemon reads for monitoring.
- **phases/** — One dir per phase: `NN-slug/`. Each plan: `NN-MM-PLAN.md`; completion: `NN-MM-SUMMARY.md`. Optional `COMPLETE.md` marker per phase.
- **config.json** — Workflow mode and overrides (e.g. `autoCheckpoint`, `maxConcurrent`).

## Tech stack

Node 18+, TypeScript ESM (`import/export`), Vitest, pino (structured logging), chokidar, Express, zod, simple-git.

## Commit format

`{type}({phase}-{plan}): {task-name}` (e.g. `feat(04-01): state consistency validator`). Stage files individually; never `git add -A`.

## Must-do

`npm test` must pass before any commit; `npm run build` before testing.

## Do not

Never edit `.planning/STATE.md` directly (agent owns it). Never write to `session-log.jsonl` except via `appendSessionLog`. Never hardcode paths — use `workspaceRoot` from config.

## Resource governor

Daemon gates new agent work on `maxCpuFraction` and `maxMemoryFraction`; wait for headroom before starting a run.
