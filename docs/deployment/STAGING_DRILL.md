# Staging Deploy + Rollback Drill

**Purpose.** Validate the production deploy + rollback paths on a staging
host before the first prod cutover. Every hardening fix in the Sprint A–I
campaign lands or fails here.

**Pre-requisite.** A Linux host (any cloud, $5/mo droplet is fine) with:

- Docker 24+ and Docker Compose v2
- SSH access + sudo
- A DNS name pointing to it (e.g. `staging.paseo.sh`)
- Outbound 443 to GHCR + Anthropic + OpenAI
- `PASEO_DOMAIN`, `PASEO_PASSWORD`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `PASEO_AUDIT_HMAC_SECRET` set in the shell that runs the deploy

**Time budget.** 3–4 hours including failure injection.

---

## Stage 0 — One-time bootstrap

On the staging host:

```bash
git clone https://github.com/BAS-More/paseo.git
cd paseo
mkdir -p ~/.paseo
docker login ghcr.io  # use a PAT with read:packages
```

Copy `.env.production.example` to `.env.production` and fill the values.
Set `PASEO_DOMAIN=staging.paseo.sh`.

---

## Stage 1 — Cold deploy (blue active)

```bash
# Pulls latest images, starts the blue slot for every service, switches
# Caddy routing to point at *-blue.
./scripts/deploy.sh
```

**Expected.**

- 5–7 minutes end to end
- All five `*-blue` containers reach healthy status (`docker compose ps`)
- Trap handler (H-09) prints status if anything fails

**Verify.**

- `curl -fsS https://staging.paseo.sh/health/live` → `{"status":"ok"}`
- `curl -fsS https://staging.paseo.sh/health/ready` → `{"status":"ok"}` and
  fails fast if `PASEO_HOME` is read-only (ARCH-004)
- `curl https://staging.paseo.sh/api/status` → exposes only `serverId` +
  `version`, no hostname (SEC-013)
- TLS cert valid; security headers present (`Content-Security-Policy`,
  `Strict-Transport-Security`); admin port 2019 NOT reachable from
  outside the host (C-02)

---

## Stage 2 — Verify hardening fixes against the live daemon

These are the tests the unit suite can't do because they need a real
deployment.

### Container limits + non-root (M-12, H-08)

```bash
docker inspect paseo-blue --format '{{json .HostConfig.Resources}}'
# expect: NanoCpus, Memory > 0
docker exec paseo-blue id -u  # expect: non-root uid
docker exec crewai-blue id -u  # expect: 10001
```

### Audit log + HMAC (E1, SEC-009)

```bash
# Force an authenticated mutation
curl -X POST https://staging.paseo.sh/api/agents \
  -H "Authorization: Bearer $PASEO_PASSWORD" -H 'Content-Type: application/json' \
  -d '{"provider":"claude","model":"claude-3-5-sonnet-latest"}'

# Pull the audit log out of the container
docker exec paseo-blue ls /data/paseo/audit/
docker exec paseo-blue tail -1 /data/paseo/audit/audit-*.ndjson | jq .
# expect: hmac field present and non-empty
```

### Backup + manifest verification (H-02, H-04)

```bash
docker exec paseo-blue node -e \
  "import('./packages/server/dist/server/server/db-backup.js').then(m => m.createBackup('/data/paseo'))"
docker exec paseo-blue ls /data/paseo/backups/backup-*/manifest.json
docker exec paseo-blue cat /data/paseo/backups/backup-*/manifest.json | jq '.files | length'
# expect: integer >= 1; manifest schema { version, createdAt, files:[{path,size,sha256}] }

# Tamper test
docker exec paseo-blue bash -c "echo 'corrupt' >> /data/paseo/backups/backup-*/config/agents.json"
docker exec paseo-blue node -e \
  "import('./packages/server/dist/server/server/db-backup.js').then(m => m.restoreBackup('/data/paseo/backups/backup-XXX', '/tmp/paseo-restore'))"
# expect: throws 'sha256 mismatch'
```

### WebSocket payload + connection cap (M-04)

```bash
# Massive payload — expect close from server
wscat -c "wss://staging.paseo.sh/ws" -H "Authorization: Bearer $PASEO_PASSWORD" \
  -x "$(python -c 'print("x"*2000000)')"
# expect: connection closed with code 1009 or 1011

# Connection flood — expect 503 after ~1000
for i in {1..1500}; do
  wscat -c "wss://staging.paseo.sh/ws" -H "Authorization: Bearer $PASEO_PASSWORD" &
done
# expect: some connections rejected with 503 "Server at capacity"
```

### WS auth brute-force (SEC-002)

```bash
for i in {1..15}; do
  wscat -c "wss://staging.paseo.sh/ws" -H "Authorization: Bearer wrong-$i" 2>&1 | head -1
done
# expect: first ~10 close with auth failure; subsequent close with 429
#         "Too many auth attempts"
```

### Circuit breaker (C-01)

```bash
# Take 9Router down for a minute, then bring it back
docker stop 9router-blue
# Hit a route that depends on 9Router
for i in {1..10}; do curl -sf https://staging.paseo.sh/api/nine-router/status | jq .reachable; done
# expect: first ~5 calls fail open, breaker opens, remaining return `reachable: false` instantly
docker start 9router-blue
sleep 35   # reset timeout
curl -sf https://staging.paseo.sh/api/nine-router/status | jq .reachable
# expect: true — breaker half-open probe succeeded, breaker closes
```

### tree-kill on agent interrupt (H-01)

```bash
# Start a long agent turn that spawns subprocess(es)
SESSION=$(curl -sX POST https://staging.paseo.sh/api/agents \
  -H "Authorization: Bearer $PASEO_PASSWORD" -H 'Content-Type: application/json' \
  -d '{"provider":"gemini","model":"gemini-2.5-flash"}' | jq -r .id)
curl -X POST https://staging.paseo.sh/api/agents/$SESSION/turns \
  -H "Authorization: Bearer $PASEO_PASSWORD" -H 'Content-Type: application/json' \
  -d '{"prompt":"Run an MCP tool that takes 60 seconds"}' &
# Immediately interrupt
sleep 3
curl -X POST https://staging.paseo.sh/api/agents/$SESSION/interrupt \
  -H "Authorization: Bearer $PASEO_PASSWORD"
# Check no orphan children on host
docker exec paseo-blue pstree -p | grep -i gemini  # expect: empty
```

---

## Stage 3 — Atomic blue/green swap (deploy v2)

Make a trivial code change (bump a string in `/api/status`'s response),
rebuild and push, then deploy again:

```bash
./scripts/deploy.sh
```

**Expected.**

- `*-green` slots spin up healthy alongside `*-blue` (no downtime)
- Caddy admin API switches `ACTIVE_*_UPSTREAM` to `-green` atomically
- Old `-blue` slots stopped and removed only after green is verified
- Rollback state file records image digests, not tags (H-10)
- Zero requests dropped during swap — verify with a `curl -s -o /dev/null
-w "%{http_code}\n" https://staging.paseo.sh/health/live` loop running
  during the deploy

---

## Stage 4 — Rollback drill

Force a bad deploy and roll back.

```bash
# Tag a known-broken image
docker tag ghcr.io/bas-more/paseo/paseo-daemon:latest \
           ghcr.io/bas-more/paseo/paseo-daemon:broken
docker rmi ghcr.io/bas-more/paseo/paseo-daemon:latest
docker run --rm -e BUSTED=1 ghcr.io/bas-more/paseo/paseo-daemon:broken /bin/false
# Deploy the broken image
PASEO_IMAGE=ghcr.io/bas-more/paseo/paseo-daemon:broken ./scripts/deploy.sh
# expect: deploy.sh detects unhealthy + aborts pre-swap; or post-swap
#         smoke fails → ./scripts/rollback.sh fires automatically
```

Confirm rollback used **digest** (not tag) by inspecting the rollback
state file:

```bash
cat /var/lib/paseo/deploy-state.json | jq .rollback
# expect: ".image" ends with sha256@...
```

After rollback, hit `/health/ready` again — should be 200.

---

## Stage 5 — Failure injection

For each scenario, induce + verify recovery:

| Scenario                   | Induce                                                                                     | Expected                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| CrewAI bridge crash (H-11) | `docker exec crewai-blue kill 1`                                                           | Manager respawns within 1s, exponential backoff up to 5 retries, status `running`                        |
| Daemon SIGTERM             | `docker stop -t 30 paseo-blue`                                                             | Graceful shutdown < 30s (ARCH-014), audit log flushed, PID lock removed (M-05), best-effort backup taken |
| OOM                        | `docker exec paseo-blue node -e 'let a = []; while(true) a.push(Buffer.alloc(1024*1024))'` | Container hits memory limit (M-12), kernel kills, Docker restarts per `restart: unless-stopped`          |
| Disk full                  | `docker exec paseo-blue dd if=/dev/zero of=/data/paseo/junk bs=1M`                         | Health `/ready` flips to 503 once `PASEO_HOME` is full (ARCH-004)                                        |

---

## Stage 6 — Stop + teardown

```bash
./scripts/stop-stack.sh
docker compose -f docker-compose.prod.yml -f docker-compose.deploy.yml down -v
```

---

## Pass / fail criteria

The drill passes when **every** check in stages 2, 3, 4, 5 behaves as
`expected`. File any failure as a P0 issue and block prod cutover until
fixed.

## Post-drill artifacts

Commit to `docs/compliance/staging-drill-<YYYY-MM-DD>.md`:

- Output of every command in stage 2 + 4
- Screenshot of Caddy admin showing the active-upstream swap
- Audit log entries from the run
- Total time elapsed per stage

Once filed, link from the `PRODUCTION_READINESS.md` Tier 2 section and
mark the staging drill checkbox green.
