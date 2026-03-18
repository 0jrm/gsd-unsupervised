---
phase: 08-cn-continue-cli
plan: 01
subsystem: infra
tags: [cn, continue-cli, parseCnOutput, runContinueCli, getCnBinaryPath, vitest]

requires:
  - phase: 03-agent-integration
    provides: cursor agent invoker, RunAgentResult, abortAgent
provides:
  - parseCnOutput for cn plain-text output
  - runContinueCli spawn path with timeout/abort
  - continueCliPath config and getCnBinaryPath
affects: [08-02, 08-03]

tech-stack:
  added: []
  patterns:
    - cn outputs plain text; completion via exit code, not NDJSON

key-files:
  created:
    - src/cn-output.ts
    - src/cn-output.test.ts
    - src/cursor-agent.cn.test.ts
  modified:
    - src/cursor-agent.ts
    - src/config.ts
    - src/config/paths.ts

key-decisions:
  - "cn uses single-attempt spawn; no retry (different from cursor)"

patterns-established:
  - "runContinueCli returns RunAgentResult-compatible shape for invoker reuse"

issues-created: []

duration: ~15min
completed: 2026-03-18
---

# Phase 8 Plan 1: cn adapter core Summary

**parseCnOutput, runContinueCli, and getCnBinaryPath enable cn (Continue CLI) as a spawnable agent with plain-text output handling.**

## Accomplishments

- **parseCnOutput** in `src/cn-output.ts`: returns `hasError` (true for "Error:", "Failed") and `summary` (first 200 chars or "No output")
- **runContinueCli** in `src/cursor-agent.ts`: spawns `cn -p "<prompt>" --allow Write() --allow Bash() --allow Read()`, optional `--config`, timeout/abort via tree-kill, returns `RunAgentResult`-compatible shape
- **continueCliPath** in config schema (default `cn`), **getCnBinaryPath** in `paths.ts` (GSD_CN_BIN env, then config)
- Unit tests for parseCnOutput and runContinueCli (exit 0, nonzero, timeout, --config)

## Files Created/Modified

- `src/cn-output.ts` — parseCnOutput
- `src/cn-output.test.ts` — parseCnOutput tests
- `src/cursor-agent.ts` — runContinueCli, imports
- `src/cursor-agent.cn.test.ts` — runContinueCli tests
- `src/config.ts` — continueCliPath
- `src/config/paths.ts` — getCnBinaryPath

## Decisions Made

- cn uses single-attempt spawn; retry can be added later if needed
- No WSL path mapping for cn (simpler; can add later)

## Issues Encountered

None

## Next Step

Ready for 08-02-PLAN.md (Agent registry, createAgentInvoker, GSD rules)
