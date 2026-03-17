---
phase: 07-WSL-bootstrap
plan: 01
subsystem: infra
tags: [wsl, paths, cursor-agent, clip.exe]

# Dependency graph
requires:
  - phase: 06-Status Server
    provides: HTTP status server and daemon wiring
provides:
  - Centralized WSL detection helpers
  - Shared path resolution for Cursor agent, clip.exe, and workspace display paths
  - WSL-aware bootstrap invoked from CLI startup
affects: [future tooling that shells out via cursor-agent, clipboard utilities, WSL setup flows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WSL detection and path normalization isolated in config helpers"
    - "Environment-aware path resolution consumed by agent invoker and bootstrap"

key-files:
  created:
    - src/config/wsl.ts
    - src/config/paths.ts
    - src/bootstrap/wsl-bootstrap.ts
  modified:
    - src/cursor-agent.ts
    - src/cli.ts
    - README.md

key-decisions:
  - "Treat clipboard integration as optional: when clip.exe cannot be resolved, higher-level tools should gracefully skip clipboard-dependent features"
  - "Centralize all WSL/path-specific logic in config and bootstrap modules instead of scattering detection across the codebase"

patterns-established:
  - "Use helper modules for platform/WSL detection and path conversion"
  - "Prefer environment variables (e.g., GSD_CURSOR_BIN, GSD_CLIP_EXE) as explicit overrides for external tool paths"

issues-created: []

# Metrics
duration: 10min
completed: 2026-03-17
---

# Phase 7 Plan 01: WSL Bootstrap Summary

**WSL-aware helpers now detect WSL, normalize `/mnt/*` paths, resolve Cursor and clip.exe locations, and expose both WSL and Windows workspace paths via a bootstrap wired into the CLI.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-17T14:15:00Z
- **Completed:** 2026-03-17T14:25:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Implemented `isWsl`, `isWindows`, `toWindowsPath`, and `getWindowsRoot` helpers in a focused `src/config/wsl.ts` module with tests.
- Added `src/config/paths.ts` to centralize resolution of Cursor binary, clip.exe, and workspace display paths, including environment-variable overrides and WSL-aware mapping.
- Introduced `src/bootstrap/wsl-bootstrap.ts` and integrated it into CLI startup, while updating `createAgentInvoker` to consume the centralized Cursor path and documenting WSL behavior in `README.md`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add WSL and platform detection helpers** - `b92d4da` (feat)
2. **Task 2: Implement centralized path resolution for Cursor, clip.exe, and workspace** - `65d6951` (feat)
3. **Task 3: Wire WSL bootstrap into the CLI and document behavior** - `954f3cb` (feat)

**Plan metadata:** _present commit_ (docs: complete plan; see below)

## Files Created/Modified
- `src/config/wsl.ts` — WSL/platform detection and WSL→Windows path helpers (`isWsl`, `isWindows`, `toWindowsPath`, `getWindowsRoot`).
- `src/config/wsl.test.ts` — Vitest coverage for WSL helper behavior and path conversion.
- `src/config/paths.ts` — Centralized helper functions for resolving Cursor binary path, clip.exe path, and workspace display paths with WSL awareness.
- `src/config/paths.test.ts` — Tests for path resolution logic, including environment overrides and WSL mappings.
- `src/bootstrap/wsl-bootstrap.ts` — WSL bootstrap that computes resolved environment (Cursor path, clip.exe path, workspace WSL/Windows paths) for the running process.
- `src/cursor-agent.ts` — Agent factory now uses `getCursorBinaryPath` so Cursor invocations go through the shared path resolver.
- `src/cli.ts` — CLI startup now calls `applyWslBootstrap` and logs the resolved environment for easier debugging.
- `README.md` — New “WSL Support & Paths” section describing WSL support, path discovery, and override mechanisms.

## Decisions Made
- Keep WSL detection conservative by combining platform checks, standard WSL environment variables, and `/proc/version` inspection when available.
- Prefer explicit environment variables (`GSD_CURSOR_BIN`, `GSD_CLIP_EXE`) over config defaults so users can override external tool paths without modifying JSON files.
- Treat clipboard integration as optional: when `getClipExePath` returns `null`, callers should skip clipboard features instead of failing the CLI or daemon.
- Keep workspace path mapping best-effort and limited to `/mnt/*` patterns to avoid overfitting to specific host configurations.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- WSL-specific logic is now confined to `src/config/wsl.ts`, `src/config/paths.ts`, and `src/bootstrap/wsl-bootstrap.ts`, and the Cursor agent invoker consumes the centralized path resolver.
- The CLI starts successfully under test conditions with the new bootstrap in place, and path helpers are covered by unit tests.
- Future work that needs Windows-aware paths (e.g., clipboard bridge commands or Windows-native tooling) can build on these helpers without re-implementing WSL detection.

---

*Phase: 07-WSL-bootstrap*
*Completed: 2026-03-17*

