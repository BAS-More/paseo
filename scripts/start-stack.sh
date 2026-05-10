#!/usr/bin/env bash
# Paseo Stack — Startup Script (Linux/Mac)
# Starts: 9Router, CrewAI Bridge, Paseo daemon
# Usage: bash scripts/start-stack.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUTER_DIR="${NINE_ROUTER_DIR:-$HOME/Dev/tools/9router}"

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

cleanup() {
  echo ""
  echo "Shutting down background services..."
  kill $PIDS 2>/dev/null || true
}
trap cleanup EXIT

PIDS=""

echo ""
echo "=== Paseo Stack ==="
echo ""

# 1. 9Router
if [ -f "$ROUTER_DIR/package.json" ]; then
  echo "[1/3] Starting 9Router (:20128)..."
  (cd "$ROUTER_DIR" && npm run dev &>/dev/null) &
  PIDS="$PIDS $!"
  wait_for_health "http://localhost:20128/api/init" "9Router" || true
else
  echo "[1/3] 9Router not found at $ROUTER_DIR — skipping"
fi

# 2. CrewAI Bridge
BRIDGE="$ROOT/packages/crewai-bridge/api.py"
if [ -f "$BRIDGE" ]; then
  echo "[2/3] Starting CrewAI Bridge (:8000)..."
  python "$BRIDGE" &>/dev/null &
  PIDS="$PIDS $!"
  wait_for_health "http://localhost:8000/health" "CrewAI Bridge" || true
else
  echo "[2/3] CrewAI bridge not found — skipping"
fi

# 3. Paseo
echo "[3/3] Starting Paseo (:6767)..."
(cd "$ROOT" && npm run dev &>/dev/null) &
PIDS="$PIDS $!"
sleep 5
if curl -sf --max-time 3 "http://127.0.0.1:6767/api/status" >/dev/null 2>&1; then
  echo "  [OK] Paseo is healthy"
else
  echo "  [WARN] Paseo may still be starting"
fi

echo ""
echo "=== Paseo Stack Ready ==="
echo "  Paseo:         http://localhost:6767"
echo "  9Router:       http://localhost:20128"
echo "  CrewAI Bridge: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop all services."

# Keep alive until interrupted
wait
