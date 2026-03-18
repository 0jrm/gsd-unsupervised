#!/usr/bin/env bash
# setup.sh — interactive first-run wizard for gsd-unsupervised
#
# Root cause of broken init flow (discovery from 09-02 Task 1):
# - init command EXISTS in src/cli.ts and delegates to init-wizard.ts
# - init-wizard writes .gsd/state.json with: mode, project, workspaceRoot, goalsPath, statusServerPort
# - run script expects: mode, statusServerPort, goalsPath (node -e reads from state)
# - run command in cli.ts reads state via readGsdStateFromPath, uses workspaceRoot, goalsPath
# - The init wizard asks different questions (project name, repo path, first goal, twilio, ngrok)
#   and doesn't expose agent type or port. setup.sh provides simpler 3-question flow + agent choice.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATE="$ROOT/.gsd/state.json"
GOALS="$ROOT/goals.md"

# Already initialized?
if [ -f "$STATE" ]; then
  echo "Already initialized. Edit .gsd/state.json to change settings."
  exit 0
fi

echo ""
echo "  gsd-unsupervised setup"
echo ""

# 1. Agent type
printf "  Agent type [cursor]: "
read -r AGENT
AGENT="${AGENT:-cursor}"

# 2. Goals file path
printf "  Goals file path [./goals.md]: "
read -r GOALS_PATH
GOALS_PATH="${GOALS_PATH:-./goals.md}"

# 3. Status server port
printf "  Status server port [3000]: "
read -r PORT
PORT="${PORT:-3000}"

# 4. Twilio (optional)
printf "  Twilio SMS notifications? (y/N): "
read -r TWILIO
TWILIO="${TWILIO:-n}"

mkdir -p "$ROOT/.gsd"

# Write .gsd/state.json (run script expects: mode, statusServerPort, goalsPath)
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat > "$STATE" << EOF
{
  "mode": "self",
  "project": "gsd-unsupervised",
  "agent": "$AGENT",
  "goalsPath": "$GOALS_PATH",
  "statusServerPort": $PORT,
  "workspaceRoot": ".",
  "createdAt": "$NOW"
}
EOF

# Twilio credentials to .env
if [ "${TWILIO,,}" = "y" ] || [ "${TWILIO,,}" = "yes" ]; then
  ENV_FILE="$ROOT/.env"
  if [ ! -f "$ENV_FILE" ]; then
    touch "$ENV_FILE"
  fi
  {
    echo ""
    echo "# Twilio SMS — never commit .env"
    echo "TWILIO_ACCOUNT_SID="
    echo "TWILIO_AUTH_TOKEN="
    echo "TWILIO_FROM="
    echo "TWILIO_TO="
  } >> "$ENV_FILE"
  echo "  Added Twilio placeholders to .env — fill in credentials."
fi

# Create goals.md if absent
RESOLVED_GOALS="$ROOT/goals.md"
if [ "$GOALS_PATH" != "./goals.md" ]; then
  RESOLVED_GOALS="$ROOT/${GOALS_PATH#./}"
fi
if [ ! -f "$RESOLVED_GOALS" ]; then
  mkdir -p "$(dirname "$RESOLVED_GOALS")"
  cat > "$RESOLVED_GOALS" << 'GOALS'
# Goals

## Pending
- [ ] My first goal — describe what you want to build

## In Progress

## Done
GOALS
  echo "  Created goals.md"
fi

# Build dist
if [ -f "$ROOT/package.json" ]; then
  (cd "$ROOT" && npm run build 2>/dev/null) || true
fi

echo ""
echo "  ✓ Initialized! Next steps:"
echo "    1. Edit goals.md and add your first goal"
echo "    2. Run ./run to start the daemon"
echo "    3. Run: tmux attach -t gsd-self  to watch it work"
echo "    Docs: https://github.com/0jrm/gsd-unsupervised"
echo ""
