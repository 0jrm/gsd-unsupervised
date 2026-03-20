# GSD Commands Skill

Use this skill when executing `/gsd/*` commands in Codex-compatible workflows.

## Command Contract

Supported commands:

- `/gsd/help`
- `/gsd/new-project`
- `/gsd/create-roadmap`
- `/gsd/map-codebase`
- `/gsd/discuss-phase <N>`
- `/gsd/research-phase <N>`
- `/gsd/list-phase-assumptions <N>`
- `/gsd/plan-phase <N>`
- `/gsd/execute-plan <path>`
- `/gsd/execute-phase <N>`
- `/gsd/status`
- `/gsd/progress`
- `/gsd/add-phase`
- `/gsd/insert-phase`
- `/gsd/remove-phase`
- `/gsd/resume-work`
- `/gsd/verify-work`

## Source of Truth

- Agent behavior guardrails: `AGENTS.md`
- Workflow details: `.gsd-framework/workflows/`
- Reference docs: `.gsd-framework/references/`
- Templates: `.gsd-framework/templates/`

Prefer these local files over ad-hoc command behavior.
