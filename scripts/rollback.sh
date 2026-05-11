#!/usr/bin/env bash
# Paseo — Instant rollback to the previous deployment.
#
# Reads .deploy-rollback (written by deploy.sh) to determine which image
# to restore. Starts the previous slot, health-checks it, switches Caddy,
# and drains the current slot.
#
# Usage:
#   ./scripts/rollback.sh                          # rollback to previous
#   ./scripts/rollback.sh ghcr.io/bas-more/paseo/paseo-daemon:v0.2.0  # rollback to specific image
#
# Prerequisites: docker, docker compose, curl

set -euo pipefail

# ── Configuration ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_PROD="$PROJECT_ROOT/docker-compose.prod.yml"
COMPOSE_DEPLOY="$PROJECT_ROOT/docker-compose.deploy.yml"

STATE_FILE="$PROJECT_ROOT/.deploy-state"
ROLLBACK_FILE="$PROJECT_ROOT/.deploy-rollback"

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-30}"

# ── Helpers (same as deploy.sh) ─────────────────────────────
log()  { printf '[rollback] %s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FATAL: $*"; exit 1; }

get_active_slot() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
    return
  fi
  if docker ps --format '{{.Names}}' | grep -q '^paseo-blue$'; then
    echo "blue"
  elif docker ps --format '{{.Names}}' | grep -q '^paseo-green$'; then
    echo "green"
  else
    echo "none"
  fi
}

opposite_slot() {
  case "$1" in
    blue)  echo "green" ;;
    green) echo "blue"  ;;
    none)  echo "blue"  ;;
    *)     fail "Unknown slot: $1" ;;
  esac
}

container_name() { echo "paseo-$1"; }
service_name()   { echo "paseo-$1"; }
image_env()      { echo "PASEO_IMAGE_$(echo "$1" | tr '[:lower:]' '[:upper:]')"; }

wait_for_health() {
  local container="$1"
  local timeout="$2"
  local deadline=$((SECONDS + timeout))

  log "Waiting up to ${timeout}s for $container /health/ready..."
  while [ $SECONDS -lt $deadline ]; do
    if docker exec "$container" curl -sf --max-time 5 http://localhost:6767/health/ready >/dev/null 2>&1; then
      log "$container is healthy."
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  log "$container failed health check after ${timeout}s."
  return 1
}

drain_and_stop() {
  local container="$1"
  local timeout="$2"

  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    log "$container is not running."
    return 0
  fi

  log "Draining $container (${timeout}s grace period)..."
  docker stop --time "$timeout" "$container" >/dev/null 2>&1 || true
  log "$container stopped."
}

remove_container() {
  local container="$1"
  if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
}

# ── Resolve rollback target ────────────────────────────────
ROLLBACK_IMAGE="${1:-}"

if [ -z "$ROLLBACK_IMAGE" ]; then
  if [ ! -f "$ROLLBACK_FILE" ]; then
    fail "No .deploy-rollback file found and no image specified. Cannot determine rollback target."
  fi

  # shellcheck source=/dev/null
  source "$ROLLBACK_FILE"
  ROLLBACK_IMAGE="${ROLLBACK_TO_IMAGE:-}"

  if [ -z "$ROLLBACK_IMAGE" ] || [ "$ROLLBACK_IMAGE" = "unknown" ]; then
    fail "Rollback file exists but ROLLBACK_TO_IMAGE is empty. Specify an image explicitly."
  fi

  log "Rollback file found. Previous image: $ROLLBACK_IMAGE"
fi

# ── Preflight ──────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "docker not found"
[ -f "$COMPOSE_PROD" ]   || fail "Missing $COMPOSE_PROD"
[ -f "$COMPOSE_DEPLOY" ] || fail "Missing $COMPOSE_DEPLOY"

CURRENT_SLOT=$(get_active_slot)
TARGET_SLOT=$(opposite_slot "$CURRENT_SLOT")

log "=== Paseo Rollback ==="
log "Current slot:  $CURRENT_SLOT"
log "Target slot:   $TARGET_SLOT"
log "Rollback image: $ROLLBACK_IMAGE"

# ── Step 1: Pull rollback image (may already be cached) ────
log "Pulling $ROLLBACK_IMAGE..."
docker pull "$ROLLBACK_IMAGE" || log "WARNING: Pull failed; using local cache if available."

# ── Step 2: Start rollback slot ────────────────────────────
TARGET_CONTAINER=$(container_name "$TARGET_SLOT")
TARGET_SERVICE=$(service_name "$TARGET_SLOT")
TARGET_IMAGE_ENV=$(image_env "$TARGET_SLOT")

log "Starting $TARGET_CONTAINER with rollback image..."
remove_container "$TARGET_CONTAINER"

export "${TARGET_IMAGE_ENV}=${ROLLBACK_IMAGE}"
docker compose -f "$COMPOSE_PROD" -f "$COMPOSE_DEPLOY" up -d --no-deps "$TARGET_SERVICE"

# ── Step 3: Health-check ───────────────────────────────────
if ! wait_for_health "$TARGET_CONTAINER" "$HEALTH_TIMEOUT"; then
  fail "Rollback target $TARGET_CONTAINER failed health check. Manual intervention required."
fi

# ── Step 4: Switch Caddy ───────────────────────────────────
log "Switching Caddy upstream to $TARGET_CONTAINER..."
ACTIVE_UPSTREAM="$TARGET_CONTAINER" docker compose -f "$COMPOSE_PROD" -f "$COMPOSE_DEPLOY" up -d --no-deps caddy
sleep 2

# ── Step 5: Drain old slot ─────────────────────────────────
if [ "$CURRENT_SLOT" != "none" ]; then
  CURRENT_CONTAINER=$(container_name "$CURRENT_SLOT")
  drain_and_stop "$CURRENT_CONTAINER" "$DRAIN_TIMEOUT"
  remove_container "$CURRENT_CONTAINER"
fi

# ── Step 6: Save state ────────────────────────────────────
echo "$TARGET_SLOT" > "$STATE_FILE"

log "=== Rollback complete ==="
log "Active: $TARGET_CONTAINER ($ROLLBACK_IMAGE)"
