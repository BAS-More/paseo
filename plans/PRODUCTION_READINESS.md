# Production Readiness Plan — Paseo

**Version:** 1.0
**Date:** 2026-05-11
**Target:** Local production → Hosted production → Enterprise
**Repo:** BAS-More/paseo (branch: main)

---

## Current State Assessment

### What EXISTS

| Area               | Status | Details                                                                                                                                                                                        |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI/CD              | ✅     | 11 GitHub Actions workflows: format, lint, typecheck, server-tests (Ubuntu), server-tests-windows, desktop-tests, app-tests, playwright, relay-tests, deploy-app, deploy-relay, deploy-website |
| Auth layer         | ✅     | `packages/server/src/server/auth.ts` — bcrypt bearer tokens (cost 12), sync + async validation, tests exist                                                                                    |
| Structured logging | ✅     | pino 10.x + pino-pretty, file output to `$PASEO_HOME/logs/`, configurable levels                                                                                                               |
| .env config        | ✅     | `.env.example` with PASEO_HOME, PASEO_LISTEN, API keys                                                                                                                                         |
| Test suite         | ⚠️     | 4481 tests across 584 files. 352 failures (151 files) on Windows; root causes: `mkdir -p` on Win, `spawn npx ENOENT`, git config, node-pty EPERM. Likely pass on Linux CI.                     |
| Deploy workflows   | ✅     | deploy-app, deploy-relay, deploy-website already exist                                                                                                                                         |

### What's MISSING

| Area               | Status | Impact                                                                                                                   |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| High vuln fixes    | ⚠️     | 0 high/critical in prod deps; 11 moderate (Expo transitive). GitHub shows 31 high (dev deps + Dependabot classification) |
| Green test suite   | ❌     | ~250 failures block CI merge gates                                                                                       |
| node-pty stable    | ❌     | On beta.11, beta.12 available, no stable 1.2.x yet                                                                       |
| .env.production    | ❌     | No prod-specific config validation                                                                                       |
| Process manager    | ❌     | No PM2/systemd/Windows service config                                                                                    |
| Auto-restart       | ❌     | Depends on process manager                                                                                               |
| Log rotation       | ⚠️     | pino logs to files but no rotation policy                                                                                |
| Docker             | ❌     | No Dockerfile or compose                                                                                                 |
| TLS                | ❌     | No reverse proxy config                                                                                                  |
| Rate limiting      | ❌     | No rate-limit middleware                                                                                                 |
| Prod secrets       | ❌     | Env vars only, no Vault/SSM/SOPS                                                                                         |
| Health checks      | ⚠️     | Basic health exists, no k8s-style liveness/readiness probes                                                              |
| Sentry             | ❌     | No @sentry packages                                                                                                      |
| DB backups         | ❌     | SQLite, no backup strategy                                                                                               |
| CORS lockdown      | ❌     | Dev-mode wide open                                                                                                       |
| Audit logging      | ❌     | No structured audit trail                                                                                                |
| RBAC               | ❌     | Auth is all-or-nothing bearer token                                                                                      |
| SOC2 controls      | ❌     | No compliance framework                                                                                                  |
| CDN                | ❌     | No static asset CDN                                                                                                      |
| Horizontal scaling | ❌     | SQLite = single-writer bottleneck                                                                                        |

---

## Tier 1: Local Production (2 days)

Ship it for daily use by you + team on a local network.

### Phase L1: Vulnerability Triage (0.25 day)

**Goal:** Zero high/critical vulns in production dependencies.

**Gap:** 11 moderate vulns in prod deps (all Expo transitive — markdown-it, postcss). GitHub reports 31 high but those are dev-dep / Dependabot classification mismatches.

#### Tasks

- [ ] **L1-01** Run `npm audit --prod` and document each vuln with package name, severity, fix availability
- [ ] **L1-02** Run `npm audit fix` (non-breaking) — apply safe patches
- [ ] **L1-03** For unfixable Expo transitives: add `overrides` in root `package.json` to floor vulnerable deps
- [ ] **L1-04** For dev-only vulns: add `npm audit --omit=dev` to CI as informational (non-blocking)
- [ ] **L1-05** Verify: `npm audit --prod --audit-level high` exits 0

#### Testing

- `npm audit --prod` shows 0 high/critical
- `npm install` still resolves cleanly
- Full test suite unaffected (no runtime dep changes)

#### Quality Gate

- [ ] Zero high/critical in `npm audit --prod`
- [ ] Overrides documented with CVE references
- [ ] Commit: `fix(deps): resolve production dependency vulnerabilities`

---

### Phase L2: Green Test Suite (0.75 day)

**Goal:** Full `npx vitest run` exits 0.

**Gap:** 352 test failures across 151 files (Windows local run). Categories identified:

1. **Windows platform** (~80%): `mkdir -p` Unix syntax on Windows, `spawn npx ENOENT` in bash subprocess context, git config issues — these pass on Linux CI
2. **Terminal/PTY** (~5%): node-pty EPERM on Windows — FIXED (skip guards committed)
3. **E2E timeouts** (~10%): tests needing live services (Codex, Claude, relay) timing out without API keys/services
4. **Genuine bugs** (~5%): need investigation

Failing file categories:

- 15 daemon-e2e files (git/worktree ops using Unix commands)
- 12 workspace/git service files (same `mkdir -p` issue)
- 8 agent provider files (spawn/timeout/ENOENT)
- 6 session/bootstrap files (git config)
- 5 e2e smoke tests (need live services)
- 5 misc (logger, file-explorer, script tests)

#### Tasks

- [ ] **L2-01** Run `npx vitest run` on Linux (WSL or CI), capture full failure list
- [ ] **L2-02** Categorize failures:
  - (a) Env-dependent (need API keys / running services) → mark with `skipIf`
  - (b) Genuine bugs → fix root cause
  - (c) Flaky / timing-dependent → add retries or increase timeouts
  - (d) Windows-only → already guarded
- [ ] **L2-03** Fix category (b) failures — genuine bugs
- [ ] **L2-04** Add `skipIf` guards for category (a) — tests that need live services
- [ ] **L2-05** Add `retry: 2` for category (c) — flaky tests
- [ ] **L2-06** Verify: `npx vitest run` exits 0 with all tests passing or explicitly skipped
- [ ] **L2-07** Verify: CI `server-tests` job passes on ubuntu-latest

#### Testing

- Local: `npx vitest run` → 0 failures
- CI: push and verify all CI jobs green
- No test deleted — only skipped with documented reason

#### Quality Gate

- [ ] `npx vitest run` exits 0
- [ ] CI jobs all green on main
- [ ] Every skip has a comment explaining why
- [ ] Commit: `fix(test): green test suite — triage and fix all failures`

---

### Phase L3: node-pty Pin Strategy (0.25 day)

**Goal:** Documented decision on node-pty version. Tests skip cleanly on Windows.

**Gap:** Using `1.2.0-beta.11`, latest beta is `1.2.0-beta.12`, latest stable is `1.1.0`. No stable 1.2.x exists.

#### Tasks

- [ ] **L3-01** Evaluate: does `1.2.0-beta.12` fix the Windows EPERM? Test if available
- [ ] **L3-02** If beta.12 fixes it → bump to beta.12, remove Windows skip guards
- [ ] **L3-03** If beta.12 doesn't fix it → stay on beta.11, document in `KNOWN_ISSUES.md`
- [ ] **L3-04** Add Dependabot config to auto-PR when node-pty 1.2.0 stable ships
- [ ] **L3-05** Evaluate fallback: can we use `1.1.0` stable? Check breaking changes

#### Testing

- Terminal tests pass on Linux CI
- Terminal tests skip on Windows (or pass if beta.12 fixes EPERM)

#### Quality Gate

- [ ] Decision documented in `KNOWN_ISSUES.md`
- [ ] Dependabot watches node-pty for stable release
- [ ] Commit: `chore(deps): document node-pty version strategy`

---

### Phase L4: Production Config & Validation (0.25 day)

**Goal:** Validated `.env.production` with fail-fast on missing required vars.

**Gap:** `.env.example` exists but no runtime validation. Server starts even with missing critical vars.

#### Tasks

- [ ] **L4-01** Create `packages/server/src/server/config-validator.ts`:
  - Required: `PASEO_HOME`, `PASEO_LISTEN`
  - Required for auth: at least one of `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`
  - Optional with defaults: `PASEO_LOG_LEVEL=info`, `PASEO_LOG_FORMAT=json`
  - Fail-fast: throw on startup if required vars missing
- [ ] **L4-02** Create `.env.production` template:
  - `PASEO_LISTEN=0.0.0.0:6767` (not 127.0.0.1 for Docker)
  - `PASEO_LOG_LEVEL=info`
  - `PASEO_LOG_FORMAT=json` (not pretty)
  - `NODE_ENV=production`
- [ ] **L4-03** Wire config-validator into server startup (before any service init)
- [ ] **L4-04** Test: missing required var → clear error message + exit 1
- [ ] **L4-05** Test: all vars present → server starts normally

#### Testing

- `PASEO_HOME= node server` → exits with clear error
- `node server` with valid `.env.production` → starts normally

#### Quality Gate

- [ ] Config validation runs before any service starts
- [ ] Error messages include var name + expected format
- [ ] Tests for validator
- [ ] Commit: `feat(config): add production config validation with fail-fast`

---

### Phase L5: Process Manager & Auto-Restart (0.25 day)

**Goal:** PM2 manages Paseo daemon with auto-restart on crash.

**Gap:** No process manager config. Server runs via `npm run dev` (nodemon).

#### Tasks

- [ ] **L5-01** Add `pm2` as optional dependency or document global install
- [ ] **L5-02** Create `ecosystem.config.cjs`:
  ```js
  module.exports = {
    apps: [
      {
        name: "paseo-daemon",
        script: "packages/server/dist/server/index.js",
        instances: 1,
        exec_mode: "fork",
        autorestart: true,
        max_restarts: 10,
        restart_delay: 1000,
        max_memory_restart: "512M",
        env_production: {
          NODE_ENV: "production",
          PASEO_LOG_FORMAT: "json",
        },
      },
    ],
  };
  ```
- [ ] **L5-03** Add npm scripts:
  - `"prod:start": "pm2 start ecosystem.config.cjs --env production"`
  - `"prod:stop": "pm2 stop paseo-daemon"`
  - `"prod:logs": "pm2 logs paseo-daemon"`
  - `"prod:status": "pm2 status"`
- [ ] **L5-04** Test: `npm run prod:start` → process running
- [ ] **L5-05** Test: kill process → PM2 auto-restarts within 1s
- [ ] **L5-06** Test: crash loop (>10 restarts) → PM2 stops retrying

#### Testing

- `pm2 start` → status shows "online"
- `pm2 stop` → clean shutdown
- Kill PID → auto-restart within 1s
- Verify logs go to both PM2 logs and pino file output

#### Quality Gate

- [ ] PM2 config committed
- [ ] Auto-restart verified
- [ ] Memory limit works
- [ ] Commit: `feat(ops): add PM2 production process manager`

---

### Phase L6: Log Rotation (0.25 day)

**Goal:** Logs don't fill disk.

**Gap:** pino writes to `$PASEO_HOME/logs/` with no rotation.

#### Tasks

- [ ] **L6-01** Add `pino-roll` or use PM2's built-in log rotation (`pm2 install pm2-logrotate`)
- [ ] **L6-02** Configure: max 50MB per file, keep 7 days, compress old files
- [ ] **L6-03** For PM2 path: `pm2 set pm2-logrotate:max_size 50M && pm2 set pm2-logrotate:retain 7 && pm2 set pm2-logrotate:compress true`
- [ ] **L6-04** Document rotation config in README or ops guide
- [ ] **L6-05** Test: generate enough log output to trigger rotation

#### Testing

- Logs rotate at 50MB boundary
- Old logs compressed
- No disk space leak over time

#### Quality Gate

- [ ] Log rotation configured and documented
- [ ] Commit: `feat(ops): configure log rotation via PM2`

---

## Tier 1 Drift Analysis & Remediation

After completing all L1-L6 phases:

```
DRIFT CHECK:
- [ ] npm audit --prod --audit-level high → exits 0
- [ ] npx vitest run → exits 0
- [ ] npm run typecheck → exits 0
- [ ] npx oxfmt --check . → exits 0
- [ ] npx oxlint . → exits 0
- [ ] pm2 start + crash test → auto-restart works
- [ ] Logs rotate correctly
- [ ] Config validation catches missing vars
```

**Commit + push + verify CI green before proceeding to Tier 2.**

---

## Tier 2: Hosted Production (1-2 weeks)

Internet-facing, multi-user deployment.

### Phase H1: Docker & Compose (1 day)

**Goal:** `docker compose up` runs Paseo in production mode.

#### Tasks

- [ ] **H1-01** Create `Dockerfile` (multi-stage: build → prod):
  - Stage 1: `node:22-slim` + `npm ci` + `npm run build`
  - Stage 2: `node:22-slim` + copy dist + `npm ci --omit=dev`
  - node-pty needs build tools → install in build stage, not prod
  - `USER node` (non-root)
  - `HEALTHCHECK CMD curl -f http://localhost:6767/health || exit 1`
- [ ] **H1-02** Create `docker-compose.prod.yml`:
  - `paseo-daemon` service with env_file, volume for PASEO_HOME, restart: unless-stopped
  - `caddy` service (TLS — Phase H2)
  - Network: `paseo-net`
- [ ] **H1-03** Create `.dockerignore` (node_modules, .git, .env, plans/, docs/)
- [ ] **H1-04** Test: `docker build -t paseo .` succeeds
- [ ] **H1-05** Test: `docker compose up` → health check passes
- [ ] **H1-06** Test: `docker compose down` → clean shutdown

#### Testing

- Build completes in <3 min
- Container starts and responds to health check
- Container runs as non-root user
- node-pty works inside container (Linux)

#### Quality Gate

- [ ] Docker build reproducible
- [ ] Health check integrated
- [ ] Non-root user
- [ ] Commit: `feat(docker): add Dockerfile and docker-compose for production`

---

### Phase H2: TLS Termination (0.5 day)

**Goal:** HTTPS via Caddy reverse proxy with automatic cert management.

#### Tasks

- [ ] **H2-01** Create `Caddyfile`:
  ```
  {$PASEO_DOMAIN:localhost} {
    reverse_proxy paseo-daemon:6767
    encode gzip
    header {
      Strict-Transport-Security "max-age=31536000; includeSubDomains"
      X-Frame-Options "DENY"
      X-Content-Type-Options "nosniff"
    }
  }
  ```
- [ ] **H2-02** Add Caddy service to `docker-compose.prod.yml`
- [ ] **H2-03** Volume mount for Caddy data (cert persistence)
- [ ] **H2-04** Test: `curl -k https://localhost` → Paseo responds
- [ ] **H2-05** Test: HTTP → HTTPS redirect works

#### Quality Gate

- [ ] TLS works with self-signed (local) and Let's Encrypt (prod domain)
- [ ] Security headers present
- [ ] Commit: `feat(tls): add Caddy reverse proxy with auto-TLS`

---

### Phase H3: Rate Limiting (0.5 day)

**Goal:** Prevent abuse on public-facing endpoints.

#### Tasks

- [ ] **H3-01** Install `express-rate-limit` or equivalent for Hono/Express
- [ ] **H3-02** Create `packages/server/src/server/rate-limiter.ts`:
  - Global: 100 req/min per IP
  - Auth endpoints: 10 req/min per IP
  - WebSocket connections: 5 new connections/min per IP
- [ ] **H3-03** Wire into server middleware chain
- [ ] **H3-04** Test: exceed limit → 429 response with Retry-After header
- [ ] **H3-05** Config via env: `PASEO_RATE_LIMIT_RPM=100`

#### Quality Gate

- [ ] Rate limiting active on all routes
- [ ] Configurable via env
- [ ] Tests for limit enforcement
- [ ] Commit: `feat(security): add rate limiting middleware`

---

### Phase H4: Production Secret Management (0.5 day)

**Goal:** Secrets not stored as plain env vars in production.

#### Tasks

- [ ] **H4-01** Docker Compose: use `secrets:` directive for sensitive values
- [ ] **H4-02** Create `packages/server/src/server/secret-loader.ts`:
  - Read from Docker secrets (`/run/secrets/<name>`) if available
  - Fallback to env vars for non-Docker deployments
  - Support: ANTHROPIC_API_KEY, OPENAI_API_KEY, PASEO_AUTH_TOKEN
- [ ] **H4-03** Document: how to set up Docker secrets
- [ ] **H4-04** Test: secret loaded from file path
- [ ] **H4-05** Test: fallback to env var works

#### Quality Gate

- [ ] Secrets never logged (verify with grep)
- [ ] Docker secrets documented
- [ ] Commit: `feat(security): add Docker secret support for credentials`

---

### Phase H5: Health Checks & Liveness Probes (0.25 day)

**Goal:** k8s-compatible health endpoints.

#### Tasks

- [ ] **H5-01** Add `/health/live` — returns 200 if process alive (liveness)
- [ ] **H5-02** Add `/health/ready` — returns 200 if DB connected + services initialized (readiness)
- [ ] **H5-03** Add `/health/startup` — returns 200 after initial bootstrap complete (startup probe)
- [ ] **H5-04** Docker HEALTHCHECK uses `/health/live`
- [ ] **H5-05** Tests for each endpoint

#### Quality Gate

- [ ] All three probes respond correctly
- [ ] Docker health check integrated
- [ ] Commit: `feat(health): add liveness, readiness, and startup probes`

---

### Phase H6: CI/CD Pipeline Enhancement (0.5 day)

**Goal:** Automated build → test → deploy on push to main.

**Gap:** Deploy workflows exist but may not include Docker build + push.

#### Tasks

- [ ] **H6-01** Add `docker-build` job to CI: build image, push to GitHub Container Registry
- [ ] **H6-02** Add `npm audit --prod --audit-level high` as CI step (blocking)
- [ ] **H6-03** Add deployment step: pull new image, `docker compose up -d`
- [ ] **H6-04** Add smoke test post-deploy: curl health endpoint
- [ ] **H6-05** Add rollback step: if smoke fails, revert to previous image tag

#### Quality Gate

- [ ] Push to main → automated deploy
- [ ] Failed smoke test → auto-rollback
- [ ] Commit: `ci: add Docker build, push, and deploy pipeline`

---

### Phase H7: Sentry Error Tracking (0.25 day)

**Goal:** Runtime errors reported to Sentry dashboard.

#### Tasks

- [ ] **H7-01** Install `@sentry/node`
- [ ] **H7-02** Create `packages/server/src/server/sentry.ts` — init with DSN from config
- [ ] **H7-03** Wire as Express/Hono error handler middleware
- [ ] **H7-04** Configure: environment tag, release tag from package.json version
- [ ] **H7-05** Test: throw unhandled error → appears in Sentry
- [ ] **H7-06** Add `SENTRY_DSN` to `.env.production` template

#### Quality Gate

- [ ] Errors appear in Sentry dashboard
- [ ] Source maps uploaded for stack traces
- [ ] Commit: `feat(monitoring): add Sentry error tracking`

---

### Phase H8: Database Backup Strategy (0.5 day)

**Goal:** SQLite data protected against loss.

#### Tasks

- [ ] **H8-01** Create `packages/server/src/server/db-backup.ts`:
  - Use SQLite `.backup()` API for online backup
  - Schedule: every 6 hours
  - Retain: 7 days of backups
  - Location: `$PASEO_HOME/backups/`
- [ ] **H8-02** Add backup-on-shutdown hook (graceful shutdown → backup → exit)
- [ ] **H8-03** Add restore command: `npm run db:restore -- --from <backup-file>`
- [ ] **H8-04** Test: backup creates valid SQLite file
- [ ] **H8-05** Test: restore from backup works
- [ ] **H8-06** Document: backup schedule, location, restore procedure

#### Quality Gate

- [ ] Automated backups running on schedule
- [ ] Restore verified
- [ ] Commit: `feat(db): add SQLite backup and restore`

---

### Phase H9: CORS Lockdown (0.25 day)

**Goal:** CORS restricted to known origins in production.

#### Tasks

- [ ] **H9-01** Add `PASEO_CORS_ORIGINS` env var (comma-separated)
- [ ] **H9-02** Default: `http://localhost:6767` in dev, explicit list required in prod
- [ ] **H9-03** Fail-fast if `NODE_ENV=production` and `PASEO_CORS_ORIGINS` not set
- [ ] **H9-04** Test: cross-origin request from allowed origin → 200
- [ ] **H9-05** Test: cross-origin request from unknown origin → blocked

#### Quality Gate

- [ ] CORS explicitly configured in prod
- [ ] Dev mode permissive, prod mode strict
- [ ] Commit: `feat(security): lock down CORS in production`

---

## Tier 2 Drift Analysis & Remediation

After completing all H1-H9 phases:

```
DRIFT CHECK:
- [ ] docker compose up → all services healthy
- [ ] curl https://<domain>/health/ready → 200
- [ ] Rate limit → 429 after threshold
- [ ] CORS → blocked from unknown origin
- [ ] Sentry → test error appears in dashboard
- [ ] DB backup → file exists in backups/
- [ ] CI pipeline → push triggers build+test+deploy
- [ ] npm audit --prod --audit-level high → exits 0
- [ ] Full test suite green in CI
```

**Tag release `v0.3.0-hosted` before proceeding to Tier 3.**

---

## Tier 3: Enterprise Production (months)

Compliance, scale, multi-tenant.

### Phase E1: Audit Logging (1 week)

#### Tasks

- [ ] **E1-01** Create structured audit log: who, what, when, from where
- [ ] **E1-02** Log all auth events (login, logout, token refresh, failed auth)
- [ ] **E1-03** Log all data mutations (create, update, delete)
- [ ] **E1-04** Log all admin actions (config changes, user management)
- [ ] **E1-05** Separate audit log stream (not mixed with application logs)
- [ ] **E1-06** Tamper-evident: append-only, signed entries
- [ ] **E1-07** Retention: 90 days online, 1 year archive

### Phase E2: RBAC (1 week)

#### Tasks

- [ ] **E2-01** Define roles: admin, operator, viewer
- [ ] **E2-02** Create role-permission matrix
- [ ] **E2-03** Add `role` field to auth tokens
- [ ] **E2-04** Middleware: check role on every route
- [ ] **E2-05** UI: role-based visibility (admin settings hidden from viewers)
- [ ] **E2-06** API: role enforcement with proper 403 responses

### Phase E3: SOC2 Controls (2-4 weeks)

#### Tasks

- [ ] **E3-01** Access control documentation
- [ ] **E3-02** Change management process (PR reviews required)
- [ ] **E3-03** Incident response runbook
- [ ] **E3-04** Data classification policy
- [ ] **E3-05** Vulnerability management SLA (critical: 24h, high: 7d, moderate: 30d)
- [ ] **E3-06** Penetration testing schedule
- [ ] **E3-07** Business continuity plan

### Phase E4: Horizontal Scaling (2 weeks)

#### Tasks

- [ ] **E4-01** Migrate SQLite → PostgreSQL
- [ ] **E4-02** Add connection pooling (pg-pool or pgbouncer)
- [ ] **E4-03** Session affinity for WebSocket connections
- [ ] **E4-04** Shared state via Redis (rate limits, sessions)
- [ ] **E4-05** Docker Swarm or Kubernetes manifests
- [ ] **E4-06** Load balancer config
- [ ] **E4-07** Auto-scaling rules (CPU > 70% → scale up)

### Phase E5: CDN & Static Assets (0.5 week)

#### Tasks

- [ ] **E5-01** Separate static build output (Expo web bundle)
- [ ] **E5-02** Upload to CDN (Cloudflare R2, S3 + CloudFront)
- [ ] **E5-03** Cache headers: immutable for hashed assets, no-cache for HTML
- [ ] **E5-04** Purge strategy on deploy

### Phase E6: Disaster Recovery (1 week)

#### Tasks

- [ ] **E6-01** Multi-region backup replication
- [ ] **E6-02** Documented RTO (Recovery Time Objective) and RPO (Recovery Point Objective)
- [ ] **E6-03** DR drill schedule (quarterly)
- [ ] **E6-04** Automated failover for critical services
- [ ] **E6-05** Runbook: full restore from scratch

---

## Sprint Summary

| Tier             | Phase             | Effort        | Deliverable                    |
| ---------------- | ----------------- | ------------- | ------------------------------ |
| **L1**           | Vuln Triage       | 0.25d         | Zero high/critical prod vulns  |
| **L2**           | Green Tests       | 0.75d         | Full test suite passing        |
| **L3**           | node-pty Strategy | 0.25d         | Documented version decision    |
| **L4**           | Prod Config       | 0.25d         | Validated .env.production      |
| **L5**           | PM2               | 0.25d         | Process manager + auto-restart |
| **L6**           | Log Rotation      | 0.25d         | Disk-safe logging              |
| **Tier 1 Total** |                   | **2 days**    | **Local production ready**     |
| **H1**           | Docker            | 1d            | Containerized deployment       |
| **H2**           | TLS               | 0.5d          | HTTPS via Caddy                |
| **H3**           | Rate Limiting     | 0.5d          | Abuse prevention               |
| **H4**           | Prod Secrets      | 0.5d          | Docker secret management       |
| **H5**           | Health Probes     | 0.25d         | k8s-compatible probes          |
| **H6**           | CI/CD             | 0.5d          | Automated deploy pipeline      |
| **H7**           | Sentry            | 0.25d         | Error tracking                 |
| **H8**           | DB Backup         | 0.5d          | SQLite backup + restore        |
| **H9**           | CORS              | 0.25d         | Origin lockdown                |
| **Tier 2 Total** |                   | **4.25 days** | **Hosted production ready**    |
| **E1-E6**        | Enterprise        | ~6-8 weeks    | Compliance + scale             |

---

## Risk Register

| Risk                                    | Likelihood | Impact | Mitigation                                         |
| --------------------------------------- | ---------- | ------ | -------------------------------------------------- |
| Expo transitive vulns unfixable         | Medium     | Low    | Accept moderate risk, document in security posture |
| node-pty never ships stable 1.2         | Low        | Medium | Fall back to 1.1.0 or fork                         |
| Test failures are deep bugs             | Medium     | High   | Triage first, skip env-dependent, fix genuine      |
| Docker node-pty build fails             | Medium     | Medium | Install build-essential in build stage             |
| SQLite locks under concurrent WebSocket | Low        | High   | Monitor, plan Postgres migration if needed         |
| PM2 doesn't support Windows service     | Low        | Low    | Use `node-windows` or NSSM as alternative          |

---

## Standing Remediation Loops

Run after EVERY phase:

```bash
# Build & type check
npm run typecheck              # must exit 0

# Test suite
npx vitest run                 # must exit 0

# Format & lint
npx oxfmt --check .            # must exit 0
npx oxlint .                   # must exit 0

# Security
npm audit --prod --audit-level high  # must exit 0

# Drift check
git diff --stat HEAD~1         # review changes match plan
```

Fix all failures before marking phase done. If a remediation loop reveals a regression, file it as a blocking task in the NEXT phase — don't skip the gate.
