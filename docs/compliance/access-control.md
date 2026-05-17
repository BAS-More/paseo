# Access Control Policy

**Effective:** 2026-05-11
**Owner:** Platform team
**Review cadence:** Quarterly

## Authentication

Paseo daemon requires bearer token authentication for all API and WebSocket access. Tokens are validated against bcrypt-hashed passwords (cost 12).

### Token types

| Type                   | Env var               | Scope                           |
| ---------------------- | --------------------- | ------------------------------- |
| Legacy single password | `PASEO_PASSWORD`      | Full access (admin)             |
| Admin role password    | `PASEO_ROLE_ADMIN`    | All permissions                 |
| Operator role password | `PASEO_ROLE_OPERATOR` | Create, run, read agents + data |
| Viewer role password   | `PASEO_ROLE_VIEWER`   | Read-only                       |

### Unauthenticated endpoints

Health probes (`/health/live`, `/health/ready`, `/health/startup`) are exempt from authentication to support orchestration (k8s, Docker).

## Authorization (RBAC)

Three roles with granular permissions:

| Permission   | Admin | Operator | Viewer |
| ------------ | ----- | -------- | ------ |
| agent:create | ✅    | ✅       | ❌     |
| agent:read   | ✅    | ✅       | ✅     |
| agent:run    | ✅    | ✅       | ❌     |
| agent:delete | ✅    | ❌       | ❌     |
| data:read    | ✅    | ✅       | ✅     |
| data:write   | ✅    | ✅       | ❌     |
| config:read  | ✅    | ✅       | ✅     |
| config:write | ✅    | ❌       | ❌     |

Implementation: `packages/server/src/server/rbac.ts`

## Session management

- Bearer tokens transmitted via `Authorization` header (HTTP) or `paseo.bearer.<token>` WebSocket subprotocol
- No session cookies — stateless token auth
- Token never logged — audit trail uses SHA-256 fingerprint (`bearer:<hash12>`)

## Secret storage

Production secrets managed via Docker secrets (`/run/secrets/<name>`) with env var fallback. Implementation: `packages/server/src/server/secret-loader.ts`
