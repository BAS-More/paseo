# Atomic Blue/Green Deployment

Zero-downtime deployment for the full 5-service Soifer Platform stack using blue/green container slots behind a Caddy reverse proxy with port-based routing.

## Service Topology

| Service        | Port  | Health Endpoint | Required | Deploy Order   |
| -------------- | ----- | --------------- | -------- | -------------- |
| 9Router        | 20128 | `/api/health`   | yes      | 1              |
| CrewAI Bridge  | 8000  | `/health`       | no       | 2              |
| Soifer Backend | 3001  | `/health`       | yes      | 3              |
| Paseo          | 6767  | `/health/ready` | yes      | 4              |
| OCC            | n/a   | `occ --version` | no       | preflight only |

Deploy order follows dependency: 9Router must be up before Soifer and Paseo can route LLM calls through it. CrewAI is optional -- deploy continues with a warning if it fails.

OCC is a host binary, not a containerized service. It is version-checked during preflight and mounted as a read-only volume into Paseo and Soifer containers.

```
                          Caddy (sole ingress)
                ┌──────────────┼──────────────┐
                │              │              │
          :6767 │        :3001 │       :20128 │       :8000
                │              │              │          │
        ┌───────┴───────┐ ┌───┴───┐   ┌──────┴─────┐ ┌─┴──────┐
        │ paseo-blue/   │ │soifer-│   │ 9router-   │ │crewai- │
        │ paseo-green   │ │blue/  │   │ blue/green │ │blue/   │
        │               │ │green  │   │            │ │green   │
        └───────────────┘ └───────┘   └────────────┘ └────────┘
```

## Quick Reference

```bash
# Deploy all services (latest)
./scripts/deploy.sh

# Deploy single service
./scripts/deploy.sh --service paseo

# Build locally instead of pulling
./scripts/deploy.sh --build

# Rollback all services
./scripts/rollback.sh

# Rollback single service to specific image
./scripts/rollback.sh --service paseo --image ghcr.io/bas-more/paseo/paseo-daemon:v0.2.0
```

Windows (Docker Desktop):

```powershell
.\scripts\deploy.ps1
.\scripts\deploy.ps1 -Service paseo
.\scripts\deploy.ps1 -Build
.\scripts\rollback.ps1
.\scripts\rollback.ps1 -Service paseo -Image "ghcr.io/bas-more/paseo/paseo-daemon:v0.2.0"
```

## Programs in the Deploy Chain

Eight programs participate in the atomic deployment lifecycle. Each has a distinct role and failure mode.

### 1. Docker Engine

**Role:** Container runtime. Pulls images, starts/stops containers, manages networking.

- Runs blue and green slots for each service (e.g. `paseo-blue`, `soifer-green`).
- `docker stop --time N` sends SIGTERM, waits N seconds, then SIGKILL.
- Node.js containers: supervisor forwards SIGTERM to daemon worker for graceful shutdown.
- Python containers (CrewAI): uvicorn handles SIGTERM natively.

**Failure mode:** If Docker is unresponsive, no deploy or rollback is possible. Verify with `docker info`.

### 2. Caddy (Reverse Proxy)

**Role:** Port-based routing, security headers, gzip compression.

- Sole ingress point. Each service keeps its own port (:6767, :3001, :20128, :8000).
- `Caddyfile.deploy` reads `ACTIVE_*_UPSTREAM` env vars to route to active slots.
- Admin API on `:2019` allows config inspection.
- Single Caddy reload switches ALL upstreams atomically.

**Failure mode:** If Caddy fails to start with the new config, the deploy script detects this and aborts. Existing connections are held until Caddy terminates.

### 3. PM2 (Process Manager)

**Role:** Process supervision inside Node.js containers (non-Docker deployments only).

- `ecosystem.config.cjs` defines the `paseo-daemon` PM2 app.
- `kill_timeout: 30000` gives the daemon 30 seconds to drain before SIGKILL.
- In Docker deployments, the supervisor (`supervisor-entrypoint.ts`) replaces PM2.

**Failure mode:** Not in the Docker deploy path. Relevant only for bare-metal deployments.

### 4. Node.js (Runtime)

**Role:** Executes Paseo daemon and Soifer Backend.

- Paseo: `node packages/server/dist/scripts/supervisor-entrypoint.js`
- SIGTERM to supervisor -> SIGTERM to worker -> graceful shutdown sequence.

**Failure mode:** If Node crashes during startup, the health check loop detects it and the deploy rolls back.

### 5. curl

**Role:** Health check probes during deployment.

- `docker exec <container> curl -sf http://localhost:<port><health-path>` verifies each container.
- Deploy scripts use the service-specific health endpoint as the gate.

**Failure mode:** If curl is missing inside a container, the health check fails. All Dockerfiles install curl for this reason.

### 6. Docker Compose

**Role:** Multi-container orchestration.

- `docker-compose.prod.yml` defines single-instance production services.
- `docker-compose.deploy.yml` extends it with blue/green slots and deploy-mode Caddy.
- Compose overlay: `docker compose -f docker-compose.prod.yml -f docker-compose.deploy.yml`.
- Secret injection via Docker secrets (env-based).

**Failure mode:** Compose syntax errors are caught at invocation. Network issues between containers are caught by health checks.

### 7. Git

**Role:** Version tagging (not directly invoked by deploy scripts).

- Docker images are tagged by git SHA and branch in CI.
- `.deploy-rollback` records image tags for traceability.

**Failure mode:** Not in the deploy hot path.

### 8. GitHub Container Registry (ghcr.io)

**Role:** Image storage for all 4 services.

- `docker pull` in the deploy script fetches from GHCR.

**Failure mode:** If GHCR is unreachable, `docker pull` fails and the deploy aborts before any slot switch.

## Deployment Flow

```
 1. Preflight
    - Check OCC binary version on host
    - Load deploy-config.json for service topology
    - Load .deploy-state (JSON) to determine active slots

 2. Pull/build images for ALL inactive slots
    9router, crewai, soifer, paseo (or single --service)

 3. Start all inactive slot containers
    9router-green, crewai-green, soifer-green, paseo-green

 4. Health-gate in dependency order
    9Router -> CrewAI -> Soifer -> Paseo
    ┌─────────────────────────────────────────────────────────┐
    │ Required service FAIL => tear down ALL new slots, abort │
    │ Optional service FAIL => continue with warning          │
    └─────────────────────────────────────────────────────────┘

 5. Switch Caddy (single reload switches ALL upstreams atomically)
    ACTIVE_ROUTER_UPSTREAM=9router-green
    ACTIVE_CREWAI_UPSTREAM=crewai-green
    ACTIVE_SOIFER_UPSTREAM=soifer-green
    ACTIVE_PASEO_UPSTREAM=paseo-green
    docker compose ... up -d caddy

 6. Drain old slots (service-specific grace periods)
    9router-blue:  15s
    crewai-blue:   15s
    soifer-blue:   30s
    paseo-blue:    30s

 7. Save state
    .deploy-state (JSON) — per-service active slots
    .deploy-rollback (JSON) — previous slots + images

 8. Post-switch verification
    Health-check all new slots. Warn if degraded.
```

## Rollback Procedure

Rollback uses the same blue/green mechanism in reverse, reading `.deploy-rollback` for previous image info.

```
 1. Load .deploy-rollback for per-service previous images

 2. Pull previous images (likely cached locally)

 3. Start opposite slots with previous images

 4. Health-check in dependency order
    Required service FAIL => abort, manual intervention.
    Optional service FAIL => skip, continue.

 5. Switch Caddy atomically to rollback slots

 6. Drain current slots

 7. Save state
```

Time to rollback: **under 60 seconds** (images already cached locally).

## State File Formats

### `.deploy-state` (JSON)

```json
{
  "9router": "green",
  "crewai": "green",
  "soifer": "green",
  "paseo": "green",
  "timestamp": "2026-05-11T12:00:00Z"
}
```

**Backward compatibility:** If `.deploy-state` contains plain text (old format like `green`), the scripts treat it as Paseo-only state.

### `.deploy-rollback` (JSON)

```json
{
  "current": { "9router": "green", "soifer": "green", "paseo": "green", "timestamp": "..." },
  "previous": { "9router": "blue", "soifer": "blue", "paseo": "blue", "timestamp": "..." },
  "images": {
    "9router": {
      "old": "ghcr.io/bas-more/9router:v1.0.0",
      "new": "ghcr.io/bas-more/9router:v1.1.0"
    },
    "soifer": { "old": "...", "new": "..." },
    "paseo": { "old": "...", "new": "..." }
  },
  "timestamp": "2026-05-11T12:00:00Z"
}
```

Both files are gitignored (deployment-time artifacts, not source code).

## Configuration

### `scripts/deploy-config.json`

Service topology config defining ports, health paths, image bases, required flag, dependency order, and per-service timeouts. Read by deploy and rollback scripts.

### Environment variables for deploy scripts

| Variable          | Default              | Description                                              |
| ----------------- | -------------------- | -------------------------------------------------------- |
| `HEALTH_INTERVAL` | `3`                  | Seconds between health check attempts                    |
| `DRAIN_TIMEOUT`   | `30`                 | Default drain timeout (overridden per-service by config) |
| `OCC_HOST_PATH`   | `/usr/local/bin/occ` | Path to OCC binary on host (mounted into containers)     |

PowerShell equivalents: `-HealthInterval`, `-DrainTimeout` parameters.

### Per-service timeouts (from deploy-config.json)

| Service | Health Timeout | Drain Timeout |
| ------- | -------------- | ------------- |
| 9Router | 60s            | 15s           |
| CrewAI  | 45s            | 15s           |
| Soifer  | 90s            | 30s           |
| Paseo   | 90s            | 30s           |

## File Layout

```
paseo/
  docker-compose.prod.yml       # Single-instance production stack (all 5 services)
  docker-compose.deploy.yml     # Blue/green overlay (8 service slots + Caddy)
  Caddyfile                     # Production Caddy config (single upstream, TLS)
  Caddyfile.deploy              # Deploy Caddy config (port-based routing, admin API)
  .deploy-state                 # Runtime: per-service active slots JSON (gitignored)
  .deploy-rollback              # Runtime: rollback metadata JSON (gitignored)
  scripts/
    deploy-config.json          # Service topology config
    deploy.sh                   # Linux/Mac full-stack atomic deploy
    deploy.ps1                  # Windows full-stack atomic deploy
    rollback.sh                 # Linux/Mac full-stack instant rollback
    rollback.ps1                # Windows full-stack instant rollback
  packages/
    crewai-bridge/
      Dockerfile                # CrewAI Bridge container image
      api.py                    # FastAPI application
      requirements.lock         # Pinned Python dependencies
  Dockerfile                    # Paseo daemon container image
  ecosystem.config.cjs          # PM2 config (bare-metal only)
  k8s/                          # Kubernetes manifests (separate deploy path)
```

## Graceful Shutdown Sequence

### Paseo / Soifer (Node.js)

When `docker stop --time 30` sends SIGTERM:

1. **Supervisor** receives SIGTERM, sends SIGTERM to worker.
2. **Worker** calls bootstrap `stop()`.
3. **Stop sequence**: backup, close agents, drain WebSockets, close HTTP server, flush audit log, flush Sentry.
4. **Worker exits** with code 0.
5. **Supervisor** detects clean exit, releases PID lock, exits.
6. **Docker** marks container as stopped.

### CrewAI Bridge (Python)

When `docker stop --time 15` sends SIGTERM:

1. **uvicorn** receives SIGTERM, stops accepting new connections.
2. In-flight SSE streams complete or are cancelled.
3. **uvicorn** exits cleanly.

## Health Check Endpoints

| Service | Endpoint          | Condition                                 | Deploy usage           |
| ------- | ----------------- | ----------------------------------------- | ---------------------- |
| Paseo   | `/health/ready`   | Bootstrap + listening + dependency checks | **Deploy gate**        |
| Paseo   | `/health/live`    | Process alive                             | Dockerfile HEALTHCHECK |
| Paseo   | `/health/startup` | Bootstrap complete                        | k8s startup probe      |
| Soifer  | `/health`         | Server listening                          | **Deploy gate**        |
| 9Router | `/api/health`     | Router ready                              | **Deploy gate**        |
| CrewAI  | `/health`         | FastAPI responding                        | **Deploy gate**        |

## Failure Scenarios

| Scenario                                     | What happens                                                       |
| -------------------------------------------- | ------------------------------------------------------------------ |
| New image fails to pull                      | Deploy aborts immediately. Active slots untouched.                 |
| Required service fails health check          | ALL new slots torn down. Active slots untouched.                   |
| Optional service (CrewAI) fails health check | Warning logged. Deploy continues without it.                       |
| Caddy fails to reload                        | Deploy logs warning. Traffic may be briefly interrupted.           |
| Old container hangs on SIGTERM               | Docker sends SIGKILL after drain timeout.                          |
| Deploy script interrupted (Ctrl+C)           | Partial state. Run `rollback.sh` or inspect `docker ps`.           |
| GHCR outage during rollback                  | Rollback works if previous image is cached locally.                |
| Disk full                                    | Docker pull fails. Deploy aborts before any switch.                |
| Mixed old/new state file format              | Scripts detect plain text and treat as Paseo-only.                 |
| OCC binary missing on host                   | Warning logged in preflight. Non-blocking.                         |
| Single-service deploy with `--service`       | Only that service's slot is swapped. Others stay at current slots. |

## Relationship to CI/CD

The deploy scripts can be called from GitHub Actions as a drop-in replacement:

```yaml
# Full stack deploy
- run: ./scripts/deploy.sh

# Single service deploy
- run: ./scripts/deploy.sh --service paseo
```

The scripts handle their own rollback, so the separate rollback step in the workflow becomes a safety net.
