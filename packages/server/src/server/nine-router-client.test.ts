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
  it("returns parsed account list from /api/providers/client", async () => {
    const accounts = [
      { id: "acc-1", name: "GPT-4", provider: "openai", status: "active" },
      { id: "acc-2", name: "Claude", provider: "anthropic", status: "active" },
    ];
    const fetchFn = mockFetchOk({ connections: accounts });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getAccounts();
    expect(result).toEqual(accounts);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/providers/client"),
      expect.anything(),
    );
  });

  it("returns empty when connections field is missing", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchOk({}) });
    const result = await client.getAccounts();
    expect(result).toEqual([]);
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
  it("returns mapped usage stats from 9Router /api/usage/stats response", async () => {
    const raw9RouterResponse = {
      totalRequests: 100,
      totalPromptTokens: 30000,
      totalCompletionTokens: 20000,
      totalCost: 1.5,
      byAccount: {
        "acc-1|model|provider": { requests: 100, tokens: 50000, cost: 1.5 },
      },
    };
    const client = new NineRouterClient({ _fetchForTest: mockFetchOk(raw9RouterResponse) });
    const result = await client.getUsage();
    expect(result.totalRequests).toBe(100);
    expect(result.totalTokens).toBe(50000); // prompt + completion
    expect(result.totalCost).toBe(1.5);
    expect(result.byAccount).toEqual([
      { id: "acc-1|model|provider", requests: 100, tokens: 50000, cost: 1.5 },
    ]);
  });

  it("passes period query param when specified", async () => {
    const fetchFn = mockFetchOk({
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      byAccount: {},
    });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    await client.getUsage({ period: "7d" });
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/usage/stats?period=7d"),
      expect.anything(),
    );
  });

  it("calls /api/usage/stats without period param by default", async () => {
    const fetchFn = mockFetchOk({
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      byAccount: {},
    });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    await client.getUsage();
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/usage\/stats$/),
      expect.anything(),
    );
  });

  it("returns zeroed defaults on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getUsage();
    expect(result.totalRequests).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.byAccount).toEqual([]);
  });

  it("handles empty byAccount gracefully", async () => {
    const client = new NineRouterClient({
      _fetchForTest: mockFetchOk({
        totalRequests: 5,
        totalPromptTokens: 100,
        totalCompletionTokens: 50,
        totalCost: 0.01,
      }),
    });
    const result = await client.getUsage();
    expect(result.totalTokens).toBe(150);
    expect(result.byAccount).toEqual([]);
  });
});

describe("NineRouterClient.getStatus", () => {
  it("aggregates health, accounts, and usage", async () => {
    const accounts = [{ id: "acc-1", name: "GPT-4", provider: "openai", status: "active" }];
    const rawUsage = {
      totalRequests: 10,
      totalPromptTokens: 3000,
      totalCompletionTokens: 2000,
      totalCost: 0.5,
      byAccount: {},
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ connections: accounts }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(rawUsage) });

    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const status = await client.getStatus();
    expect(status.reachable).toBe(true);
    expect(status.accounts).toEqual(accounts);
    expect(status.usage.totalRequests).toBe(10);
    expect(status.usage.totalTokens).toBe(5000);
    expect(status.usage.totalCost).toBe(0.5);
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
