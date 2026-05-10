import { describe, expect, it, vi } from "vitest";

import { NineRouterClient } from "./nine-router-client.js";

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

describe("NineRouterClient.checkHealth", () => {
  it("returns reachable true on 200", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchOk({ ok: true }) });
    const result = await client.checkHealth();
    expect(result).toEqual({ reachable: true });
  });

  it("returns reachable false on connection error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.checkHealth();
    expect(result).toEqual({ reachable: false });
  });

  it("returns reachable false on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.checkHealth();
    expect(result).toEqual({ reachable: false });
  });

  it("calls /api/init endpoint", async () => {
    const fetchFn = mockFetchOk({ ok: true });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    await client.checkHealth();
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/init"),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});

describe("NineRouterClient.getAccounts", () => {
  it("returns parsed account list", async () => {
    const accounts = [
      { id: "acc-1", name: "GPT-4", provider: "openai", status: "active" },
      { id: "acc-2", name: "Claude", provider: "anthropic", status: "active" },
    ];
    const client = new NineRouterClient({
      _fetchForTest: mockFetchOk({ connections: accounts }),
    });
    const result = await client.getAccounts();
    expect(result).toEqual(accounts);
  });

  it("returns empty on connection error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getAccounts();
    expect(result).toEqual([]);
  });

  it("returns empty on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.getAccounts();
    expect(result).toEqual([]);
  });
});

describe("NineRouterClient.getUsage", () => {
  it("returns parsed usage stats", async () => {
    const usage = {
      totalRequests: 100,
      totalTokens: 50000,
      totalCost: 1.5,
      byAccount: [{ id: "acc-1", requests: 100, tokens: 50000, cost: 1.5 }],
    };
    const client = new NineRouterClient({ _fetchForTest: mockFetchOk(usage) });
    const result = await client.getUsage();
    expect(result).toEqual(usage);
  });

  it("passes period query param when specified", async () => {
    const fetchFn = mockFetchOk({ totalRequests: 0, totalTokens: 0, totalCost: 0, byAccount: [] });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    await client.getUsage({ period: "7d" });
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining("period=7d"), expect.anything());
  });

  it("returns zeroed defaults on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getUsage();
    expect(result.totalRequests).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.byAccount).toEqual([]);
  });
});

describe("NineRouterClient.getStatus", () => {
  it("aggregates health, accounts, and usage", async () => {
    const accounts = [{ id: "acc-1", name: "GPT-4", provider: "openai", status: "active" }];
    const usage = { totalRequests: 10, totalTokens: 5000, totalCost: 0.5, byAccount: [] };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ connections: accounts }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(usage) });

    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const status = await client.getStatus();
    expect(status.reachable).toBe(true);
    expect(status.accounts).toEqual(accounts);
    expect(status.usage).toEqual(usage);
  });

  it("returns safe defaults when unreachable", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const status = await client.getStatus();
    expect(status.reachable).toBe(false);
    expect(status.accounts).toEqual([]);
    expect(status.usage.totalRequests).toBe(0);
  });
});

describe("NineRouterClient configuration", () => {
  it("uses custom base URL", async () => {
    const fetchFn = mockFetchOk({ ok: true });
    const client = new NineRouterClient({
      baseUrl: "http://custom:9999",
      _fetchForTest: fetchFn,
    });
    await client.checkHealth();
    expect(fetchFn).toHaveBeenCalledWith("http://custom:9999/api/init", expect.anything());
  });

  it("defaults to localhost:20128", async () => {
    const fetchFn = mockFetchOk({ ok: true });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    await client.checkHealth();
    expect(fetchFn).toHaveBeenCalledWith("http://localhost:20128/api/init", expect.anything());
  });

  it("config round-trip: daemon config nineRouter.url flows to NineRouterClient", async () => {
    // Simulates session.ts reading config and passing to client constructor
    const daemonConfig = { nineRouter: { url: "http://configured:5555" } };
    const nineRouterUrl = daemonConfig.nineRouter?.url;
    const fetchFn = mockFetchOk({ ok: true });
    const client = new NineRouterClient(
      nineRouterUrl
        ? { baseUrl: nineRouterUrl, _fetchForTest: fetchFn }
        : { _fetchForTest: fetchFn },
    );
    await client.checkHealth();
    expect(fetchFn).toHaveBeenCalledWith("http://configured:5555/api/init", expect.anything());
  });

  it("config round-trip: absent nineRouter config falls back to default", async () => {
    const daemonConfig: Record<string, unknown> = {};
    const nineRouterUrl = (daemonConfig.nineRouter as { url?: string } | undefined)?.url;
    const fetchFn = mockFetchOk({ ok: true });
    const client = new NineRouterClient(
      nineRouterUrl
        ? { baseUrl: nineRouterUrl, _fetchForTest: fetchFn }
        : { _fetchForTest: fetchFn },
    );
    await client.checkHealth();
    expect(fetchFn).toHaveBeenCalledWith("http://localhost:20128/api/init", expect.anything());
  });
});
