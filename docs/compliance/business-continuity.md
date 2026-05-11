# Business Continuity Plan

**Effective:** 2026-05-11
**Owner:** Platform team
**Review cadence:** Annually

## Recovery objectives

| Metric                             | Target     | Current capability                  |
| ---------------------------------- | ---------- | ----------------------------------- |
| **RTO** (Recovery Time Objective)  | 30 minutes | ~15 min (Docker redeploy from GHCR) |
| **RPO** (Recovery Point Objective) | 6 hours    | 6 hours (backup interval)           |

## Failure scenarios

### Daemon crash

- **Detection**: PM2 detects exit, Docker health check fails
- **Auto-recovery**: PM2 restarts (max 10 attempts, 1s delay); Docker `restart: unless-stopped`
- **Manual**: `pm2 restart paseo-daemon` or `docker compose restart paseo-daemon`

### Data corruption

- **Detection**: Application errors, inconsistent state
- **Recovery**:
  1. Stop daemon
  2. List backups: `ls $PASEO_HOME/backups/`
  3. Pick latest good backup
  4. Restore: copy backup contents to `$PASEO_HOME/`
  5. Restart daemon
- **RPO**: Up to 6 hours of data loss

### Host failure

- **Recovery**:
  1. Provision new host
  2. Pull image from GHCR: `docker pull ghcr.io/bas-more/paseo/paseo-daemon:latest`
  3. Restore `$PASEO_HOME` from off-host backup
  4. Start with `docker compose up -d`
- **RTO**: ~30 minutes (image pull + data restore)

### CI/CD pipeline failure

- **Detection**: GitHub Actions failure notification
- **Recovery**: Manual deploy via SSH
  1. SSH to host
  2. `docker pull ghcr.io/bas-more/paseo/paseo-daemon:latest`
  3. `docker compose up -d`
  4. Verify: `curl http://localhost:6767/health/live`

### Bad deployment

- **Detection**: Smoke test failure (automatic), Sentry error spike (manual)
- **Auto-recovery**: CI rollback restores previous image
- **Manual**: `docker tag $PREVIOUS_IMAGE paseo-daemon:latest && docker compose up -d`

## Backup strategy

| What             | Schedule            | Retention         | Location               |
| ---------------- | ------------------- | ----------------- | ---------------------- |
| Application data | Every 6 hours       | 7 days            | `$PASEO_HOME/backups/` |
| Audit logs       | Continuous (append) | 90 days           | `$PASEO_HOME/audit/`   |
| Docker image     | Every push to main  | Latest + SHA tags | GHCR                   |
| Source code      | Every commit        | Indefinite        | GitHub                 |

## Testing schedule

| Test                        | Frequency | Next due   |
| --------------------------- | --------- | ---------- |
| Backup restore verification | Monthly   | 2026-06-11 |
| Failover drill              | Quarterly | 2026-08-11 |
| Full DR test                | Annually  | 2027-05-11 |
