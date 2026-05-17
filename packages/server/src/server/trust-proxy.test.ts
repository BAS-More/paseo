import { describe, it, expect, afterEach } from "vitest";

/**
 * Tests for the PASEO_TRUST_PROXY logic that controls Express trust proxy
 * configuration. This is relevant for accurate req.ip when running behind
 * Caddy/nginx (SEC-011).
 *
 * The logic lives in bootstrap.ts. We test the derivation function
 * directly to avoid spinning up the full daemon.
 */

import { resolveTrustProxy } from "./trust-proxy.js";

describe("resolveTrustProxy", () => {
  afterEach(() => {
    delete process.env.PASEO_TRUST_PROXY;
  });

  it("returns undefined in dev mode with no env var (trust proxy disabled)", () => {
    expect(resolveTrustProxy({ isDev: true })).toBeUndefined();
  });

  it("returns 1 in production mode with no env var (trust proxy enabled)", () => {
    expect(resolveTrustProxy({ isDev: false })).toBe(1);
  });

  it("returns 1 when PASEO_TRUST_PROXY=1 even in dev mode", () => {
    process.env.PASEO_TRUST_PROXY = "1";
    expect(resolveTrustProxy({ isDev: true })).toBe(1);
  });

  it("returns 1 when PASEO_TRUST_PROXY=true even in dev mode", () => {
    process.env.PASEO_TRUST_PROXY = "true";
    expect(resolveTrustProxy({ isDev: true })).toBe(1);
  });

  it("returns undefined when PASEO_TRUST_PROXY=0 even in production", () => {
    process.env.PASEO_TRUST_PROXY = "0";
    expect(resolveTrustProxy({ isDev: false })).toBeUndefined();
  });

  it("returns a string value for non-boolean PASEO_TRUST_PROXY in production", () => {
    // Express supports hop counts ("2") and named trust policies ("loopback")
    process.env.PASEO_TRUST_PROXY = "loopback";
    expect(resolveTrustProxy({ isDev: false })).toBe("loopback");
  });

  it("returns a string value for hop count PASEO_TRUST_PROXY in dev", () => {
    process.env.PASEO_TRUST_PROXY = "2";
    expect(resolveTrustProxy({ isDev: true })).toBe("2");
  });
});
