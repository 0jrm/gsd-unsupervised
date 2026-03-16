---
created: 2026-03-16T18:51
title: plan-phase interactive prompts block orchestrator
area: tooling
files:
  - ~/.claude/get-shit-done/workflows/plan-phase.md:396-419
  - .claude/commands/gsd/plan-phase.md:11 (AskUserQuestion in allowed-tools)
---

## Problem

`/gsd:plan-phase` has an interactive `confirm_breakdown` step (line 396-419 of plan-phase.md) that uses `AskUserQuestion` to ask the user "Does this look right? (yes / adjust / start over)". When the orchestrator drives cursor-agent headlessly in Phase 3, any GSD command that blocks on user input will hang the process forever — the agent will sit waiting for a response that never comes.

The workflow already has `<if mode="yolo">` / `<if mode="interactive">` conditionals, but the orchestrator has no mechanism to set this mode when invoking cursor-agent. Other GSD commands (add-todo duplicate check, discuss-milestone, discuss-phase) may also use AskUserQuestion.

This is flagged as the #1 research unknown in the ROADMAP Phase 3 description: "how cursor-agent handles interactive prompts mid-execution."

## Solution

Three options (not mutually exclusive):

1. **--yolo flag propagation**: The orchestrator passes a signal (env var, config flag, or prompt prefix) that tells GSD commands to use yolo mode — auto-approve all confirmations. Requires each interactive command to respect the flag. The `plan-phase` workflow already supports this; other commands would need auditing.

2. **Pre-seeded answers via stdin**: If cursor-agent supports stdin piping, the orchestrator could feed "yes" responses. Fragile — depends on knowing the exact sequence of prompts, and any new prompt breaks the pipe.

3. **Skip plan-phase entirely, use pre-written plans**: The orchestrator runs `plan-phase` once interactively (human-in-the-loop), then `execute-plan` autonomously. This sidesteps the problem but limits full autonomy — the human must pre-plan all phases before the orchestrator runs.

**Recommended approach**: Option 1 (yolo flag) as primary, Option 3 as fallback for commands that can't be made non-interactive. Audit all GSD commands for AskUserQuestion usage and ensure every one has a yolo-mode bypass.
