#!/usr/bin/env bash
set -euo pipefail

# GSD Autopilot — WSL bootstrap script (Phase 7)
# Detects WSL2, resolves Windows .cursor path, syncs GSD rules into the repo.

log() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }

# --- Modes: --check-env (detection only), --check-cursor (path only), default = full bootstrap ---
MODE="bootstrap"
for arg in "$@"; do
  case "$arg" in
    --check-env)   MODE="check-env"; break ;;
    --check-cursor) MODE="check-cursor"; break ;;
    -h|--help)
      log "Usage: $0 [--check-env | --check-cursor]"
      log "  --check-env    Print WSL2/env detection only (no changes)."
      log "  --check-cursor Print Windows .cursor path only (no copy)."
      log "  (no args)      Full bootstrap: detect, resolve, sync GSD rules."
      exit 0
      ;;
  esac
done

# --- Task 1: WSL2 and environment detection ---
detect_wsl() {
  local osrelease
  if [[ ! -f /proc/sys/kernel/osrelease ]]; then
    err "Not running under WSL: /proc/sys/kernel/osrelease not found."
    return 1
  fi
  osrelease=$(cat /proc/sys/kernel/osrelease 2>/dev/null || true)
  if [[ ! "$osrelease" =~ [Mm]icrosoft-standard-WSL2 ]]; then
    err "This script requires WSL2. Detected: $osrelease"
    err "Install WSL2 or run this script inside a WSL2 environment."
    return 1
  fi
  return 0
}

check_mnt_c() {
  if [[ ! -d /mnt/c ]] || [[ ! -r /mnt/c ]]; then
    err "Windows C: drive not available at /mnt/c."
    err "Ensure WSL has access to the Windows filesystem (e.g. wsl --mount)."
    return 1
  fi
  return 0
}

# Derive Windows username: WIN_HOME (path) -> USERPROFILE (path) -> $USER under /mnt/c/Users
get_windows_user() {
  local win_user
  if [[ -n "${WIN_HOME:-}" ]]; then
    # WIN_HOME might be /mnt/c/Users/joe
    if [[ "$WIN_HOME" =~ /mnt/c/Users/([^/]+) ]]; then
      printf '%s' "${BASH_REMATCH[1]}"
      return 0
    fi
  fi
  if [[ -n "${USERPROFILE:-}" ]]; then
    # USERPROFILE might be C:\Users\joe -> extract "joe"
    win_user="${USERPROFILE//\\/\/}"
    if [[ "$win_user" =~ [Uu]sers/([^/]+) ]]; then
      printf '%s' "${BASH_REMATCH[1]}"
      return 0
    fi
  fi
  if [[ -d /mnt/c/Users/"${USER:-}" ]]; then
    printf '%s' "$USER"
    return 0
  fi
  return 1
}

run_check_env() {
  log "=== WSL environment check ==="
  if ! detect_wsl; then exit 1; fi
  log "WSL: WSL2 detected."
  if ! check_mnt_c; then exit 1; fi
  log "/mnt/c: present and readable."
  local win_user
  if win_user=$(get_windows_user); then
    log "Windows user (candidate): $win_user"
    log "Windows .cursor path: /mnt/c/Users/$win_user/.cursor"
  else
    err "Could not determine Windows user. Set WIN_HOME or USERPROFILE, or ensure /mnt/c/Users/\$USER exists."
    exit 1
  fi
  return 0
}

# --- Task 2: Resolve Windows .cursor path and locate GSD rules ---
resolve_cursor_path() {
  local win_user
  win_user=$(get_windows_user) || true
  if [[ -z "$win_user" ]]; then
    err "Cannot resolve Windows user. Set WIN_HOME or USERPROFILE, or ensure /mnt/c/Users/\$USER exists."
    return 1
  fi
  CURSOR_DIR="/mnt/c/Users/$win_user/.cursor"
  RULES_SRC="$CURSOR_DIR/rules"
  if [[ ! -d "$CURSOR_DIR" ]]; then
    err "Windows .cursor directory not found: $CURSOR_DIR"
    err "Install Cursor on Windows and ensure the .cursor folder exists under your Windows user profile."
    return 1
  fi
  if [[ ! -d "$RULES_SRC" ]]; then
    err "GSD rules directory not found: $RULES_SRC"
    err "Install the GSD framework rules in Cursor (Windows) so that .cursor/rules exists."
    return 1
  fi
  log "Resolved Windows .cursor/rules: $RULES_SRC"
  return 0
}

run_check_cursor() {
  if ! detect_wsl || ! check_mnt_c; then exit 1; fi
  if ! resolve_cursor_path; then exit 1; fi
  return 0
}

# --- Task 3: Copy or sync GSD rules into the workspace safely ---
sync_rules() {
  local dest_dir
  dest_dir="${1:-.cursor/rules}"
  if [[ -z "$RULES_SRC" ]] || [[ ! -d "$RULES_SRC" ]]; then
    err "Source rules path not set or missing. Run path resolution first."
    return 1
  fi
  mkdir -p "$dest_dir"
  if command -v rsync &>/dev/null; then
    log "Syncing GSD rules (rsync) from $RULES_SRC to $dest_dir"
    rsync -a --exclude='.git' "$RULES_SRC/" "$dest_dir/"
  else
    log "Copying GSD rules (cp) from $RULES_SRC to $dest_dir"
    cp -r "$RULES_SRC"/* "$dest_dir/" 2>/dev/null || cp -r "$RULES_SRC"/. "$dest_dir/"
  fi
  log "Rules synced successfully. You can re-run this script to refresh (idempotent)."
  return 0
}

# --- Main ---
case "$MODE" in
  check-env)
    run_check_env
    exit 0
    ;;
  check-cursor)
    run_check_cursor
    exit 0
    ;;
  bootstrap)
    if ! detect_wsl || ! check_mnt_c; then exit 1; fi
    if ! resolve_cursor_path; then exit 1; fi
    REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    sync_rules "$REPO_ROOT/.cursor/rules"
    log "Bootstrap complete. Run with --check-env or --check-cursor to verify."
    exit 0
    ;;
  *)
    err "Unknown mode: $MODE"
    exit 1
    ;;
esac
