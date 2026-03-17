#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Thin wrapper around the CLI entrypoint so the daemon can be started via:
#   bin/start-daemon.sh --goals ./goals.md --config ./.autopilot/config.json
#
# All arguments are forwarded to the underlying CLI.
node dist/cli.js "$@"

