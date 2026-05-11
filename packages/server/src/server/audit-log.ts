import { mkdirSync, readdirSync, statSync, rmSync, existsSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { createHmac, createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { WriteStream } from "node:fs";

/**
 * Structured audit event — who did what, when, from where.
 */
export interface AuditEvent {
  action: string;
  actor: string;
  ip: string;
  path: string;
  method: string;
  statusCode: number;
  meta?: Record<string, unknown>;
}

export interface AuditLogger {
  log(event: AuditEvent): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

interface AuditLoggerConfig {
  auditLogDir: string;
  hmacSecret?: string;
}

/**
 * Create append-only audit logger writing NDJSON to a dated file.
 * Each entry includes a timestamp. When hmacSecret is provided,
 * entries are signed with HMAC-SHA256 for tamper evidence.
 *
 * Uses a write stream internally to avoid blocking the event loop.
 * Call flush() to drain pending writes, or close() for graceful shutdown.
 */
export function createAuditLogger(config: AuditLoggerConfig): AuditLogger {
  mkdirSync(config.auditLogDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const filePath = join(config.auditLogDir, `audit-${date}.ndjson`);

  const stream: WriteStream = createWriteStream(filePath, { flags: "a" });
  let closed = false;
  let writeChain: Promise<void> = Promise.resolve();

  // Swallow post-close errors (e.g. temp dir removed while stream finalizes)
  stream.on("error", () => {});

  return {
    log(event: AuditEvent) {
      if (closed) {
        return;
      }

      const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        action: event.action,
        actor: event.actor,
        ip: event.ip,
        path: event.path,
        method: event.method,
        statusCode: event.statusCode,
      };

      if (event.meta) {
        entry.meta = event.meta;
      }

      if (config.hmacSecret) {
        const payload = JSON.stringify(entry);
        entry._hmac = createHmac("sha256", config.hmacSecret).update(payload).digest("hex");
      }

      const line = JSON.stringify(entry) + "\n";
      writeChain = writeChain.then(
        () =>
          new Promise<void>((resolve, reject) => {
            stream.write(line, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          }),
      );
    },

    async flush(): Promise<void> {
      await writeChain;
    },

    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await writeChain;
      await new Promise<void>((resolve) => {
        stream.end(resolve);
      });
    },
  };
}

const ONLINE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * Prune audit log files older than retention period.
 * Returns count of removed files.
 */
export function pruneAuditLogs(
  auditLogDir: string,
  options?: { maxAgeMs?: number; now?: Date },
): number {
  if (!existsSync(auditLogDir)) return 0;

  const maxAge = options?.maxAgeMs ?? ONLINE_RETENTION_MS;
  const now = options?.now ?? new Date();
  let pruned = 0;

  for (const entry of readdirSync(auditLogDir)) {
    if (!entry.startsWith("audit-") || !entry.endsWith(".ndjson")) continue;
    const filePath = join(auditLogDir, entry);
    try {
      const stat = statSync(filePath);
      if (now.getTime() - stat.mtimeMs > maxAge) {
        rmSync(filePath);
        pruned++;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return pruned;
}

/** Paths to skip — health probes, static assets */
const SKIP_PATHS = ["/health/", "/favicon.ico", "/public/"];

/** HTTP methods that indicate data mutation */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths that represent admin/config operations */
const ADMIN_PATH_PREFIXES = ["/api/settings", "/api/config", "/api/providers"];

/**
 * Hash a bearer token to a short fingerprint for audit trail.
 * Never log raw tokens.
 */
function hashToken(token: string): string {
  return "bearer:" + createHash("sha256").update(token).digest("hex").slice(0, 12);
}

/**
 * Extract actor identity from request.
 * Returns hashed bearer token or "anonymous".
 */
function extractActor(req: { headers: Record<string, string | string[] | undefined> }): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return hashToken(authHeader.slice(7));
  }
  return "anonymous";
}

/**
 * Express middleware that logs audit events for:
 * - Auth rejections (401/403)
 * - Data mutations (POST/PUT/PATCH/DELETE)
 * - Admin config changes
 *
 * Skips health probes and static assets.
 */
export function createAuditMiddleware(logger: AuditLogger): RequestHandler {
  return (req, res, next) => {
    const reqPath = req.path;

    if (SKIP_PATHS.some((p) => reqPath.startsWith(p))) {
      next();
      return;
    }

    res.on("finish", () => {
      const statusCode = res.statusCode;
      const method = req.method;
      const actor = extractActor(req);
      const ip = req.ip ?? "unknown";

      // Auth rejections
      if (statusCode === 401 || statusCode === 403) {
        logger.log({
          action: "auth.reject",
          actor,
          ip,
          path: reqPath,
          method,
          statusCode,
        });
        return;
      }

      // Data mutations — classify admin vs data
      if (MUTATION_METHODS.has(method)) {
        const isAdmin = ADMIN_PATH_PREFIXES.some((p) => reqPath.startsWith(p));
        logger.log({
          action: isAdmin ? "admin.config" : "data.mutate",
          actor,
          ip,
          path: reqPath,
          method,
          statusCode,
        });
      }
    });

    next();
  };
}
