#!/bin/bash
PROJECT=~/projects/gsd-cli-test
cd $PROJECT
mkdir -p logs
npm run build
echo "Starting orchestrator..."
./bin/gsd-autopilot --goals goals.md --verbose >> logs/orchestrator.log 2>&1 &
echo "PID: $!"
echo "Tailing log... (Ctrl+C to stop monitor, orchestrator keeps running)"
sleep 2
tail -f logs/orchestrator.log
