# Production Hardening Audit — Paseo Daemon

**Date:** 2026-05-11
**Scope:** Full stack — server, Docker, k8s, Caddy, dependencies, Python bridge
**Auditors:** Security reviewer, Architecture analyst, Supply chain auditor (parallel)
**Verdict:** NOT READY for commercial deployment. 1 CRITICAL, 14 HIGH, 12 MEDIUM findings.

---

## Executive Summary

Core cryptographic choices are sound (bcrypt cost-12, HMAC-SHA256 audit, token hashing). Architecture is well-layered with atomic writes and serial queues. But significant gaps exist in runtime enforcement, operational observability, and deployment configuration that must be closed before commercial/industrial use.

**Top 5 blockers:**

1. RBAC implemented but never wired — all auth = implicit admin (SEC-006)
2. Docker port 6767 exposed alongside TLS proxy, bypassing all security headers (SEC-008)
3. Docker healthcheck uses /health/live not /health/ready — routes traffic to unready containers (ARCH-007)
4. No WebSocket auth rate limiting — brute force vector (SEC-002)
5. No circuit breaker on AI provider calls — thundering herd on 429/503 (ARCH-010)

---

## P0 — CRITICAL (fix today)

### SEC-001: Live API key in .env on disk

- **File:** `packages/server/.env`
- **Finding:** Real OpenAI API key (`sk-proj-arT5...`) in plaintext. Git-ignored but on disk.
- **Fix:** Revoke key in OpenAI dashboard NOW. Re-issue via vault (`vault.py set openai api_key`).

---

## P1 — HIGH (fix before any external deployment)

### SEC-002: No rate limiting on WebSocket auth

- **File:** `websocket-server.ts:639-660`
- **Finding:** WS upgrade uses sync bcrypt with no per-IP throttle. HTTP rate limiter doesn't cover upgrades. Enables brute-force password cracking.
- **Fix:** Add connection-level rate limiter on WS upgrade keyed by IP. Switch to async bcrypt.

### SEC-003: Missing Content-Security-Policy

- **File:** `Caddyfile:13-20`
- **Finding:** HSTS, X-Frame-Options, X-Content-Type present. No CSP. XSS = full compromise.
- **Fix:** Add `Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"` + Permissions-Policy.

### SEC-004: Bearer token logged in cleartext

- **File:** `bootstrap.ts:712-722`
- **Finding:** When `mcpDebug=true`, raw Authorization header written to pino logs.
- **Fix:** Redact to `"bearer:<hash>"` using same fingerprint as audit-log.ts.

### SEC-005: Auth rate limiter defined but never wired

- **File:** `rate-limiter.ts:48-57`, `bootstrap.ts:329-333`
- **Finding:** `createAuthRateLimiter` exists, tested, never used. Global rate limiter skipped in dev.
- **Fix:** Wire auth rate limiter onto MCP + WS upgrade. Apply global limiter in all envs (higher RPM for dev).

### SEC-006: RBAC dead code — false security

- **File:** `rbac.ts:101-143`
- **Finding:** `createRbacMiddleware` + `requirePermission` fully implemented and tested but ZERO imports in bootstrap.ts or any route. All authenticated users = admin. Compliance docs claim RBAC exists.
- **Fix:** Wire `createRbacMiddleware` after auth in bootstrap.ts. Apply `requirePermission` to MCP, config, and admin routes.

### SEC-007: Redundant OPTIONS auth bypass

- **File:** `auth.ts:121-126`
- **Finding:** `shouldBypassBearerAuth` returns true for ALL OPTIONS regardless of path. CORS middleware already handles OPTIONS before auth.
- **Fix:** Add Origin header check: `if (method === "OPTIONS" && req.headers.origin) return true;` or remove entirely.

### SEC-008: Docker daemon port exposed unencrypted

- **File:** `docker-compose.prod.yml:9-10`
- **Finding:** Port 6767:6767 published to host alongside Caddy TLS proxy. Bypasses HTTPS, HSTS, CSP, all Caddy headers.
- **Fix:** Remove `ports: - "6767:6767"`. Daemon reachable only via Caddy on 443 through internal Docker network.

### ARCH-001: config.json not atomically written

- **File:** `persisted-config.ts:410-433`
- **Finding:** `savePersistedConfig` uses `writeFileSync` directly — no tmp+rename, no fsync. Crash = corrupt config (auth, providers, relay settings).
- **Fix:** Use write-to-tmp-then-rename pattern (already in agent-storage.ts). Add fsync before rename.

### ARCH-007: Docker healthcheck polls liveness not readiness

- **File:** `docker-compose.prod.yml:27`
- **Finding:** Healthcheck uses `/health/live` (always 200). Container receives traffic before bootstrap completes.
- **Fix:** Change to `["CMD", "curl", "-f", "http://localhost:6767/health/ready"]`.

### ARCH-008: PM2 silently stops restarting with no alert

- **File:** `ecosystem.config.cjs:21`
- **Finding:** `max_restarts: 10`, no notification hook. PM2 stays up, daemon dead, Docker healthcheck (liveness) passes. Service appears healthy while dead.
- **Fix:** Set error_file/out_file. Use Docker restart policy instead of PM2 auto-restart, or add PM2 post-crash webhook.

### ARCH-010: No circuit breaker on AI provider calls

- **File:** `agent/provider-registry.ts`, `agent/agent-manager.ts`
- **Finding:** Provider API failures (429, 503) trigger immediate retries. No back-off, no half-open state. Thundering herd on degraded provider.
- **Fix:** Add provider-level circuit breaker (opossum or manual). Track consecutive failures. Surface in /health/ready.

### ARCH-004: Health probes don't check dependencies

- **File:** `health-probes.ts`
- **Finding:** `/health/ready` returns 200 once bootstrapped+listening. Doesn't check: PASEO_HOME writable, disk space, agent storage accessible.
- **Fix:** Add dependency checks: PASEO_HOME writable, agent storage loaded, optional relay reachable.

### ARCH-006: No WebSocket backpressure

- **File:** `websocket-server.ts:777-789`
- **Finding:** `ws.send()` called unconditionally regardless of `bufferedAmount`. Slow client + fast agent stream = unbounded memory growth → OOM.
- **Fix:** Check `ws.bufferedAmount` before send. Pause agent subscription above threshold (1MB). Resume on drain.

### DEP-01: @anthropic-ai/sdk insecure file permissions

- **Package:** `@anthropic-ai/sdk@0.81.0` via `@mariozechner/pi-*@0.70.6`
- **Finding:** GHSA-p7fg-763f-g4gf (moderate but only high-severity in aggregate)
- **Fix:** Bump `@mariozechner/pi-ai`, `pi-agent-core`, `pi-coding-agent` to `^0.73.1`.

---

## P2 — MEDIUM (fix in next sprint)

### SEC-009: Audit HMAC optional, defaults to disabled

- **Fix:** Make `PASEO_AUDIT_HMAC_SECRET` required in production. Fail-fast in config validator.

### SEC-010: DNS rebinding protection disabled for MCP

- **Fix:** Enable SDK's `enableDnsRebindingProtection: true` or guarantee app-level host check runs first.

### SEC-011: Express trust proxy not configured

- **Fix:** Add `app.set("trust proxy", 1)` when behind Caddy. req.ip currently shows Caddy internal IP.

### SEC-012: Unvalidated callerAgentId in MCP route

- **Fix:** Validate against agentStorage.exists() before passing to MCP transport.

### ARCH-002: appendFileSync blocks event loop (audit log)

- **Fix:** Use async append queue or pino-roll. Add explicit fsync on close.

### ARCH-003: Sync config read on every patch()

- **Fix:** Maintain in-memory config copy. Only write on mutation. Eliminate re-read from disk.

### ARCH-005: Relay data sockets have no retry or connection limit

- **Fix:** Add max concurrent data socket limit. Add per-socket retry with backoff.

### ARCH-009: LoopService not stopped during shutdown

- **Fix:** Add `loopService.stop()` to shutdown sequence before `closeAllAgents`.

### ARCH-011: Bcrypt compareSync on WS upgrade blocks event loop

- **Fix:** Move to async bcrypt for WS auth. Restructure to reject post-upgrade.

### ARCH-012: No Prometheus /metrics endpoint

- **Fix:** Add prom-client behind auth. Export: ws_connections_active, agents_active, backup_last_success, agent_errors_by_provider.

### DEP-02: Docker base image not pinned to digest

- **Fix:** Pin `node:22-slim@sha256:<digest>`. Update via Dependabot.

### DEP-03: Python requirements not pinned

- **Fix:** Add `requirements.lock` with exact versions. Separate test deps.

---

## P3 — LOW (fix if time permits)

| ID       | Finding                              | Fix                                             |
| -------- | ------------------------------------ | ----------------------------------------------- |
| SEC-013  | /api/status exposes hostname         | Omit hostname and listen address                |
| ARCH-013 | Workspace registry grows unbounded   | Add periodic compaction of archived records     |
| ARCH-014 | Shutdown force-exit 10s too short    | Increase to 30s in production                   |
| ARCH-015 | Secret rotation requires restart     | Add SIGHUP config reload handler                |
| ARCH-016 | No blue/green deployment support     | Add version field to schemas + canary swap docs |
| ARCH-017 | Backup uses cpSync without checksums | Add SHA-256 manifest per backup                 |
| DEP-04   | markdown-it ReDoS (no fix upstream)  | Replace react-native-markdown-display           |
| DEP-05   | Electron 1 major behind              | Bump to 42.x                                    |
| DEP-06   | Internal packages missing license    | Add AGPL-3.0-or-later to each                   |
| DEP-07   | postcss XSS (expo transitive)        | Add npm override for postcss>=8.5.10            |

---

## Positive Findings (maintain these)

- Atomic file writes via write-tmp-then-rename in agent-storage.ts and workspace-registry.ts
- Serial write queues preventing concurrent file corruption
- bcrypt at cost 12 for password hashing
- HMAC-SHA256 for audit log tamper evidence (when enabled)
- Token fingerprinting (SHA-256 hash, never raw tokens) in audit entries
- Structured pino logging with configurable levels and file output
- Health probe stratification (liveness/readiness/startup)
- DNS rebinding protection at app level
- npm overrides for 10 known transitive CVEs
- Docker multi-stage build with USER node
- No GPL-only deps in production runtime
- Zero high/critical npm vulnerabilities in production deps

---

## Recommended Fix Order

### Sprint A (1-2 days) — Security blockers

1. Revoke OpenAI key (SEC-001)
2. Remove Docker port exposure (SEC-008)
3. Fix Docker healthcheck to /health/ready (ARCH-007)
4. Wire RBAC middleware (SEC-006)
5. Add CSP header (SEC-003)
6. Redact bearer token in debug logs (SEC-004)

### Sprint B (2-3 days) — Runtime hardening

7. WS auth rate limiting (SEC-002)
8. Wire auth rate limiter (SEC-005)
9. Atomic config.json writes (ARCH-001)
10. WebSocket backpressure (ARCH-006)
11. Circuit breaker for providers (ARCH-010)
12. Dependency health in readiness probe (ARCH-004)

### Sprint C (1-2 days) — Operational maturity

13. PM2 alerting or Docker restart strategy (ARCH-008)
14. Express trust proxy (SEC-011)
15. Prometheus /metrics endpoint (ARCH-012)
16. LoopService shutdown (ARCH-009)
17. Bump @mariozechner/pi-\* deps (DEP-01)
18. Pin Docker base image digest (DEP-02)

### Sprint D (1 day) — Cleanup

19-27. Remaining P2/P3 items

---

**Total estimated effort: 5-8 days for P0+P1+P2. All P3 items can be deferred to next cycle.**
