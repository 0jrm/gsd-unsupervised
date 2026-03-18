# WSL Bootstrap & Diagnostics

This project is WSL-aware and includes helpers and a diagnostics script to make it easy to understand how paths and clipboard integration behave when running under WSL2.

The goal is to help you:

- Confirm whether you are running under WSL.
- See how your workspace path maps from WSL to Windows.
- Understand how the CLI resolves the Cursor agent binary and `clip.exe`.
- Configure `GSD_CURSOR_BIN` and `GSD_CLIP_EXE` explicitly when needed.

## How WSL is detected

WSL detection and basic path helpers live in `src/config/wsl.ts`:

- `isWsl()` — returns `true` when the current process appears to be running under WSL (Linux kernel + WSL-specific env vars or `/proc/version` markers).
- `isWindows()` — simple platform check for native Windows processes.
- `getWindowsRoot()` — returns the standard WSL mount root (currently `/mnt/c`) when running under WSL, or `null` otherwise.
- `toWindowsPath(wslPath: string)` — converts `/mnt/<drive>/...` WSL paths to Windows-style `X:\...` paths when possible (e.g. `/mnt/c/Users/foo` → `C:\Users\foo`).

These helpers are intentionally conservative: if a path cannot be safely converted, they return `null` and leave the caller to handle the absence of a Windows mapping.

## Path resolution under WSL

Centralized path resolution for the Cursor agent, clipboard integration, and workspace display paths lives in `src/config/paths.ts`:

- `getCursorBinaryPath(config)`:
  - Prefers the `GSD_CURSOR_BIN` environment variable when set.
  - Falls back to `config.cursorAgentPath` from the autopilot config.
  - Finally falls back to `cursor-agent` if neither is provided.
  - When running under WSL and `cursorAgentPath` is a `/mnt/*` path, it attempts to map that to a Windows-style path using `toWindowsPath`.
- `getClipExePath()`:
  - When *not* running under WSL: returns `null` (clipboard integration is disabled by default).
  - Under WSL:
    - Prefers `GSD_CLIP_EXE` if set.
    - Otherwise, if `/mnt/c/Windows/System32/clip.exe` exists, returns `C:\Windows\System32\clip.exe` as a safe default.
    - If neither check succeeds, returns `null`.
- `getWorkspaceDisplayPath(workspaceRoot)`:
  - Always returns the WSL path.
  - When under WSL, also returns a best-effort Windows mapping using `toWindowsPath`, or `null` if no mapping can be inferred.

Higher-level code treats clipboard support as **optional**: when `getClipExePath()` returns `null`, clipboard-related features should simply be skipped instead of failing the CLI or daemon.

## WSL bootstrap in the CLI

The CLI wires these helpers together via `src/bootstrap/wsl-bootstrap.ts`:

- `applyWslBootstrap(config)`:
  - Uses `isWsl()` to decide whether WSL is active.
  - Resolves the effective Cursor agent path via `getCursorBinaryPath(config)`.
  - Resolves the clipboard executable via `getClipExePath()`.
  - Computes the workspace display paths via `getWorkspaceDisplayPath(config.workspaceRoot)`.
  - Returns a `ResolvedEnvironment` object that the CLI logs at startup for debugging.

`src/cli.ts` calls `applyWslBootstrap(config)` early in its default action and logs the resolved environment (whether WSL is detected, which Cursor binary path will be used, what `clip.exe` path was chosen if any, and how the workspace root is represented).

## The `scripts/bootstrap-wsl.sh` diagnostics script

For quick, one-off checks from your WSL shell, use the diagnostics script:

```bash
bash scripts/bootstrap-wsl.sh
```

From the project root on WSL2, the script:

1. Detects whether it is running under WSL (via `uname`, `/proc/version`, and typical WSL env vars like `WSL_DISTRO_NAME`).
2. Prints your current workspace path (from `$PWD`) and, when possible, a Windows mapping using `wslpath -m`.
3. Inspects `GSD_CURSOR_BIN` and `GSD_CLIP_EXE`, showing their current values (or that they are unset).
4. Suggests reasonable values for both variables based on what it can detect on your system (e.g. `cursor-agent`, `cursor-agent.exe`, or `C:\Windows\System32\clip.exe`).
5. Prints example `export` lines you can paste into your shell profile.
6. Exits with:
   - `0` when WSL is detected and a workspace Windows mapping could be inferred.
   - `0` when not running under WSL (there is nothing to bootstrap).
   - Non-zero when WSL is detected but a safe Windows mapping for the workspace cannot be inferred.

The script is **idempotent** and non-destructive: it does not modify files or environment variables; it only prints diagnostics and suggested configuration.

### Example output

On a typical WSL2 install, you might see something like:

```text
=== GSD WSL Bootstrap Diagnostics ===

Kernel: Linux 6.6.87.2-microsoft-standard-WSL2
Environment: WSL detected

Workspace:
  WSL path   : /home/you/projects/gsd-unsupervised
  Windows path: C:\Users\you\projects\gsd-unsupervised

Cursor agent binary (GSD_CURSOR_BIN):
  Current value : (not set)
  Suggested    : cursor-agent

Clipboard executable (GSD_CLIP_EXE):
  Current value : (not set)
  Suggested    : C:\Windows\System32\clip.exe

Guidance:
  - Set GSD_CURSOR_BIN to the Windows or WSL path to your cursor-agent binary.
  - Set GSD_CLIP_EXE to a Windows clip.exe path if you want clipboard support.

Example exports to add to your shell profile (~/.bashrc, ~/.zshrc):

  export GSD_CURSOR_BIN="cursor-agent"
  export GSD_CLIP_EXE="C:\Windows\System32\clip.exe"

Diagnostics: OK (WSL detected, workspace mapping resolved).
```

### Exit status and troubleshooting

- If the script cannot infer a Windows mapping for your workspace but *can* still find a plausible `clip.exe` path, it will:
  - Print a warning about the workspace mapping.
  - Exit with a non-zero status so you can detect the problem in automation.
- If the script cannot find a plausible `clip.exe` path, it will:
  - Print a warning that clipboard integration will not be available by default.
  - Keep the exit status determined by the workspace mapping (clipboard is optional).

In all cases, the script will tell you exactly what it discovered so you can adjust `GSD_CURSOR_BIN` and `GSD_CLIP_EXE` manually if needed.

## Recommended environment variable configuration

On a typical WSL2 + Cursor installation where Cursor and `clip.exe` are installed on the Windows side, reasonable values are:

```bash
export GSD_CURSOR_BIN="cursor-agent"                 # Or cursor-agent.exe if that is how it appears in PATH
export GSD_CLIP_EXE="C:\\Windows\\System32\\clip.exe"
```

Add these exports to your WSL shell profile (e.g. `~/.bashrc` or `~/.zshrc`) and restart your shell. After that:

1. Re-run `bash scripts/bootstrap-wsl.sh` to confirm the variables are picked up.
2. Start the daemon as usual; `src/cli.ts` will log the resolved environment including the Cursor binary and clipboard path.

With this in place, WSL-specific behavior should be predictable, and the autonomous daemon can use the correct paths without additional manual configuration.

