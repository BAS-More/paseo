# Disaster Recovery Runbook — Full Restore from Scratch

**Effective:** 2026-05-11
**Owner:** Platform team
**Last tested:** N/A (schedule first drill by 2026-08-11)

## Prerequisites

- Docker + Docker Compose installed on target host
- SSH access to target host
- Access to GHCR (GitHub Container Registry)
- Latest backup of `$PASEO_HOME` (off-host copy)

## Step 1: Provision host

```bash
# Minimum requirements: 1 vCPU, 1GB RAM, 20GB disk
# Install Docker (Ubuntu example)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

## Step 2: Pull deployment files

```bash
git clone https://github.com/BAS-More/paseo.git
cd paseo
```

## Step 3: Configure secrets

```bash
# Create secrets directory
mkdir -p /run/secrets

# Set required secrets (replace with actual values)
echo "YOUR_HASHED_PASSWORD" > /run/secrets/paseo_password
echo "sk-ant-..." > /run/secrets/anthropic_api_key

# Or use .env file approach
cp packages/server/.env.production.example .env
# Edit .env with production values
```

## Step 4: Restore data from backup

```bash
# Create PASEO_HOME directory
mkdir -p /var/lib/paseo

# Copy backup contents to PASEO_HOME
# (from off-host backup location)
cp -r /path/to/backup/* /var/lib/paseo/

# Verify structure
ls /var/lib/paseo/
# Expected: agents/ projects/ config.json (varies by installation)
```

## Step 5: Pull and start services

```bash
# Pull latest image
docker pull ghcr.io/bas-more/paseo/paseo-daemon:latest

# Start with compose
docker compose -f docker-compose.prod.yml up -d

# Or specific version
PASEO_IMAGE=ghcr.io/bas-more/paseo/paseo-daemon:sha-abc1234 \
  docker compose -f docker-compose.prod.yml up -d
```

## Step 6: Verify

```bash
# Health check (retry up to 30 seconds)
for i in $(seq 1 15); do
  curl -sf http://localhost:6767/health/live && echo " OK" && break
  echo "Waiting... ($i)"
  sleep 2
done

# Readiness (should be 200 after bootstrap)
curl -s http://localhost:6767/health/ready | jq .

# Verify auth works
curl -s -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:6767/api/health | jq .

# Verify data restored
curl -s -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:6767/mcp/agents | jq .
```

## Step 7: Restore DNS and TLS

```bash
# Update DNS A record to point to new host IP
# Caddy will auto-provision TLS certificate

# Verify TLS
curl -s https://paseo.example.com/health/live
```

## Rollback

If the restore fails:

1. Stop services: `docker compose -f docker-compose.prod.yml down`
2. Try an older backup from `$PASEO_HOME/backups/`
3. If no local backup, restore from off-host archive
4. Escalate to platform lead if data is unrecoverable

## Post-restore checklist

- [ ] Health endpoints responding (live, ready, startup)
- [ ] Auth working (bearer token accepted)
- [ ] Agent data present and accessible
- [ ] Sentry receiving errors (trigger test error)
- [ ] Backups resuming on schedule (check after 6 hours)
- [ ] Audit logging active (check `$PASEO_HOME/audit/`)
- [ ] TLS certificate valid
- [ ] DNS resolving correctly
