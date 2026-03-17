---
phase: 4
plan: 1
subsystem: state-monitoring, parsing
tags: [state-parser, STATE.md, crash-recovery, progress]
requires: [roadmap-parser pattern, stream-events null-on-failure]
provides: [parseStateMd, readStateMd, StateSnapshot]
affects: [orchestrator, Phase 5 crash recovery, Phase 4 watcher]
tech-stack: [typescript, regex, node:fs/promises]
key-files: [src/state-parser.ts, src/state-parser.test.ts]
key-decisions:
  - Parse only "## Current Position" section; null if section or required fields missing
  - Required fields: phase line (with "of"), plan line, status; lastActivity and progressPercent optional
  - progressPercent null when progress line absent or has no percentage
  - readStateMd returns null on missing file or parse failure (no throw)
duration: ~10 minutes
completed: 2026-03-16
---

# 04-01 SUMMARY: STATE.md Parser for Progress and Crash Recovery

## Performance

- **Duration:** ~10 minutes
- **Tests:** 16 (all passing)
- **Files created:** 2 (state-parser.ts, state-parser.test.ts)

## Accomplishments

1. **parseStateMd(content)** — Parses the "## Current Position" section of STATE.md into a typed `StateSnapshot`: phaseNumber, totalPhases, phaseName, planNumber, totalPlans, status, lastActivity, progressPercent (number | null). Returns `null` when the section is missing, content is empty/whitespace, or any required field is missing or malformed (e.g. phase line without "of"). Follows regex-based markdown parsing and null-on-failure pattern from roadmap-parser and stream-events.

2. **readStateMd(filePath)** — Reads the file and returns the result of parseStateMd; returns `null` if the file is missing or unreadable, or if content fails to parse. No exceptions for I/O or parse errors.

3. **Test coverage** — Standard block, in-progress status, plan 1 of 1, missing section, empty/whitespace, malformed phase (no "of"), missing plan/status, progress without percentage, missing progress line, full real STATE.md block, trimming; readStateMd for existing file, missing file, unparseable content.

## Decisions Made

- **Precision for crash recovery:** Phase 5 depends on accurate phase/plan position. The parser returns `null` whenever the Current Position block is incomplete or malformed so the orchestrator never acts on partial or garbage state.
- **Plain interface, no Zod:** StateSnapshot is read-only internal data; validation is via regex and null return, matching plan.
- **Section boundary:** Content after "## Current Position" is taken until the next "## " or EOF; only that block is parsed.

## Next Steps

- 04-02: Chokidar watcher on STATE.md that parses on change and emits progress events.
- 04-03: Daemon/orchestrator wiring so the orchestrator can "see inside" running sessions via STATE.md snapshots.
