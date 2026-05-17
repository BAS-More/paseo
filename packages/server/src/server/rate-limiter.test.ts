import { describe, it, expect } from "vitest";
import {
  resolveRateLimiterConfig,
  createGlobalRateLimiter,
  createAuthRateLimiter,
} from "./rate-limiter.js";

describe("resolveRateLimiterConfig", () => {
  it("returns defaults with empty env", () => {
    const config = resolveRateLimiterConfig({});
    expect(config.globalRpm).toBe(100);
    expect(config.authRpm).toBe(10);
  });

  it("reads PASEO_RATE_LIMIT_RPM from env", () => {
    const config = resolveRateLimiterConfig({ PASEO_RATE_LIMIT_RPM: "200" });
    expect(config.globalRpm).toBe(200);
  });

  it("reads PASEO_RATE_LIMIT_AUTH_RPM from env", () => {
    const config = resolveRateLimiterConfig({ PASEO_RATE_LIMIT_AUTH_RPM: "5" });
    expect(config.authRpm).toBe(5);
  });

  it("falls back to default on invalid env value", () => {
    const config = resolveRateLimiterConfig({ PASEO_RATE_LIMIT_RPM: "not-a-number" });
    expect(config.globalRpm).toBe(100);
  });

  it("falls back to default on zero", () => {
    const config = resolveRateLimiterConfig({ PASEO_RATE_LIMIT_RPM: "0" });
    expect(config.globalRpm).toBe(100);
  });

  it("falls back to default on negative", () => {
    const config = resolveRateLimiterConfig({ PASEO_RATE_LIMIT_RPM: "-5" });
    expect(config.globalRpm).toBe(100);
  });
});

describe("createGlobalRateLimiter", () => {
  it("returns a middleware function", () => {
    const middleware = createGlobalRateLimiter();
    expect(typeof middleware).toBe("function");
  });

  it("accepts custom config", () => {
    const middleware = createGlobalRateLimiter({ globalRpm: 50 });
    expect(typeof middleware).toBe("function");
  });
});

describe("createAuthRateLimiter", () => {
  it("returns a middleware function", () => {
    const middleware = createAuthRateLimiter();
    expect(typeof middleware).toBe("function");
  });

  it("accepts custom config", () => {
    const middleware = createAuthRateLimiter({ authRpm: 3 });
    expect(typeof middleware).toBe("function");
  });
});
