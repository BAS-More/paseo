#!/usr/bin/env bash
# Paseo Stack — Stop Script (Linux/Mac)
# Kills services by port: Paseo (6767), CrewAI Bridge (8000), 9Router (20128)
# Usage: bash scripts/stop-stack.sh

set -euo pipefail

ports=(6767 8000 20128)
names=("Paseo" "CrewAI Bridge" "9Router")

echo ""
echo "=== Stopping Paseo Stack ==="
echo ""

for i in "${!ports[@]}"; do
  port="${ports[$i]}"
  name="${names[$i]}"
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "  Stopping $name (PID $pid, :$port)..."
    kill "$pid" 2>/dev/null || true
    echo "  [OK] $name stopped"
  else
    echo "  $name (:$port) not running"
  fi
done

echo ""
echo "=== Stack Stopped ==="
echo ""
