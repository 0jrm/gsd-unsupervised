---
created: 2026-03-16T19:42
title: Watchdog distinguish crash types before restart
area: tooling
files:
  - src/watchdog.ts
  - .planning/STATE.md
---

## Problem

The watchdog restart logic currently has no mechanism to distinguish between a crash that will repeat on retry (deterministic failure) and a transient crash that is recoverable. If a phase consistently fails — e.g., due to a bad plan, missing dependency, or impossible task — the watchdog will loop endlessly restarting the same failing phase.

The watchdog needs to read STATE.md to determine the current phase position, then check whether that same phase has already failed recently. If the same phase has crashed 3+ times, the watchdog should escalate (notify user, skip phase, or halt) instead of blindly restarting.

## Solution

- On crash detection, read `.planning/STATE.md` to identify current phase/plan position
- Maintain a crash counter per phase (in a lightweight file like `.planning/watchdog-state.json` or in-memory with file-backed persistence)
- If same phase has failed 3x consecutively: escalate instead of restart
- Escalation options: log error prominently, create a todo/issue, halt orchestrator with clear message, or prompt user if interactive
- Reset crash counter when phase advances successfully
