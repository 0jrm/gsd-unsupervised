# GSD context-window budget

## When to use

Use when writing or running GSD execute-plan prompts so that agent runs stay context-efficient and avoid loading the entire codebase.

## Guidance

To keep execute-plan prompts within a small context budget:

1. **Load only the current PLAN.md** — The plan file for the task being executed (e.g. `.planning/phases/04-state-monitoring/04-01-PLAN.md`). Do not load every PLAN in the phase or roadmap.

2. **Load the two most recent SUMMARYs** — For the same phase, load at most the two latest `NN-MM-SUMMARY.md` files (e.g. `04-01-SUMMARY.md` and `04-02-SUMMARY.md` if executing plan 03, or just the previous plan’s SUMMARY). These give completion context without pulling full history.

3. **Load STATE.md** — `.planning/STATE.md` so the agent knows current phase, plan, status, and progress.

4. **Do not** — Load the full codebase, all phases’ plans, or every SUMMARY. Add further files only when the plan explicitly references them (e.g. a specific source file to change).

## Prompt shape

When invoking execute-plan, instruct the agent to: “Read only the attached PLAN.md, the two most recent SUMMARYs for this phase (if any), and STATE.md. Do not load the full codebase unless the plan requires a specific file.”

This keeps context small and makes runs faster and more predictable.
