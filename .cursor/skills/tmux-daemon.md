# Skill: tmux daemon management

## Start the daemon

Always use `bash scripts/dev.sh` from the project root.  
Never construct `tmux` one-liners manually — they often break due to quoting.

## Check if running

`tmux ls 2>/dev/null | grep gsd-unsupervised`

## Attach

`tmux attach -t gsd-unsupervised`

## Kill

`tmux kill-session -t gsd-unsupervised`

## Windows

- **0 (daemon)**: the live `gsd-unsupervised` process
- **1 (logs)**: `tail -f logs/orchestrator.log`
- **2 (shell)**: ad-hoc commands

## Dashboard

- `http://localhost:3000/`
- `curl -s http://localhost:3000/api/status | jq`

