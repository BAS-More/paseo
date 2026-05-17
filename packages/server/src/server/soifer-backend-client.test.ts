import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker } from "./agent/circuit-breaker.js";
import { SoiferBackendClient } from "./soifer-backend-client.js";

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError() {
  return vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
}

function mockFetchNotOk() {
  return vi.fn().mockResolvedValue({ ok: false, status: 503 });
}

describe("SoiferBackendClient", () => {
  it("returns reachable on /health 200", async () => {
    const client = new SoiferBackendClient({ _fetchForTest: mockFetchOk({}) });
    const result = await client.checkHealth();
    expect(result).toEqual({ reachable: true });
  });

  it("returns not reachable on network error", async () => {
    const client = new SoiferBackendClient({ _fetchForTest: mockFetchError() });
    const result = await client.checkHealth();
    expect(result).toEqual({ reachable: false });
  });

  it("returns degraded stack health on non-ok", async () => {
    const client = new SoiferBackendClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.getStackHealth();
    expect(result.status).toBe("degraded");
    expect(result.services).toEqual({});
  });

  it("returns parsed stack health on success", async () => {
    const fetchFn = mockFetchOk({ status: "ok", services: { paseo: { status: "ok" } } });
    const client = new SoiferBackendClient({ _fetchForTest: fetchFn });
    const result = await client.getStackHealth();
    expect(result.status).toBe("ok");
    expect(result.services.paseo).toEqual({ status: "ok" });
  });

  it("uses custom base URL", async () => {
    const fetchFn = mockFetchOk({});
    const client = new SoiferBackendClient({
      baseUrl: "http://custom:5050",
      _fetchForTest: fetchFn,
    });
    await client.checkHealth();
    expect(fetchFn).toHaveBeenCalledWith("http://custom:5050/health", expect.anything());
  });
});

describe("SoiferBackendClient circuit breaker (C-01)", () => {
  it("opens after 5 consecutive failures and skips upstream requests", async () => {
    const fetchFn = mockFetchError();
    const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
    const client = new SoiferBackendClient({ _fetchForTest: fetchFn, _breakerForTest: breaker });

    for (let i = 0; i < 5; i++) {
      await client.checkHealth();
    }
    expect(client.getBreakerState()).toBe("open");
    expect(fetchFn).toHaveBeenCalledTimes(5);

    const result = await client.checkHealth();
    expect(result).toEqual({ reachable: false });
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it("treats non-ok response as a failure", async () => {
    const fetchFn = mockFetchNotOk();
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });
    const client = new SoiferBackendClient({ _fetchForTest: fetchFn, _breakerForTest: breaker });

    await client.getStackHealth();
    await client.getStackHealth();
    await client.getStackHealth();
    expect(client.getBreakerState()).toBe("open");
  });

  it("auto-resets to half-open after cooldown elapses", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = mockFetchError();
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
      const client = new SoiferBackendClient({ _fetchForTest: fetchFn, _breakerForTest: breaker });

      await client.checkHealth();
      await client.checkHealth();
      expect(client.getBreakerState()).toBe("open");

      vi.advanceTimersByTime(1000);
      expect(client.getBreakerState()).toBe("half-open");
    } finally {
      vi.useRealTimers();
    }
  });
});
