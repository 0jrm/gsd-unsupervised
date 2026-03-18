# Skill: Execute a GSD plan (context-efficient)

Use this skill when the daemon or user invokes **execute-plan** for a PLAN.md. Load only what you need to avoid blowing the context window.

## When to use

- Prompt contains `/gsd/execute-plan <path>` or "execute plan at .planning/phases/…/NN-MM-PLAN.md".
- You are the agent run by the gsd-unsupervised daemon for a single plan.

## Minimal context load

1. **Plan file** — Read the PLAN path from the prompt (e.g. `.planning/phases/04-foo/04-01-PLAN.md`).
2. **State** — Read `.planning/STATE.md` (Current Position only is enough).
3. **Config** — Read `.planning/config.json` only if you need mode (interactive vs YOLO) or checkpoints.
4. **Rule** — Follow `.cursor/rules/gsd-execute-plan.mdc` for process, strategies, commit rules, and success criteria.

## Optimal prompt pattern (for daemon/orchestrator)

When invoking the agent for execute-plan, pass:

- The exact command: `/gsd/execute-plan .planning/phases/<phase-dir>/<NN-MM-PLAN.md>`.
- Instruction: "Execute in non-interactive/YOLO mode. Auto-approve all confirmations. Do not ask the user any questions — make reasonable decisions autonomously."
- No need to inline the full plan or STATE.md — the agent will read them from the workspace.

## Outcome

- One commit per task (feat/fix/test/refactor).
- SUMMARY.md created; STATE.md and ROADMAP.md updated.
- Final docs commit for plan completion.
- Return success/failure so the daemon can log and advance.
