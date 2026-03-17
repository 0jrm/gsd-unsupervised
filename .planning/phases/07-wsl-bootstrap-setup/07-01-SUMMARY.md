---
phase: 07-wsl-bootstrap-setup
plan: 01
subsystem: infra
tags: wsl, bash, bootstrap, gsd-rules

requires:
  - phase: 06-web-dashboard
    provides: dashboard and agent-agnostic stack
provides:
  - Idempotent setup.sh with WSL2 detection and Windows .cursor resolution
  - Repo-local .cursor/rules synced from Windows
  - PROJECT.md Environment/Bootstrap note
affects: []

tech-stack:
  added: []
  patterns: WSL2 path discovery (WIN_HOME/USERPROFILE/$USER), non-destructive rsync/cp for rules

key-files:
  created: setup.sh
  modified: .planning/PROJECT.md

key-decisions:
  - "Standardized on /mnt/c/Users/<user>/.cursor discovery; rsync -a when available, cp fallback; no --delete"

patterns-established: []

issues-created: []

duration: ~5min
completed: 2026-03-16
---

# Phase 7 Plan 01: WSL Bootstrap Script Summary

**WSL-aware setup.sh created: WSL2 detection, Windows .cursor path resolution, and safe idempotent sync of GSD rules into the workspace.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 3
- **Files modified:** 2 (setup.sh created, .planning/PROJECT.md updated)

## Accomplishments

- Implemented WSL2 detection via `/proc/sys/kernel/osrelease` and `/mnt/c` availability check.
- Added Windows user resolution (WIN_HOME → USERPROFILE → `/mnt/c/Users/$USER`) and `.cursor/rules` validation with clear errors when missing.
- Implemented `--check-env` and `--check-cursor` modes for dry-run verification.
- Implemented safe, idempotent sync (rsync -a or cp -r) of GSD rules into repo `.cursor/rules`.
- Updated PROJECT.md with an Environment/Bootstrap section for Phase 7.

## Task Commits

1. **Task 1 & 2: WSL2/env detection and Windows .cursor path resolution** — `d873dd9` (feat)
2. **Task 3: Sync GSD rules and PROJECT.md bootstrap note** — `d73dde7` (feat)

## Files Created/Modified

- `setup.sh` — New WSL bootstrap script: detection, path resolution, rules sync; modes `--check-env`, `--check-cursor`, default bootstrap.
- `.planning/PROJECT.md` — Environment/Bootstrap subsection documenting setup.sh and Phase 7.

## Decisions Made

- Standardized on WSL2 + `/mnt/c/Users/<user>/.cursor` discovery for locating GSD rules.
- Non-destructive copy/sync only (no rsync --delete, no removal of workspace `.cursor` contents).

## Deviations from Plan

None — plan executed as written.

## Issues Encountered

None.

## Next Phase Readiness

- Ready for 07-02-PLAN.md (validation modes, smoke checks, human-verify checkpoint).

---
*Phase: 07-wsl-bootstrap-setup*
*Completed: 2026-03-16*
