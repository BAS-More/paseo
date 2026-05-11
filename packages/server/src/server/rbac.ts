import { compare, compareSync } from "bcryptjs";
import type { RequestHandler } from "express";

/**
 * Role hierarchy: admin > operator > viewer.
 */
export type Role = "admin" | "operator" | "viewer";

/**
 * Granular permissions for RBAC enforcement.
 */
export type Permission =
  | "agent:create"
  | "agent:read"
  | "agent:run"
  | "agent:delete"
  | "data:read"
  | "data:write"
  | "config:read"
  | "config:write";

/**
 * Role → permission matrix.
 * admin: full access
 * operator: create + run agents, read/write data, read config
 * viewer: read-only
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    "agent:create",
    "agent:read",
    "agent:run",
    "agent:delete",
    "data:read",
    "data:write",
    "config:read",
    "config:write",
  ],
  operator: ["agent:create", "agent:read", "agent:run", "data:read", "data:write", "config:read"],
  viewer: ["agent:read", "data:read", "config:read"],
};

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission);
}

/**
 * Per-role bcrypt-hashed passwords.
 * Set via PASEO_ROLE_ADMIN, PASEO_ROLE_OPERATOR, PASEO_ROLE_VIEWER env vars.
 */
export interface RolePasswords {
  admin?: string;
  operator?: string;
  viewer?: string;
}

/** Role priority — check admin first, then operator, then viewer. */
const ROLE_PRIORITY: readonly Role[] = ["admin", "operator", "viewer"];

/**
 * Resolve which role a bearer token belongs to.
 * Checks each role's password in priority order (admin first).
 * Returns null if token matches no role.
 *
 * When no role passwords are configured (legacy single-password mode),
 * returns "admin" — backward compatible with existing auth.
 *
 * SYNCHRONOUS — blocks the event loop while bcrypt runs. Prefer
 * `resolveRoleAsync` for new code paths. Kept for callers that can't
 * thread async (e.g. WebSocket upgrade handshakes in older code).
 */
export function resolveRole(
  token: string,
  passwords: RolePasswords,
  compareFn?: (token: string, hash: string) => boolean,
): Role | null {
  const hasAnyRolePassword = passwords.admin || passwords.operator || passwords.viewer;

  if (!hasAnyRolePassword) {
    // Legacy mode: single PASEO_PASSWORD auth → treat as admin
    return "admin";
  }

  for (const role of ROLE_PRIORITY) {
    const hash = passwords[role];
    if (!hash) continue;

    const matches = compareFn ? compareFn(token, hash) : compareSync(token, hash);
    if (matches) return role;
  }

  return null;
}

/**
 * Async variant of resolveRole. Each bcrypt compare is awaited so the event
 * loop stays responsive while the cost-12 hash check (~10ms per call) runs.
 * Use this from Express middleware and HTTP route handlers.
 */
export async function resolveRoleAsync(
  token: string,
  passwords: RolePasswords,
  compareFn?: (token: string, hash: string) => Promise<boolean>,
): Promise<Role | null> {
  const hasAnyRolePassword = passwords.admin || passwords.operator || passwords.viewer;

  if (!hasAnyRolePassword) {
    return "admin";
  }

  for (const role of ROLE_PRIORITY) {
    const hash = passwords[role];
    if (!hash) continue;

    const matches = await (compareFn ? compareFn(token, hash) : compare(token, hash));
    if (matches) return role;
  }

  return null;
}

/**
 * Express middleware that enforces a permission on the current request.
 * Reads `req.paseoRole` (set by RBAC middleware) and checks against
 * the role-permission matrix.
 *
 * Returns 403 if the role lacks the required permission.
 */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, res, next) => {
    const role = (req as unknown as Record<string, unknown>).paseoRole as Role | undefined;

    if (!role || !hasPermission(role, permission)) {
      res.status(403).json({
        error: "Forbidden",
        required: permission,
        role: role ?? "none",
      });
      return;
    }

    next();
  };
}

/**
 * Express middleware that resolves the caller's role from the bearer token
 * and attaches it as `req.paseoRole`. Must run after bearer auth middleware.
 *
 * When no role passwords are configured, all authenticated requests
 * get "admin" role (backward compatible).
 *
 * H-05: uses async bcrypt compare so the event loop stays responsive even
 * when several role passwords are configured (each compare is ~10ms at
 * cost 12).
 */
export function createRbacMiddleware(passwords: RolePasswords): RequestHandler {
  return (req, _res, next) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      // No token → no role (auth middleware handles 401)
      next();
      return;
    }

    const token = authHeader.slice(7);
    void (async () => {
      try {
        const role = await resolveRoleAsync(token, passwords);
        if (role) {
          (req as unknown as Record<string, unknown>).paseoRole = role;
        }
        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  };
}
