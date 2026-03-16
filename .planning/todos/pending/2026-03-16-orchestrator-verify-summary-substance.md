---
created: 2026-03-16T18:46
title: Orchestrator must verify SUMMARY.md has substance
area: tooling
files:
  - /mnt/c/Users/jrm22n/.cursor/get-shit-done/workflows/execute-plan.md:236-248
  - .cursor/rules/gsd-execute-plan.mdc:53-58
  - .cursor/rules/gsd-execute-phase.mdc:53-57
---

## Problem

After a subagent completes plan execution (Pattern A fully autonomous or Pattern B segments), the orchestrator only checks that the Task tool returned successfully (exit code 0). It does not validate that the SUMMARY.md file actually contains meaningful content.

A subagent could produce a near-empty or boilerplate SUMMARY.md (e.g., just frontmatter, a title, or a few words) and the orchestrator would accept it, proceed to update STATE.md/ROADMAP.md, and commit — masking the fact that the summary is useless for future context or verify-work.

## Solution

Add a SUMMARY.md validation step in the execute-plan workflow after subagent completion (both Pattern A step 5 and Pattern B aggregation step 3.B). The validation should:

1. Check file exists and is non-empty
2. Verify content length > 200 characters (excludes frontmatter)
3. Check for substance markers: contains words like "completed", "tasks", task count references, or file paths
4. If validation fails: warn user, optionally re-run summary generation or prompt for manual review

This applies to both `execute-plan.md` workflow and the rule files `gsd-execute-plan.mdc` / `gsd-execute-phase.mdc`.
