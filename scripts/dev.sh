#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

chmod +x bin/gsd-unsupervised
mkdir -p logs

SESSION="gsd-unsupervised"
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Window 0: daemon — shell stays open after crash so you can see the error
tmux new-session -d -s "$SESSION" -n daemon \
  "cd '$ROOT'; ./bin/gsd-unsupervised --goals goals.md --status-server 3000 --verbose 2>&1 | tee logs/orchestrator.log; echo '--- PROCESS EXITED (press Enter) ---'; read"

# Window 1: logs
tmux new-window -t "$SESSION" -n logs \
  "cd '$ROOT' && tail -f logs/orchestrator.log; read"

# Window 2: shell
tmux new-window -t "$SESSION" -n shell "cd '$ROOT' && exec bash"

# Attach directly — no separate command needed
tmux attach -t "$SESSION"
