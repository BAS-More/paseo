import type { PaseoDaemonConfig } from "./bootstrap.js";

interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate daemon config for production readiness.
 * In development mode, issues are logged as warnings.
 * In production mode (NODE_ENV=production or PASEO_NODE_ENV=production),
 * missing required fields cause a hard failure.
 */
export function validateConfig(
  config: PaseoDaemonConfig,
  options?: { env?: NodeJS.ProcessEnv },
): ValidationError[] {
  const errors: ValidationError[] = [];
  const env = options?.env ?? process.env;

  if (!config.paseoHome) {
    errors.push({
      field: "PASEO_HOME",
      message: "PASEO_HOME is required. Set it to the daemon state directory (default: ~/.paseo).",
    });
  }

  if (!config.listen) {
    errors.push({
      field: "PASEO_LISTEN",
      message:
        "PASEO_LISTEN is required. Set to host:port (e.g., 127.0.0.1:6767) or a Unix socket path.",
    });
  }

  // Auth: in production, at least a password or an API key should be set
  const isProduction = env.NODE_ENV === "production" || env.PASEO_NODE_ENV === "production";

  if (isProduction) {
    if (!config.auth?.password) {
      errors.push({
        field: "PASEO_PASSWORD",
        message: "PASEO_PASSWORD is required in production. Set a strong password for daemon auth.",
      });
    }

    // CORS: production should have explicit origins configured
    if (config.corsAllowedOrigins.length === 0) {
      errors.push({
        field: "PASEO_CORS_ORIGINS",
        message:
          "No CORS origins configured. Cross-origin requests will be blocked. Set PASEO_CORS_ORIGINS to a comma-separated list of allowed origins (e.g., https://app.paseo.sh).",
      });
    }

    // Warn about wildcard CORS in production
    if (config.corsAllowedOrigins.includes("*")) {
      errors.push({
        field: "PASEO_CORS_ORIGINS",
        message:
          "CORS wildcard (*) is set in production. This allows any origin to make requests. Use explicit origins for security.",
      });
    }

    // Warn if listening on 0.0.0.0 without auth
    if (
      config.listen &&
      (config.listen.startsWith("0.0.0.0") || config.listen.startsWith("::")) &&
      !config.auth?.password
    ) {
      errors.push({
        field: "PASEO_LISTEN",
        message:
          "Listening on all interfaces without PASEO_PASSWORD is unsafe. Set PASEO_PASSWORD or bind to 127.0.0.1.",
      });
    }

    // SEC-009: PASEO_AUDIT_HMAC_SECRET must be set in production. Without it,
    // audit log entries can be tampered with after the fact — the HMAC chain
    // provides tamper evidence. loadSecret reads /run/secrets/<name> first,
    // then falls back to env, so we honor both paths.
    const hmacFromEnv = env.PASEO_AUDIT_HMAC_SECRET;
    const hmacFromSecret = secretFileExists("/run/secrets/PASEO_AUDIT_HMAC_SECRET");
    if (!hmacFromEnv && !hmacFromSecret) {
      errors.push({
        field: "PASEO_AUDIT_HMAC_SECRET",
        message:
          "PASEO_AUDIT_HMAC_SECRET is required in production for tamper-evident audit logs. Set as Docker secret or environment variable (32+ random bytes recommended).",
      });
    }
  }

  return errors;
}

function secretFileExists(path: string): boolean {
  try {
    // Lazy-import fs so this module stays lightweight in tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node:fs").existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Validate config and exit if there are errors in production mode.
 * In development, errors are logged as warnings and execution continues.
 */
export function validateConfigOrExit(
  config: PaseoDaemonConfig,
  options?: {
    env?: NodeJS.ProcessEnv;
    logger?: { warn: (msg: string) => void; error: (msg: string) => void };
  },
): void {
  const env = options?.env ?? process.env;
  const errors = validateConfig(config, { env });

  if (errors.length === 0) {
    return;
  }

  const isProduction = env.NODE_ENV === "production" || env.PASEO_NODE_ENV === "production";

  const log = options?.logger ?? {
    warn: (msg: string) => process.stderr.write(`[WARN] ${msg}\n`),
    error: (msg: string) => process.stderr.write(`[ERROR] ${msg}\n`),
  };

  for (const error of errors) {
    if (isProduction) {
      log.error(`Config validation failed: ${error.field} — ${error.message}`);
    } else {
      log.warn(`Config warning: ${error.field} — ${error.message}`);
    }
  }

  if (isProduction) {
    log.error(
      `${errors.length} config error(s). Fix the above and restart. See .env.production for required variables.`,
    );
    process.exit(1);
  }
}
