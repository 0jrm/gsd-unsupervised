#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

echo "=== GSD WSL Bootstrap Diagnostics ==="
echo

uname_s="$(uname -s 2>/dev/null || echo unknown)"
uname_r="$(uname -r 2>/dev/null || echo unknown)"
is_wsl=false

if [[ "${uname_s}" == "Linux" ]]; then
  if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    is_wsl=true
  elif [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]]; then
    is_wsl=true
  fi
fi

echo "Kernel: ${uname_s} ${uname_r}"

if [[ "${is_wsl}" != true ]]; then
  echo "Environment: not WSL (nothing to bootstrap)"
  exit 0
fi

echo "Environment: WSL detected"
echo

# Workspace path diagnostics
workspace_wsl="${PWD}"
workspace_windows=""
workspace_ok=true

echo "Workspace:"
echo "  WSL path   : ${workspace_wsl}"

if command -v wslpath >/dev/null 2>&1; then
  if workspace_windows="$(wslpath -m "${workspace_wsl}" 2>/dev/null)"; then
    echo "  Windows path: ${workspace_windows}"
  else
    echo "  Windows path: (unable to resolve via wslpath)"
    workspace_ok=false
  fi
else
  echo "  Windows path: (wslpath not available; cannot map automatically)"
  workspace_ok=false
fi

echo

# Cursor binary diagnostics
echo "Cursor agent binary (GSD_CURSOR_BIN):"
if [[ -n "${GSD_CURSOR_BIN:-}" ]]; then
  echo "  Current value : ${GSD_CURSOR_BIN}"
else
  echo "  Current value : (not set)"
fi

cursor_suggestion=""
if [[ -n "${GSD_CURSOR_BIN:-}" ]]; then
  cursor_suggestion="${GSD_CURSOR_BIN}"
elif command -v cursor-agent.exe >/dev/null 2>&1; then
  cursor_suggestion="cursor-agent.exe"
elif command -v cursor-agent >/dev/null 2>&1; then
  cursor_suggestion="cursor-agent"
fi

if [[ -n "${cursor_suggestion}" ]]; then
  echo "  Suggested    : ${cursor_suggestion}"
else
  echo "  Suggested    : (no obvious cursor-agent path found)"
fi

echo

# Clipboard diagnostics
echo "Clipboard executable (GSD_CLIP_EXE):"
if [[ -n "${GSD_CLIP_EXE:-}" ]]; then
  echo "  Current value : ${GSD_CLIP_EXE}"
else
  echo "  Current value : (not set)"
fi

clip_default_win_path="C:\\Windows\\System32\\clip.exe"
clip_suggestion=""

if [[ -n "${GSD_CLIP_EXE:-}" ]]; then
  clip_suggestion="${GSD_CLIP_EXE}"
elif [[ -x "/mnt/c/Windows/System32/clip.exe" ]]; then
  clip_suggestion="${clip_default_win_path}"
else
  # We cannot be sure clip.exe is available; treat this as a best-effort hint only.
  clip_suggestion=""
fi

if [[ -n "${clip_suggestion}" ]]; then
  echo "  Suggested    : ${clip_suggestion}"
else
  echo "  Suggested    : (no clip.exe detected; clipboard integration will be disabled)"
fi

echo

echo "Guidance:"
echo "  - Set GSD_CURSOR_BIN to the Windows or WSL path to your cursor-agent binary."
echo "  - Set GSD_CLIP_EXE to a Windows clip.exe path if you want clipboard support."
echo
echo "Example exports to add to your shell profile (~/.bashrc, ~/.zshrc):"
echo
if [[ -n "${cursor_suggestion}" ]]; then
  echo "  export GSD_CURSOR_BIN=\"${cursor_suggestion}\""
else
  echo "  # export GSD_CURSOR_BIN=\"C:\\\\path\\\\to\\\\cursor-agent.exe\""
fi

if [[ -n "${clip_suggestion}" ]]; then
  echo "  export GSD_CLIP_EXE=\"${clip_suggestion}\""
else
  echo "  # export GSD_CLIP_EXE=\"C:\\\\Windows\\\\System32\\\\clip.exe\""
fi

echo

exit_code=0

if [[ "${workspace_ok}" != true ]]; then
  echo "WARNING: Unable to infer a reliable Windows mapping for the workspace directory."
  exit_code=1
fi

if [[ -z "${clip_suggestion}" ]]; then
  echo "WARNING: Unable to locate clip.exe; clipboard integration will not be available by default."
  # Missing clip.exe alone should not hard-fail, but combined with workspace failures it will
  # be reflected in exit_code when workspace_ok is false.
fi

if [[ "${exit_code}" -eq 0 ]]; then
  echo "Diagnostics: OK (WSL detected, workspace mapping resolved)."
else
  echo "Diagnostics: Incomplete (see warnings above)."
fi

exit "${exit_code}"

