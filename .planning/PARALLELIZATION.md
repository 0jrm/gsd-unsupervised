# Parallelization Plan

This document captures a snapshot analysis of the current `goals.md` queue and how it should be parallelized by the daemon.

## Queue Overview

Source: `goals.md`

- **Pending goals**:
  - `Complete Phase 4: State Monitoring & Phase Transitions — execute plans 04-02 and 04-03`
  - `Complete Phase 5: Crash Detection & Recovery`
  - `5-crash-detection-recovery`
  - `Debug & fix STATE.md not updating during GSD lifecycle`
  - `Add recursive subagent support: daemon can spawn cursor-agent subprocess for complex plans, subagent can spawn further specialist agents. Use existing invocation pattern: cursor-agent --workspace <path> "<prompt>". Wire into orchestrator as an optional execution mode per plan.`
  - `Complete Phase 6: Web Dashboard with SSE live feed`
  - `Complete Phase 7: WSL Bootstrap & Setup`

## Dependency & Parallelization Strategy

- **Phase completion goals** (Phases 4–7) are logically sequential, but the underlying work for Phase 5 (`5-crash-detection-recovery`) and Phase 4 debug tasks can be explored in parallel while earlier phases are being wrapped up.
- The **STATE.md debug goal** and **recursive subagent support** are implementation-level tasks that can safely run in parallel with high-level “complete phase” tracking goals, as long as Git gating and checkpoints remain enabled.
- There are no explicit `dependsOn` or `parallelGroup` annotations in `goals.md` yet, so the planner currently:
  - Respects the existing queue order.
  - Allows **limited parallelism** at the daemon level when `parallelization.enabled` is turned on via the status dashboard.

## maxConcurrent Recommendation

- Machine headroom is guarded by the **resource governor** using `maxCpuFraction`.
- Given the current queue and typical agent load, a conservative yet useful level of parallelism is:
  - **`maxConcurrent = 2`** — at most two goals may be in-flight when parallelization is enabled.

This value is now wired via `.planning/config.json` and overrides the default `maxConcurrent` field in the autopilot config.

