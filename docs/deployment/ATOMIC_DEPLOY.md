# Atomic Blue/Green Deployment

Zero-downtime deployment for Paseo daemon using blue/green container slots behind a Caddy reverse proxy.

## Quick Reference

```bash
# Deploy latest
./scripts/deploy.sh

# Deploy specific tag
./scripts/deploy.sh ghcr.io/bas-more/paseo/paseo-daemon:v0.3.1

# Rollback to previous
./scripts/rollback.sh

# Rollback to specific image
./scripts/rollback.sh ghcr.io/bas-more/paseo/paseo-daemon:v0.2.0
```

Windows (Docker Desktop):

```powershell
.\scripts\deploy.ps1
.\scripts\deploy.ps1 -Image "ghcr.io/bas-more/paseo/paseo-daemon:v0.3.1"
.\scripts\rollback.ps1
.\scripts\rollback.ps1 -Image "ghcr.io/bas-more/paseo/paseo-daemon:v0.2.0"
```

## Programs in the Deploy Chain

Eight programs participate in the atomic deployment lifecycle. Each has a distinct role and failure mode.

### 1. Docker Engine

**Role:** Container runtime. Pulls images, starts/stops containers, manages networking.

- Runs the `paseo-blue` and `paseo-green` containers.
- `docker stop --time N` sends SIGTERM, waits N seconds, then SIGKILL.
- The supervisor process inside the container forwards SIGTERM to the daemon worker for graceful shutdown (agent drain, WS close frames, HTTP server close).

**Failure mode:** If Docker is unresponsive, no deploy or rollback is possible. Verify with `docker info`.

### 2. Caddy (Reverse Proxy)

**Role:** TLS termination, HTTP/2, upstream routing, security headers.

- Single entry point on ports 80/443.
- `Caddyfile.deploy` reads `ACTIVE_UPSTREAM` env var to route to either `paseo-blue:6767` or `paseo-green:6767`.
- Admin API on `:2019` (only exposed in deploy mode) allows config inspection.
- Upstream switch is achieved by restarting Caddy with the new `ACTIVE_UPSTREAM` value via `docker compose up -d --no-deps caddy`.

**Failure mode:** If Caddy fails to start with the new config, the deploy script detects this and aborts. Existing connections are held by the old Caddy instance until it terminates.

### 3. PM2 (Process Manager)

**Role:** Process supervision inside the container (non-Docker deployments only).

- `ecosystem.config.cjs` defines the `paseo-daemon` PM2 app.
- `kill_timeout: 30000` gives the daemon 30 seconds to drain before SIGKILL.
- `max_restarts: 15` with `min_uptime: 10s` prevents crash-loop flapping.
- In Docker deployments, the supervisor (`supervisor-entrypoint.ts` + `supervisor.ts`) replaces PM2 and handles SIGTERM forwarding directly.

**Failure mode:** PM2 is not in the Docker deploy path. Relevant only for bare-metal `npm run prod:start` deployments.

### 4. Node.js (Runtime)

**Role:** Executes the Paseo daemon (Express + WebSocket server).

- Container runs `node packages/server/dist/scripts/supervisor-entrypoint.js`.
- Supervisor forks the daemon worker, monitors IPC lifecycle messages (`paseo:ready`, `paseo:shutdown`, `paseo:restart`).
- SIGTERM to supervisor -> SIGTERM to worker -> graceful shutdown: backup, close agents, drain WebSockets, close HTTP server, flush audit log, flush Sentry.

**Failure mode:** If Node crashes during startup, the health check loop detects it (container never reaches `/health/ready`) and the deploy rolls back.

### 5. curl

**Role:** Health check probes during deployment.

- `docker exec <container> curl -sf http://localhost:6767/health/ready` verifies the new container is serving.
- Three health endpoints: `/health/live` (process alive), `/health/startup` (bootstrap complete), `/health/ready` (bootstrap + listening + dependency checks passing).
- Deploy scripts use `/health/ready` as the gate — this confirms bootstrap is complete, the HTTP server is listening, and all dependency checks pass.

**Failure mode:** If curl is missing inside the container, the health check fails. The Dockerfile installs curl in the production stage for this reason.

### 6. Docker Compose

**Role:** Multi-container orchestration. Manages service definitions, networks, volumes, secrets.

- `docker-compose.prod.yml` defines the single-service production stack.
- `docker-compose.deploy.yml` extends it with blue/green slots and the deploy-mode Caddy configuration.
- Compose overlay: `docker compose -f docker-compose.prod.yml -f docker-compose.deploy.yml up -d`.
- Secret injection via Docker secrets (env-based): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PASEO_PASSWORD`.

**Failure mode:** Compose syntax errors are caught at invocation time. Network issues between containers are caught by the health check loop.

### 7. Git

**Role:** Version tagging. Not directly invoked by deploy scripts, but is the source of truth for release versions.

- `scripts/push-current-release-tag.mjs` stamps a git tag matching `package.json` version.
- Docker images are tagged by git SHA and branch in the CI workflow (`deploy-docker.yml`).
- The `.deploy-rollback` file records image tags for traceability.

**Failure mode:** Not in the deploy hot path. If tags are missing, deploy still works with explicit image references.

### 8. GitHub Container Registry (ghcr.io)

**Role:** Image storage. The CI pipeline pushes built images here.

- Images at `ghcr.io/bas-more/paseo/paseo-daemon:<tag>`.
- Tags: `latest` (default branch), `main` (branch), `<sha>` (commit).
- `docker pull` in the deploy script fetches from GHCR.

**Failure mode:** If GHCR is unreachable, `docker pull` fails and the deploy aborts before any slot switch. Rollback may still work if the previous image is cached locally.

## Deployment Flow

```
 1. Pull new image
    docker pull ghcr.io/bas-more/paseo/paseo-daemon:<tag>

 2. Identify active slot
    Read .deploy-state (or detect from running containers)
    Active: blue  =>  Inactive: green  (or vice versa)

 3. Start inactive slot with new image
    PASEO_IMAGE_GREEN=<tag> docker compose ... up -d paseo-green

 4. Health-check loop (up to 90s)
    docker exec paseo-green curl -sf http://localhost:6767/health/ready
    ┌────────────────────────────────────────────┐
    │ FAIL => Remove green, abort. Blue untouched │
    └────────────────────────────────────────────┘

 5. Switch Caddy upstream
    ACTIVE_UPSTREAM=paseo-green docker compose ... up -d caddy
    ┌──────────────────────────────────────────────────┐
    │ Caddy restarts with new upstream. ~1s gap where  │
    │ Caddy is reloading. Browsers retry automatically.│
    └──────────────────────────────────────────────────┘

 6. Drain old slot (30s grace)
    docker stop --time 30 paseo-blue
    ├── SIGTERM → supervisor → worker graceful shutdown
    ├── Close agents, drain WebSockets, close HTTP server
    ├── Flush audit log, flush Sentry
    └── After 30s: SIGKILL if still running

 7. Remove old container
    docker rm -f paseo-blue

 8. Save state
    echo "green" > .deploy-state
    Write .deploy-rollback with previous image info

 9. Final health check on green
    Confirm service is stable after upstream switch
```

## Rollback Procedure

Rollback uses the same blue/green mechanism in reverse.

```
 1. Read .deploy-rollback for previous image
    (or accept explicit image via CLI argument)

 2. Pull previous image (likely cached locally)

 3. Start opposite slot with previous image

 4. Health-check (up to 60s)
    FAIL => Abort. Manual intervention required.

 5. Switch Caddy upstream to rollback slot

 6. Drain current slot (30s)

 7. Save state
```

Time to rollback: **under 60 seconds** (image already cached locally).

## State Files

| File               | Purpose                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.deploy-state`    | Active slot name (`blue` or `green`). Read by deploy/rollback scripts to determine which slot to target next.                                     |
| `.deploy-rollback` | Previous deployment metadata: slot names, image tags, timestamp. Used by `rollback.sh` / `rollback.ps1` for automatic rollback target resolution. |

Both files are gitignored (they are deployment-time artifacts, not source code).

## Configuration

Environment variables for deploy scripts:

| Variable          | Default     | Description                                                        |
| ----------------- | ----------- | ------------------------------------------------------------------ |
| `HEALTH_TIMEOUT`  | `90`        | Seconds to wait for `/health/ready` on the new container           |
| `HEALTH_INTERVAL` | `3`         | Seconds between health check attempts                              |
| `DRAIN_TIMEOUT`   | `30`        | Seconds to wait for graceful shutdown (matches PM2 `kill_timeout`) |
| `PASEO_DOMAIN`    | `localhost` | Domain for Caddy TLS. Set to real domain for Let's Encrypt.        |

PowerShell equivalents are `-HealthTimeout`, `-HealthInterval`, `-DrainTimeout` parameters.

## File Layout

```
paseo/
  docker-compose.prod.yml       # Single-service production stack
  docker-compose.deploy.yml     # Blue/green overlay
  Caddyfile                     # Production Caddy config (single upstream)
  Caddyfile.deploy              # Deploy Caddy config (dynamic upstream, admin API)
  .deploy-state                 # Runtime: active slot (gitignored)
  .deploy-rollback              # Runtime: rollback metadata (gitignored)
  scripts/
    deploy.sh                   # Linux/Mac atomic deploy
    deploy.ps1                  # Windows atomic deploy
    rollback.sh                 # Linux/Mac instant rollback
    rollback.ps1                # Windows instant rollback
  ecosystem.config.cjs          # PM2 config (bare-metal only)
  k8s/                          # Kubernetes manifests (separate deploy path)
```

## Graceful Shutdown Sequence

When `docker stop --time 30` sends SIGTERM to the container:

1. **Supervisor** (`supervisor.ts`) receives SIGTERM, sets `shuttingDown = true`, sends SIGTERM to the worker.
2. **Worker** (`daemon-worker.ts`) calls the bootstrap `stop()` function.
3. **Stop sequence** (`bootstrap.ts`):
   - Stop scheduled backups; run one final backup.
   - Stop loop service.
   - Close all agents (drain agent fleet).
   - Flush agent manager and storage.
   - Shutdown LLM providers.
   - Kill all terminal sessions.
   - Stop speech service.
   - Stop schedule service.
   - Stop relay transport.
   - Close WebSocket server (sends WS close frames to connected clients).
   - Force-drop remaining TCP sockets (`httpServer.closeAllConnections()`).
   - Close HTTP server.
   - Clean up socket files.
   - Close audit logger.
   - Flush Sentry.
4. **Worker exits** with code 0.
5. **Supervisor** detects clean exit, runs `onSupervisorExit` (releases PID lock), exits.
6. **Docker** sees process exit, marks container as stopped.

The 30-second drain timeout is aligned with the PM2 `kill_timeout` and is sufficient for the agent fleet drain documented in ARCH-014.

## Health Check Endpoints

| Endpoint          | Condition                                           | Deploy usage                               |
| ----------------- | --------------------------------------------------- | ------------------------------------------ |
| `/health/live`    | Always 200 once registered                          | Dockerfile HEALTHCHECK, k8s liveness probe |
| `/health/startup` | 200 after `bootstrap()` completes                   | k8s startup probe                          |
| `/health/ready`   | 200 after bootstrap + listening + dependency checks | **Deploy gate** -- used by deploy scripts  |

The deploy scripts use `/health/ready` because it confirms the full initialization chain: config loaded, services started, HTTP server bound, and optional dependency checks (if configured) all passing.

## Relationship to CI/CD

The existing GitHub Actions workflow (`.github/workflows/deploy-docker.yml`) performs a simpler deployment: pull + compose up + health check + rollback on failure. The atomic deploy scripts are designed to be called from that workflow as a drop-in replacement:

```yaml
# In deploy step, replace:
#   docker compose -f docker-compose.prod.yml up -d
# With:
#   ./scripts/deploy.sh ${{ needs.build.outputs.image_tag }}
```

The scripts handle their own rollback, so the separate rollback step in the workflow becomes a safety net rather than the primary mechanism.

## Failure Scenarios

| Scenario                                    | What happens                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| New image fails to pull                     | Deploy aborts immediately. Active slot untouched.                                         |
| New container fails health check            | Container is stopped and removed. Active slot untouched.                                  |
| Caddy fails to reload                       | Deploy script logs a warning. Traffic may be briefly interrupted but Caddy auto-restarts. |
| Old container hangs on SIGTERM              | Docker sends SIGKILL after drain timeout (30s).                                           |
| Deploy script interrupted (Ctrl+C)          | Partial state. Run `rollback.sh` or manually inspect `docker ps`.                         |
| GHCR outage during rollback                 | Rollback still works if previous image is in local Docker cache.                          |
| Disk full                                   | Docker pull fails. Deploy aborts before any switch.                                       |
| Both slots running after interrupted deploy | Next deploy detects active slot from `.deploy-state` and targets the opposite.            |
