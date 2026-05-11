import { rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";

const DEFAULT_GLOBAL_RPM = 100;
const DEFAULT_AUTH_RPM = 10;

function parseRpmEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RateLimiterConfig {
  globalRpm: number;
  authRpm: number;
}

export function resolveRateLimiterConfig(env: NodeJS.ProcessEnv = process.env): RateLimiterConfig {
  return {
    globalRpm: parseRpmEnv(env, "PASEO_RATE_LIMIT_RPM", DEFAULT_GLOBAL_RPM),
    authRpm: parseRpmEnv(env, "PASEO_RATE_LIMIT_AUTH_RPM", DEFAULT_AUTH_RPM),
  };
}

/**
 * Global rate limiter — applies to all API requests.
 * Default: 100 requests per minute per IP.
 */
export function createGlobalRateLimiter(config?: Partial<RateLimiterConfig>): RequestHandler {
  const rpm = config?.globalRpm ?? DEFAULT_GLOBAL_RPM;
  return rateLimit({
    windowMs: 60_000,
    max: rpm,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests", retryAfterSeconds: 60 },
    skip: (req) => req.path === "/api/health",
  });
}

/**
 * Stricter rate limiter for auth-sensitive endpoints.
 * Default: 10 requests per minute per IP.
 */
export function createAuthRateLimiter(config?: Partial<RateLimiterConfig>): RequestHandler {
  const rpm = config?.authRpm ?? DEFAULT_AUTH_RPM;
  return rateLimit({
    windowMs: 60_000,
    max: rpm,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many auth attempts", retryAfterSeconds: 60 },
  });
}
