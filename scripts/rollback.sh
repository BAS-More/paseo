#!/usr/bin/env bash
# Full-stack instant rollback to the previous deployment.
#
# Reads .deploy-rollback (JSON, written by deploy.sh) to determine which images
# and slots to restore. Starts previous slots in dependency order, health-checks
# them, switches Caddy atomically, and drains the current slots.
#
# Usage:
#   ./scripts/rollback.sh                              # rollback all services
#   ./scripts/rollback.sh --service paseo               # rollback only Paseo
#   ./scripts/rollback.sh --service paseo --image ghcr.io/bas-more/paseo/paseo-daemon:v0.2.0
#
# Prerequisites: docker, docker compose, curl, jq

set -euo pipefail

# H-09: trap handler — on any abnormal exit, print container state so an
# operator can see whether the rollback finished cleanly. Does NOT delete or
# stop containers; rollback.sh manages that explicitly.
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '[rollback] cleanup: aborted with exit %s — current container state:\n' "$rc" >&2
    docker compose -f "${COMPOSE_PROD:-docker-compose.prod.yml}" -f "${COMPOSE_DEPLOY:-docker-compose.deploy.yml}" ps 2>&1 | sed 's/^/[rollback]   /' >&2 || true
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

# ── Configuration ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_PROD="$PROJECT_ROOT/docker-compose.prod.yml"
COMPOSE_DEPLOY="$PROJECT_ROOT/docker-compose.deploy.yml"
CONFIG_FILE="$PROJECT_ROOT/scripts/deploy-config.json"

STATE_FILE="$PROJECT_ROOT/.deploy-state"
ROLLBACK_FILE="$PROJECT_ROOT/.deploy-rollback"

HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-30}"

ALL_SERVICES=("9router" "crewai" "soifer" "paseo")

# ── Parse arguments ────────────────────────────────────────
SINGLE_SERVICE=""
OVERRIDE_IMAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)  SINGLE_SERVICE="$2"; shift 2 ;;
    --image)    OVERRIDE_IMAGE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--service <name>] [--image <image:tag>]"
      echo "  --service  Rollback only one service"
      echo "  --image    Override rollback image for single-service rollback"
      exit 0 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Helpers ─────────────────────────────────────────────────
log()  { printf '[rollback] %s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { printf '[rollback] %s  WARNING: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FATAL: $*"; exit 1; }

cfg_svc() {
  local svc="$1" field="$2"
  jq -r ".services[\"$svc\"].$field" "$CONFIG_FILE"
}

load_state() {
  if [ ! -f "$STATE_FILE" ]; then
    echo "{}"
    return
  fi
  local content
  content=$(cat "$STATE_FILE")
  if ! echo "$content" | jq empty 2>/dev/null; then
    local old_slot
    old_slot=$(echo "$content" | tr -d '[:space:]')
    echo "{\"paseo\": \"$old_slot\"}"
    return
  fi
  echo "$content"
}

get_slot_for_service() {
  local svc="$1" state="$2"
  echo "$state" | jq -r ".\"$svc\" // \"none\""
}

opposite_slot() {
  case "$1" in
    blue)  echo "green" ;;
    green) echo "blue"  ;;
    none)  echo "blue"  ;;
    *)     fail "Unknown slot: $1" ;;
  esac
}

container_name() {
  local svc="$1" slot="$2"
  echo "${svc}-${slot}"
}

image_env() {
  local svc="$1" slot="$2"
  local prefix
  case "$svc" in
    9router) prefix="ROUTER" ;;
    crewai)  prefix="CREWAI" ;;
    soifer)  prefix="SOIFER" ;;
    paseo)   prefix="PASEO"  ;;
    *)       fail "Unknown service: $svc" ;;
  esac
  echo "${prefix}_IMAGE_$(echo "$slot" | tr '[:lower:]' '[:upper:]')"
}

upstream_env() {
  local svc="$1"
  case "$svc" in
    9router) echo "ACTIVE_ROUTER_UPSTREAM" ;;
    crewai)  echo "ACTIVE_CREWAI_UPSTREAM" ;;
    soifer)  echo "ACTIVE_SOIFER_UPSTREAM" ;;
    paseo)   echo "ACTIVE_PASEO_UPSTREAM"  ;;
    *)       fail "Unknown service: $svc" ;;
  esac
}

health_port() { cfg_svc "$1" "port"; }
health_path() { cfg_svc "$1" "healthPath"; }

wait_for_health() {
  local ctr="$1" svc="$2" timeout="$3"
  local port path deadline
  port=$(health_port "$svc")
  path=$(health_path "$svc")
  deadline=$((SECONDS + timeout))

  log "Waiting up to ${timeout}s for $ctr ${path}..."
  while [ $SECONDS -lt $deadline ]; do
    if docker exec "$ctr" curl -sf --max-time 5 "http://localhost:${port}${path}" >/dev/null 2>&1; then
      log "$ctr is healthy."
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  log "$ctr failed health check after ${timeout}s."
  return 1
}

drain_and_stop() {
  local ctr="$1" timeout="$2"
  if ! docker ps --format '{{.Names}}' | grep -q "^${ctr}$"; then
    log "$ctr is not running."
    return 0
  fi
  log "Draining $ctr (${timeout}s grace period)..."
  docker stop --time "$timeout" "$ctr" >/dev/null 2>&1 || true
  log "$ctr stopped."
}

remove_container() {
  local ctr="$1"
  if docker ps -a --format '{{.Names}}' | grep -q "^${ctr}$"; then
    docker rm -f "$ctr" >/dev/null 2>&1 || true
  fi
}

is_required() {
  [ "$(cfg_svc "$1" "required")" = "true" ]
}

# ── Resolve rollback targets ─────────────────────────────
command -v docker >/dev/null 2>&1 || fail "docker not found"
command -v jq >/dev/null 2>&1     || fail "jq not found"
[ -f "$COMPOSE_PROD" ]   || fail "Missing $COMPOSE_PROD"
[ -f "$COMPOSE_DEPLOY" ] || fail "Missing $COMPOSE_DEPLOY"
[ -f "$CONFIG_FILE" ]    || fail "Missing $CONFIG_FILE"

COMPOSE_CMD="docker compose -f $COMPOSE_PROD -f $COMPOSE_DEPLOY"

# Load rollback metadata
ROLLBACK_DATA="{}"
if [ -f "$ROLLBACK_FILE" ]; then
  ROLLBACK_DATA=$(cat "$ROLLBACK_FILE")
  # Backward compat: old key=value format
  if ! echo "$ROLLBACK_DATA" | jq empty 2>/dev/null; then
    # Parse old format
    old_image=$(grep -oP 'ROLLBACK_TO_IMAGE=\K.*' "$ROLLBACK_FILE" 2>/dev/null || echo "")
    ROLLBACK_DATA=$(jq -n --arg img "$old_image" '{images: {paseo: {old: $img}}}')
  fi
fi

CURRENT_STATE=$(load_state)

# Determine which services to rollback
ROLLBACK_SERVICES=()
if [ -n "$SINGLE_SERVICE" ]; then
  found=false
  for svc in "${ALL_SERVICES[@]}"; do
    [ "$svc" = "$SINGLE_SERVICE" ] && found=true
  done
  $found || fail "Unknown service: $SINGLE_SERVICE"
  ROLLBACK_SERVICES=("$SINGLE_SERVICE")
else
  ROLLBACK_SERVICES=("${ALL_SERVICES[@]}")
fi

log "=== Full-Stack Rollback ==="
log "Services: ${ROLLBACK_SERVICES[*]}"

# Resolve rollback images per service
declare -A ROLLBACK_IMAGES
declare -A TARGET_SLOTS
declare -A TARGET_CONTAINERS

for svc in "${ROLLBACK_SERVICES[@]}"; do
  current_slot=$(get_slot_for_service "$svc" "$CURRENT_STATE")
  target_slot=$(opposite_slot "$current_slot")
  TARGET_SLOTS[$svc]="$target_slot"
  TARGET_CONTAINERS[$svc]=$(container_name "$svc" "$target_slot")

  if [ -n "$OVERRIDE_IMAGE" ] && [ ${#ROLLBACK_SERVICES[@]} -eq 1 ]; then
    ROLLBACK_IMAGES[$svc]="$OVERRIDE_IMAGE"
  else
    img=$(echo "$ROLLBACK_DATA" | jq -r ".images.\"$svc\".old // \"\"" 2>/dev/null || echo "")
    if [ -z "$img" ] || [ "$img" = "null" ] || [ "$img" = "none" ] || [ "$img" = "unknown" ]; then
      if is_required "$svc"; then
        fail "No rollback image found for required service: $svc. Specify --image explicitly."
      else
        warn "No rollback image for optional service: $svc. Skipping."
        unset "TARGET_CONTAINERS[$svc]"
        continue
      fi
    fi
    ROLLBACK_IMAGES[$svc]="$img"
  fi

  log "  $svc: slot $current_slot -> $target_slot (image: ${ROLLBACK_IMAGES[$svc]})"
done

# ── Step 1: Pull rollback images ──────────────────────────
for svc in "${ROLLBACK_SERVICES[@]}"; do
  [ -z "${TARGET_CONTAINERS[$svc]:-}" ] && continue
  img="${ROLLBACK_IMAGES[$svc]}"
  log "Pulling $img..."
  docker pull "$img" || warn "Pull failed for $svc; using local cache if available."
done

# ── Step 2: Start rollback slots ──────────────────────────
for svc in "${ROLLBACK_SERVICES[@]}"; do
  [ -z "${TARGET_CONTAINERS[$svc]:-}" ] && continue
  ctr="${TARGET_CONTAINERS[$svc]}"
  slot="${TARGET_SLOTS[$svc]}"
  img="${ROLLBACK_IMAGES[$svc]}"
  img_var=$(image_env "$svc" "$slot")

  log "Starting $ctr with rollback image..."
  remove_container "$ctr"
  export "${img_var}=${img}"
  $COMPOSE_CMD up -d --no-deps "$(container_name "$svc" "$slot")"
done

# ── Step 3: Health-check in dependency order ──────────────
for svc in "${ROLLBACK_SERVICES[@]}"; do
  [ -z "${TARGET_CONTAINERS[$svc]:-}" ] && continue
  ctr="${TARGET_CONTAINERS[$svc]}"
  timeout_val=$(cfg_svc "$svc" "healthTimeout")
  [ "$timeout_val" = "null" ] && timeout_val=60

  if ! wait_for_health "$ctr" "$svc" "$timeout_val"; then
    if is_required "$svc"; then
      fail "Rollback target $ctr failed health check. Manual intervention required."
    else
      warn "$svc rollback failed health check (optional). Continuing."
      remove_container "$ctr"
      unset "TARGET_CONTAINERS[$svc]"
    fi
  fi
done

# ── Step 4: Switch Caddy atomically ──────────────────────
log "Switching Caddy upstreams..."

for svc in "${ROLLBACK_SERVICES[@]}"; do
  [ -z "${TARGET_CONTAINERS[$svc]:-}" ] && continue
  ctr="${TARGET_CONTAINERS[$svc]}"
  env_name=$(upstream_env "$svc")
  export "${env_name}=${ctr}"
done

# Keep non-rollback services at current upstream
for svc in "${ALL_SERVICES[@]}"; do
  env_name=$(upstream_env "$svc")
  if [ -z "${!env_name:-}" ]; then
    active=$(get_slot_for_service "$svc" "$CURRENT_STATE")
    if [ "$active" != "none" ]; then
      export "${env_name}=$(container_name "$svc" "$active")"
    fi
  fi
done

$COMPOSE_CMD up -d --no-deps caddy
sleep 2

# ── Step 5: Drain old slots ──────────────────────────────
for svc in "${ROLLBACK_SERVICES[@]}"; do
  current_slot=$(get_slot_for_service "$svc" "$CURRENT_STATE")
  [ "$current_slot" = "none" ] && continue
  old_ctr=$(container_name "$svc" "$current_slot")
  drain_t=$(cfg_svc "$svc" "drainTimeout")
  [ "$drain_t" = "null" ] && drain_t="$DRAIN_TIMEOUT"
  drain_and_stop "$old_ctr" "$drain_t"
  remove_container "$old_ctr"
done

# ── Step 6: Save state ───────────────────────────────────
NEW_STATE="$CURRENT_STATE"
for svc in "${ROLLBACK_SERVICES[@]}"; do
  if [ -n "${TARGET_CONTAINERS[$svc]:-}" ]; then
    NEW_STATE=$(echo "$NEW_STATE" | jq --arg svc "$svc" --arg slot "${TARGET_SLOTS[$svc]}" '.[$svc] = $slot')
  fi
done
NEW_STATE=$(echo "$NEW_STATE" | jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {timestamp: $ts}')
echo "$NEW_STATE" > "$STATE_FILE"

log "=== Rollback complete ==="
for svc in "${ROLLBACK_SERVICES[@]}"; do
  if [ -n "${TARGET_CONTAINERS[$svc]:-}" ]; then
    log "  $svc: ${TARGET_CONTAINERS[$svc]} (${ROLLBACK_IMAGES[$svc]})"
  fi
done
