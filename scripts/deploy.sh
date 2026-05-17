#!/usr/bin/env bash
# Full-stack atomic blue/green deployment.
#
# Deploys all 4 long-running services (9Router, CrewAI, Soifer, Paseo) using
# blue/green container slots behind a Caddy reverse proxy with port-based routing.
# Health-gates in dependency order. Single Caddy reload switches all upstreams
# atomically. Rolls back automatically if any required service fails health checks.
#
# Usage:
#   ./scripts/deploy.sh                           # deploy all services :latest
#   ./scripts/deploy.sh --service paseo            # deploy only Paseo
#   ./scripts/deploy.sh --build                    # build images locally
#   HEALTH_TIMEOUT=120 ./scripts/deploy.sh         # custom timeout
#
# Prerequisites: docker, docker compose, curl, jq

set -euo pipefail

# H-09: trap handler — on any abnormal exit (failure, SIGINT, SIGTERM), print a
# stack-state snapshot so an operator can diagnose what was running. Does NOT
# auto-clean up containers (deploy.sh handles its own rollback path on required
# failures); the trap is purely diagnostic.
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '[deploy] cleanup: aborted with exit %s — current container state:\n' "$rc" >&2
    docker compose -f "${COMPOSE_PROD:-docker-compose.prod.yml}" -f "${COMPOSE_DEPLOY:-docker-compose.deploy.yml}" ps 2>&1 | sed 's/^/[deploy]   /' >&2 || true
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

# ── Configuration ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_PROD="$PROJECT_ROOT/docker-compose.prod.yml"
COMPOSE_DEPLOY="$PROJECT_ROOT/docker-compose.deploy.yml"
COMPOSE_CMD="docker compose -f $COMPOSE_PROD -f $COMPOSE_DEPLOY"
CONFIG_FILE="$PROJECT_ROOT/scripts/deploy-config.json"

STATE_FILE="$PROJECT_ROOT/.deploy-state"
ROLLBACK_FILE="$PROJECT_ROOT/.deploy-rollback"

HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-30}"

CADDY_CONTAINER="paseo-caddy"

# All deployable services in dependency order
ALL_SERVICES=("9router" "crewai" "soifer" "paseo")

# ── Parse arguments ────────────────────────────────────────
SINGLE_SERVICE=""
BUILD_LOCAL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)  SINGLE_SERVICE="$2"; shift 2 ;;
    --build)    BUILD_LOCAL=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--service <name>] [--build]"
      echo "  --service  Deploy only one service (9router|crewai|soifer|paseo)"
      echo "  --build    Build images locally instead of pulling"
      exit 0 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Helpers ─────────────────────────────────────────────────
log()  { printf '[deploy] %s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { printf '[deploy] %s  WARNING: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FATAL: $*"; exit 1; }

require_cmd() {
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
  done
}

# Read deploy-config.json value via jq
cfg() {
  jq -r "$1" "$CONFIG_FILE"
}

cfg_svc() {
  local svc="$1" field="$2"
  jq -r ".services[\"$svc\"].$field" "$CONFIG_FILE"
}

# ── State management (JSON format) ─────────────────────────
load_state() {
  if [ ! -f "$STATE_FILE" ]; then
    echo "{}"
    return
  fi
  local content
  content=$(cat "$STATE_FILE")
  # Backward compat: plain text = Paseo-only old format
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

service_name() {
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

default_image() {
  local svc="$1"
  cfg_svc "$svc" "imageBase"
}

health_timeout_for() {
  local svc="$1"
  local val
  val=$(cfg_svc "$svc" "healthTimeout")
  if [ "$val" = "null" ] || [ -z "$val" ]; then
    echo "90"
  else
    echo "$val"
  fi
}

drain_timeout_for() {
  local svc="$1"
  local val
  val=$(cfg_svc "$svc" "drainTimeout")
  if [ "$val" = "null" ] || [ -z "$val" ]; then
    echo "$DRAIN_TIMEOUT"
  else
    echo "$val"
  fi
}

is_required() {
  local svc="$1"
  [ "$(cfg_svc "$svc" "required")" = "true" ]
}

health_port() {
  local svc="$1"
  cfg_svc "$svc" "port"
}

health_path() {
  local svc="$1"
  cfg_svc "$svc" "healthPath"
}

# Wait for health check on a container via docker exec.
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

# Gracefully stop a container with connection draining.
drain_and_stop() {
  local ctr="$1" timeout="$2"
  if ! docker ps --format '{{.Names}}' | grep -q "^${ctr}$"; then
    log "$ctr is not running, nothing to drain."
    return 0
  fi
  log "Draining $ctr (${timeout}s grace period)..."
  docker stop --time "$timeout" "$ctr" >/dev/null 2>&1 || true
  log "$ctr stopped."
}

remove_container() {
  local ctr="$1"
  if docker ps -a --format '{{.Names}}' | grep -q "^${ctr}$"; then
    log "Removing $ctr..."
    docker rm -f "$ctr" >/dev/null 2>&1 || true
  fi
}

save_state() {
  local state_json="$1"
  echo "$state_json" > "$STATE_FILE"
  log "Deploy state saved."
}

save_rollback_info() {
  local state_json="$1" old_state_json="$2" images_json="$3"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq -n \
    --argjson current "$state_json" \
    --argjson previous "$old_state_json" \
    --argjson images "$images_json" \
    --arg timestamp "$ts" \
    '{current: $current, previous: $previous, images: $images, timestamp: $timestamp}' \
    > "$ROLLBACK_FILE"
  log "Rollback info saved to .deploy-rollback"
}

# ── OCC preflight check ───────────────────────────────────
check_occ() {
  if command -v occ >/dev/null 2>&1; then
    local ver
    ver=$(occ --version 2>/dev/null || echo "unknown")
    log "OCC binary found: $ver"
  else
    warn "OCC binary not found on host. OCC features will be unavailable in containers."
  fi
}

# ── Preflight ──────────────────────────────────────────────
require_cmd docker curl jq

[ -f "$COMPOSE_PROD" ]   || fail "Missing $COMPOSE_PROD"
[ -f "$COMPOSE_DEPLOY" ] || fail "Missing $COMPOSE_DEPLOY"
[ -f "$CONFIG_FILE" ]    || fail "Missing $CONFIG_FILE"

log "=== Full-Stack Atomic Deploy ==="

# Determine which services to deploy
DEPLOY_SERVICES=()
if [ -n "$SINGLE_SERVICE" ]; then
  found=false
  for svc in "${ALL_SERVICES[@]}"; do
    if [ "$svc" = "$SINGLE_SERVICE" ]; then
      found=true
      break
    fi
  done
  $found || fail "Unknown service: $SINGLE_SERVICE (valid: ${ALL_SERVICES[*]})"
  DEPLOY_SERVICES=("$SINGLE_SERVICE")
  log "Single-service deploy: $SINGLE_SERVICE"
else
  DEPLOY_SERVICES=("${ALL_SERVICES[@]}")
  log "Full-stack deploy: ${ALL_SERVICES[*]}"
fi

check_occ

# ── Step 1: Load current state ────────────────────────────
CURRENT_STATE=$(load_state)
log "Current state: $CURRENT_STATE"

# Track new state, old images (for rollback), new images
declare -A NEW_SLOTS
declare -A OLD_IMAGES
declare -A NEW_IMAGES
declare -A NEW_CONTAINERS

for svc in "${DEPLOY_SERVICES[@]}"; do
  active=$(get_slot_for_service "$svc" "$CURRENT_STATE")
  inactive=$(opposite_slot "$active")
  NEW_SLOTS[$svc]="$inactive"
  log "  $svc: active=$active -> deploying to $inactive"
done

# ── Step 2: Pull/build images for inactive slots ──────────
for svc in "${DEPLOY_SERVICES[@]}"; do
  slot="${NEW_SLOTS[$svc]}"
  img_base=$(default_image "$svc")
  img="${img_base}:latest"
  img_var=$(image_env "$svc" "$slot")

  # Capture old image for rollback.
  # H-10: prefer RepoDigests (immutable sha256 reference) over the tag. Tags
  # can be retagged upstream; a digest pins exactly the layer set that was
  # running before the deploy.
  active=$(get_slot_for_service "$svc" "$CURRENT_STATE")
  if [ "$active" != "none" ]; then
    old_ctr=$(container_name "$svc" "$active")
    old_digest=$(docker inspect --format='{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$old_ctr" 2>/dev/null || echo "")
    if [ -n "$old_digest" ] && [ "$old_digest" != "null" ]; then
      OLD_IMAGES[$svc]="$old_digest"
    else
      # Locally-built images lack a RepoDigest. Fall back to the tag —
      # less safe but better than nothing.
      OLD_IMAGES[$svc]=$(docker inspect --format='{{.Config.Image}}' "$old_ctr" 2>/dev/null || echo "unknown")
    fi
  else
    OLD_IMAGES[$svc]="none"
  fi

  if $BUILD_LOCAL; then
    log "Building $svc image locally..."
    case "$svc" in
      paseo)
        docker build -t "$img" -f "$PROJECT_ROOT/Dockerfile" "$PROJECT_ROOT"
        ;;
      crewai)
        docker build -t "$img" -f "$PROJECT_ROOT/packages/crewai-bridge/Dockerfile" "$PROJECT_ROOT/packages/crewai-bridge"
        ;;
      *)
        warn "No local Dockerfile for $svc, pulling instead."
        docker pull "$img"
        ;;
    esac
  else
    log "Pulling $img..."
    docker pull "$img"
  fi

  # H-10: capture the digest of the image we just pulled so future rollbacks
  # can pin it precisely. Fall back to the tag if no digest is known (locally
  # built image).
  new_digest=$(docker inspect --format='{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$img" 2>/dev/null || echo "")
  if [ -n "$new_digest" ] && [ "$new_digest" != "null" ]; then
    NEW_IMAGES[$svc]="$new_digest"
  else
    NEW_IMAGES[$svc]="$img"
  fi
  export "${img_var}=${img}"
done

# ── Step 3: Start all inactive slot containers ─────────────
for svc in "${DEPLOY_SERVICES[@]}"; do
  slot="${NEW_SLOTS[$svc]}"
  ctr=$(container_name "$svc" "$slot")
  svc_name=$(service_name "$svc" "$slot")
  NEW_CONTAINERS[$svc]="$ctr"

  log "Starting $ctr..."
  remove_container "$ctr"
  $COMPOSE_CMD up -d --no-deps "$svc_name"
done

# ── Step 4: Health-gate in dependency order ────────────────
FAILED_SERVICES=()

for svc in "${DEPLOY_SERVICES[@]}"; do
  ctr="${NEW_CONTAINERS[$svc]}"
  timeout=$(health_timeout_for "$svc")

  if wait_for_health "$ctr" "$svc" "$timeout"; then
    log "$svc: HEALTHY"
  else
    if is_required "$svc"; then
      log "$svc: FAILED (required) — aborting deploy."
      FAILED_SERVICES+=("$svc")
      break
    else
      warn "$svc: FAILED (optional) — continuing without it."
      FAILED_SERVICES+=("$svc")
    fi
  fi
done

# Check if any required service failed
REQUIRED_FAILED=false
for fsvc in "${FAILED_SERVICES[@]}"; do
  if is_required "$fsvc"; then
    REQUIRED_FAILED=true
    break
  fi
done

if $REQUIRED_FAILED; then
  log "ROLLBACK: Required service failed. Tearing down all new slots..."
  for svc in "${DEPLOY_SERVICES[@]}"; do
    ctr="${NEW_CONTAINERS[$svc]}"
    drain_and_stop "$ctr" 10
    remove_container "$ctr"
  done
  log "Rollback complete — previous slots unchanged."
  exit 1
fi

# Stop failed optional services so Caddy does not route to dead containers
for fsvc in "${FAILED_SERVICES[@]}"; do
  ctr="${NEW_CONTAINERS[$fsvc]}"
  warn "Stopping failed optional service: $ctr"
  drain_and_stop "$ctr" 10
  remove_container "$ctr"
  unset "NEW_CONTAINERS[$fsvc]"
done

# ── Step 5: Switch Caddy (single reload for all upstreams) ─
log "Switching Caddy upstreams atomically..."

for svc in "${DEPLOY_SERVICES[@]}"; do
  # Skip services that failed (optional)
  if [ -z "${NEW_CONTAINERS[$svc]:-}" ]; then
    continue
  fi
  ctr="${NEW_CONTAINERS[$svc]}"
  env_name=$(upstream_env "$svc")
  export "${env_name}=${ctr}"
done

# Also export upstreams for services NOT being deployed (keep current)
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
log "Caddy reloaded with new upstreams."

# ── Step 6: Drain old slots (30s grace) ────────────────────
for svc in "${DEPLOY_SERVICES[@]}"; do
  active=$(get_slot_for_service "$svc" "$CURRENT_STATE")
  if [ "$active" = "none" ]; then
    continue
  fi
  old_ctr=$(container_name "$svc" "$active")
  drain_t=$(drain_timeout_for "$svc")
  drain_and_stop "$old_ctr" "$drain_t"
  remove_container "$old_ctr"
done

# ── Step 7: Save state and rollback info ───────────────────
# Build new state JSON: merge current state with new slots
NEW_STATE="$CURRENT_STATE"
for svc in "${DEPLOY_SERVICES[@]}"; do
  if [ -n "${NEW_CONTAINERS[$svc]:-}" ]; then
    NEW_STATE=$(echo "$NEW_STATE" | jq --arg svc "$svc" --arg slot "${NEW_SLOTS[$svc]}" '.[$svc] = $slot')
  fi
done
NEW_STATE=$(echo "$NEW_STATE" | jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {timestamp: $ts}')
save_state "$NEW_STATE"

# Build images JSON for rollback
IMAGES_JSON="{}"
for svc in "${DEPLOY_SERVICES[@]}"; do
  IMAGES_JSON=$(echo "$IMAGES_JSON" | jq \
    --arg svc "$svc" \
    --arg old "${OLD_IMAGES[$svc]:-none}" \
    --arg new "${NEW_IMAGES[$svc]:-none}" \
    '.[$svc] = {old: $old, new: $new}')
done
save_rollback_info "$NEW_STATE" "$CURRENT_STATE" "$IMAGES_JSON"

# ── Step 8: Post-switch verification ───────────────────────
log "Running post-switch verification..."
VERIFY_PASS=true

for svc in "${DEPLOY_SERVICES[@]}"; do
  if [ -z "${NEW_CONTAINERS[$svc]:-}" ]; then
    continue
  fi
  ctr="${NEW_CONTAINERS[$svc]}"
  if wait_for_health "$ctr" "$svc" 15; then
    log "$svc: verified OK"
  else
    warn "$svc: post-switch health check failed"
    VERIFY_PASS=false
  fi
done

if $VERIFY_PASS; then
  log "=== Deploy complete ==="
  for svc in "${DEPLOY_SERVICES[@]}"; do
    if [ -n "${NEW_CONTAINERS[$svc]:-}" ]; then
      log "  $svc: ${NEW_CONTAINERS[$svc]} (${NEW_IMAGES[$svc]})"
    fi
  done
else
  warn "Post-switch verification had failures. Services may be degraded."
  warn "Run: ./scripts/rollback.sh to revert."
  exit 1
fi
