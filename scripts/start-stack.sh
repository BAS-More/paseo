#!/usr/bin/env bash
# Paseo Stack - Startup Script (Linux/Mac)
# Starts: 9Router, CrewAI Bridge, Paseo daemon
# Usage: bash scripts/start-stack.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUTER_DIR="${NINE_ROUTER_DIR:-/opt/9router}"

PIDS=""

cleanup() {
  echo ""
  echo "Shutting down background services..."
  for pid in $PIDS; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

is_port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :"$port" >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -tlnp "sport = :$port" | grep -q LISTEN
  else
    return 1
  fi
}

wait_for_health() {
  local url="$1" name="$2" timeout="${3:-30}"
  local deadline=$((SECONDS + timeout))
  while [ $SECONDS -lt $deadline ]; do
    if curl -sf --max-time 2 "$url" >/dev/null 2>&1; then
      echo "  [OK] $name is healthy"
      return 0
    fi
    sleep 2
  done
  echo "  [FAIL] $name did not respond within ${timeout}s"
  return 1
}

echo ""
echo "=== Paseo Stack ==="
echo ""

# 1. 9Router
if is_port_listening 20128; then
  echo "[1/3] 9Router (:20128) already running - skipping"
elif [ -f "$ROUTER_DIR/package.json" ]; then
  echo "[1/3] Starting 9Router (:20128)..."
  (cd "$ROUTER_DIR" && npm run dev &>/dev/null) &
  PIDS="$PIDS $!"
  wait_for_health "http://localhost:20128/api/init" "9Router" || true
else
  echo "[1/3] 9Router not found at $ROUTER_DIR - skipping"
fi

# 2. CrewAI Bridge
BRIDGE="$ROOT/packages/crewai-bridge/api.py"
if is_port_listening 8000; then
  echo "[2/3] CrewAI Bridge (:8000) already running - skipping"
elif [ -f "$BRIDGE" ]; then
  echo "[2/3] Starting CrewAI Bridge (:8000)..."
  python "$BRIDGE" &>/dev/null &
  PIDS="$PIDS $!"
  wait_for_health "http://localhost:8000/health" "CrewAI Bridge" || true
else
  echo "[2/3] CrewAI bridge not found - skipping"
fi

# 3. Paseo daemon
if is_port_listening 6767; then
  echo "[3/3] Paseo (:6767) already running - skipping"
else
  echo "[3/3] Starting Paseo (:6767)..."
  (cd "$ROOT" && npm run dev &>/dev/null) &
  PIDS="$PIDS $!"
  wait_for_health "http://localhost:6767" "Paseo" || true
fi

# Status table
echo ""
echo "=== Status ==="
for port_name in "20128:9Router" "8000:CrewAI Bridge" "6767:Paseo"; do
  port="${port_name%%:*}"
  name="${port_name#*:}"
  if is_port_listening "$port"; then
    printf "  %-14s :%s  UP\n" "$name" "$port"
  else
    printf "  %-14s :%s  DOWN\n" "$name" "$port"
  fi
done
echo ""
echo "Press Ctrl+C to stop all services."

# Keep alive until interrupted
wait
