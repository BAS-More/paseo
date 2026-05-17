/**
 * Resolves the Express "trust proxy" setting based on environment and config.
 *
 * Returns:
 *   - 1 (number) when exactly one hop should be trusted (Caddy/nginx direct).
 *   - A string for named policies or hop counts from PASEO_TRUST_PROXY.
 *   - undefined when trust proxy should remain disabled.
 *
 * SEC-011: without trust proxy, req.ip always shows the reverse proxy's
 * internal IP, making audit logs and rate limiting useless for forensics.
 */
export function resolveTrustProxy(opts: { isDev: boolean }): number | string | undefined {
  const envValue = process.env.PASEO_TRUST_PROXY;

  if (envValue !== undefined) {
    // Explicit opt-out via env var
    if (envValue === "0" || envValue === "false") {
      return undefined;
    }
    // Boolean trust-one-hop shorthand
    if (envValue === "1" || envValue === "true") {
      return 1;
    }
    // Named policy or hop count string (e.g. "loopback", "2")
    return envValue;
  }

  // Default: enable in production (behind Caddy), disable in dev
  return opts.isDev ? undefined : 1;
}
