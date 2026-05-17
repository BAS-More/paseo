# Incident Response Runbook

**Effective:** 2026-05-11
**Owner:** Platform team
**Review cadence:** Quarterly

## Severity levels

| Level | Definition                        | Response time     | Example                           |
| ----- | --------------------------------- | ----------------- | --------------------------------- |
| P0    | Service down, data loss risk      | 15 min            | Daemon crash loop, backup failure |
| P1    | Degraded service, security breach | 1 hour            | Auth bypass, Sentry flood         |
| P2    | Partial outage, no data risk      | 4 hours           | Single provider failing           |
| P3    | Minor issue, workaround exists    | Next business day | UI glitch, log noise              |

## Response procedure

### 1. Detect

- Sentry alerts for unhandled exceptions
- Health probe failures trigger Docker/k8s restart
- Audit log anomalies (repeated auth.reject from same IP)

### 2. Triage

- Check `/health/ready` — is daemon responsive?
- Check Sentry dashboard — what's the error?
- Check audit logs (`$PASEO_HOME/audit/`) — unusual activity?
- Check application logs (`$PASEO_HOME/logs/`) — stack traces?

### 3. Contain

- **Rate limit breach**: IP already rate-limited (100 req/min); block at network level if persistent
- **Auth bypass**: Rotate `PASEO_PASSWORD` immediately, restart daemon
- **Data corruption**: Stop daemon, restore from latest backup (`$PASEO_HOME/backups/`)
- **Crash loop**: PM2 stops after 10 restarts; check logs, fix root cause, restart

### 4. Resolve

- Deploy fix via CI/CD pipeline (auto-rollback on smoke failure)
- For emergency: direct SSH deploy with rollback plan

### 5. Post-incident

- Document timeline in incident report within 48 hours
- Root cause analysis
- Preventive measures added to codebase or monitoring
- Update this runbook if needed

## Backup and restore

- **Schedule**: Every 6 hours (production)
- **Retention**: 7 days
- **Location**: `$PASEO_HOME/backups/`
- **Restore**: Stop daemon → run `restoreBackup(backupPath, paseoHome)` → restart
- **Verification**: Backup includes agents, projects, config (excludes logs and previous backups)

## Contact escalation

| Role             | Responsibility                           |
| ---------------- | ---------------------------------------- |
| On-call engineer | First responder, triage + contain        |
| Platform lead    | P0/P1 escalation, architecture decisions |
| Security lead    | Auth/data breach incidents               |
