# Data Classification Policy

**Effective:** 2026-05-11
**Owner:** Platform team
**Review cadence:** Annually

## Classification levels

| Level            | Definition                      | Examples                                            | Storage                                     | Access           |
| ---------------- | ------------------------------- | --------------------------------------------------- | ------------------------------------------- | ---------------- |
| **Confidential** | Secrets, credentials, API keys  | PASEO_PASSWORD, ANTHROPIC_API_KEY, bearer tokens    | Docker secrets / env vars only              | Admin only       |
| **Internal**     | User data, agent configurations | Agent definitions, session history, project configs | `$PASEO_HOME/` encrypted at rest (OS-level) | Admin + Operator |
| **Public**       | Non-sensitive operational data  | Health status, version info, public docs            | Served via API                              | All roles        |

## Data handling rules

### Confidential

- Never logged (tokens hashed to 12-char SHA-256 fingerprint in audit trail)
- Never stored in plaintext files — Docker secrets or env vars only
- Never transmitted in URL parameters
- Secret loader (`secret-loader.ts`) reads from `/run/secrets/` first, env fallback
- Bcrypt cost 12 for password hashing

### Internal

- Stored in `$PASEO_HOME/` as JSON files
- Backed up every 6 hours, retained 7 days
- Audit trail for all mutations (create, update, delete)
- Access controlled by RBAC role

### Public

- Health endpoints unauthenticated (k8s probe compatibility)
- Static assets served from `/public/`
- No PII in public responses

## Data retention

| Data type        | Online retention         | Archive                 | Deletion                         |
| ---------------- | ------------------------ | ----------------------- | -------------------------------- |
| Audit logs       | 90 days                  | 1 year (manual archive) | Auto-pruned via `pruneAuditLogs` |
| Backups          | 7 days                   | Manual                  | Auto-pruned via `pruneBackups`   |
| Application logs | 7 files × 50MB (rotated) | None                    | Auto-rotated                     |
| Agent data       | Indefinite               | Via backup              | Manual deletion                  |

## Data flow

```
User → Bearer token (Confidential)
     → Paseo daemon (TLS via Caddy)
     → Agent providers (API keys via env/secrets)
     → LLM APIs (external, token-authenticated)

All LLM API calls optionally routed through 9Router for token management.
```
