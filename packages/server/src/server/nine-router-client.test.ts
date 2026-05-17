import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker } from "./agent/circuit-breaker.js";
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

// ─── Phase 1: Deep Client Tests (TDD RED) ─────────────────────────────────

describe("NineRouterClient.getKeys", () => {
  it("returns parsed key list from /api/keys", async () => {
    const keys = [
      {
        id: "7e15ba66-4cba-4af7-ad04-c9cf7419cdab",
        name: "Claude Code",
        key: "sk-24e8fd7f-ue2itw-4ec08b64",
        machineId: "24e8fd7fbdd1cb74",
        isActive: true,
        createdAt: "2026-04-19T14:23:47.005Z",
      },
    ];
    const fetchFn = mockFetchOk({ keys });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getKeys();
    expect(result).toEqual(keys);
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining("/api/keys"), expect.anything());
  });

  it("returns empty array on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getKeys();
    expect(result).toEqual([]);
  });

  it("returns empty array on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.getKeys();
    expect(result).toEqual([]);
  });
});

describe("NineRouterClient.createKey", () => {
  it("posts to /api/keys and returns new key", async () => {
    const newKey = {
      id: "new-id",
      name: "Test Key",
      key: "sk-new-key",
      machineId: "abc123",
      isActive: true,
      createdAt: "2026-05-11T00:00:00.000Z",
    };
    const fetchFn = mockFetchOk(newKey);
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.createKey("Test Key");
    expect(result).toEqual(newKey);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/keys"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: "Test Key" }),
      }),
    );
  });

  it("returns null on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.createKey("Fail");
    expect(result).toBeNull();
  });
});

describe("NineRouterClient.deleteKey", () => {
  it("sends DELETE to /api/keys/:id", async () => {
    const fetchFn = mockFetchOk({ success: true });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.deleteKey("key-123");
    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/keys/key-123"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns false on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.deleteKey("key-123");
    expect(result).toBe(false);
  });

  it("returns false on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.deleteKey("key-123");
    expect(result).toBe(false);
  });
});

describe("NineRouterClient.getModels", () => {
  it("returns model list from /api/models", async () => {
    const models = [
      {
        provider: "cc",
        model: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        fullModel: "cc/claude-sonnet-4-6",
        alias: "claude-sonnet-4-6",
      },
      {
        provider: "cx",
        model: "gpt-5.5",
        name: "GPT 5.5",
        fullModel: "cx/gpt-5.5",
        alias: "gpt-5.5",
      },
    ];
    const fetchFn = mockFetchOk({ models });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getModels();
    expect(result).toEqual(models);
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining("/api/models"), expect.anything());
  });

  it("returns empty array on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getModels();
    expect(result).toEqual([]);
  });
});

describe("NineRouterClient.testModel", () => {
  it("posts to /api/models/test and returns result", async () => {
    const testResult = { success: true, latencyMs: 320, provider: "cc" };
    const fetchFn = mockFetchOk(testResult);
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.testModel("cc/claude-sonnet-4-6");
    expect(result).toEqual(testResult);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/models/test"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "cc/claude-sonnet-4-6" }),
      }),
    );
  });

  it("returns failure result on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.testModel("bad-model");
    expect(result).toEqual({ success: false, latencyMs: 0, provider: "" });
  });
});

describe("NineRouterClient.getModelAliases", () => {
  it("returns alias map from /api/models/alias", async () => {
    const aliases = {
      free: "openrouter/openrouter/free",
      "qwen3-coder:free": "openrouter/qwen/qwen3-coder:free",
    };
    const fetchFn = mockFetchOk({ aliases });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getModelAliases();
    expect(result).toEqual(aliases);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/models/alias"),
      expect.anything(),
    );
  });

  it("returns empty object on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getModelAliases();
    expect(result).toEqual({});
  });
});

describe("NineRouterClient.setModelAlias", () => {
  it("posts alias mapping to /api/models/alias", async () => {
    const fetchFn = mockFetchOk({ success: true });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.setModelAlias("my-alias", "cc/claude-sonnet-4-6");
    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/models/alias"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ alias: "my-alias", target: "cc/claude-sonnet-4-6" }),
      }),
    );
  });

  it("returns false on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.setModelAlias("x", "y");
    expect(result).toBe(false);
  });
});

describe("NineRouterClient.deleteModelAlias", () => {
  it("sends DELETE to /api/models/alias", async () => {
    const fetchFn = mockFetchOk({ success: true });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.deleteModelAlias("my-alias");
    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/models/alias"),
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ alias: "my-alias" }),
      }),
    );
  });

  it("returns false on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.deleteModelAlias("x");
    expect(result).toBe(false);
  });

  it("returns false on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.deleteModelAlias("missing");
    expect(result).toBe(false);
  });
});

describe("NineRouterClient.getProviders", () => {
  it("returns provider connections from /api/providers", async () => {
    const connections = [
      {
        id: "conn-1",
        provider: "claude",
        authType: "oauth",
        name: "avi770",
        priority: 1,
        isActive: true,
        testStatus: "active",
      },
    ];
    const fetchFn = mockFetchOk({ connections });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getProviders();
    expect(result).toEqual(connections);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/providers$/),
      expect.anything(),
    );
  });

  it("returns empty array on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getProviders();
    expect(result).toEqual([]);
  });
});

describe("NineRouterClient.validateProvider", () => {
  it("posts to /api/providers/validate", async () => {
    const validationResult = { valid: true, models: 5, latencyMs: 200 };
    const fetchFn = mockFetchOk(validationResult);
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.validateProvider("conn-1");
    expect(result).toEqual(validationResult);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/providers/validate"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: "conn-1" }),
      }),
    );
  });

  it("returns invalid on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.validateProvider("bad");
    expect(result).toEqual({ valid: false, models: 0, latencyMs: 0 });
  });
});

describe("NineRouterClient.getSettings", () => {
  it("returns settings from /api/settings", async () => {
    const settings = {
      cloudEnabled: false,
      tunnelEnabled: false,
      fallbackStrategy: "round-robin",
      mitmEnabled: false,
      observabilityEnabled: true,
    };
    const fetchFn = mockFetchOk(settings);
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getSettings();
    expect(result).toEqual(settings);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/settings"),
      expect.anything(),
    );
  });

  it("returns null on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getSettings();
    expect(result).toBeNull();
  });
});

describe("NineRouterClient.updateSettings", () => {
  it("posts patch to /api/settings", async () => {
    const fetchFn = mockFetchOk({ success: true });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const patch = { tunnelEnabled: true, tunnelUrl: "https://my.tunnel" };
    const result = await client.updateSettings(patch);
    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/settings"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(patch),
      }),
    );
  });

  it("returns false on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.updateSettings({ foo: true });
    expect(result).toBe(false);
  });
});

describe("NineRouterClient.getCombos", () => {
  it("returns combo list from /api/combos", async () => {
    const combos = [
      {
        id: "combo-1",
        name: "My-pool",
        models: ["gh/claude-sonnet-4.5", "cx/gpt-5.3-codex-xhigh"],
        createdAt: "2026-04-21T10:49:42.188Z",
        updatedAt: "2026-04-21T10:49:42.188Z",
      },
    ];
    const fetchFn = mockFetchOk({ combos });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getCombos();
    expect(result).toEqual(combos);
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining("/api/combos"), expect.anything());
  });

  it("returns empty array on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getCombos();
    expect(result).toEqual([]);
  });
});

describe("NineRouterClient.createCombo", () => {
  it("posts new combo to /api/combos", async () => {
    const newCombo = {
      id: "combo-new",
      name: "Test Pool",
      models: ["cc/claude-sonnet-4-6"],
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
    };
    const fetchFn = mockFetchOk(newCombo);
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.createCombo({
      name: "Test Pool",
      models: ["cc/claude-sonnet-4-6"],
    });
    expect(result).toEqual(newCombo);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/combos"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Test Pool", models: ["cc/claude-sonnet-4-6"] }),
      }),
    );
  });

  it("returns null on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.createCombo({ name: "x", models: [] });
    expect(result).toBeNull();
  });
});

describe("NineRouterClient.deleteCombo", () => {
  it("sends DELETE to /api/combos/:id", async () => {
    const fetchFn = mockFetchOk({ success: true });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.deleteCombo("combo-123");
    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/combos/combo-123"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns false on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.deleteCombo("combo-123");
    expect(result).toBe(false);
  });
});

describe("NineRouterClient.getPricing", () => {
  it("returns pricing map from /api/pricing", async () => {
    const pricing = {
      gh: { "gpt-5.3-codex": { input: 1.75, output: 14, cached: 0.175 } },
    };
    const fetchFn = mockFetchOk(pricing);
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getPricing();
    expect(result).toEqual(pricing);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/pricing"),
      expect.anything(),
    );
  });

  it("returns empty object on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getPricing();
    expect(result).toEqual({});
  });
});

describe("NineRouterClient.importOAuthToken", () => {
  it("posts to /api/oauth/:provider/auto-import", async () => {
    const importResult = { success: true, email: "user@test.com" };
    const fetchFn = mockFetchOk(importResult);
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.importOAuthToken("cursor");
    expect(result).toEqual(importResult);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/oauth/cursor/auto-import"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns failure on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.importOAuthToken("cursor");
    expect(result).toEqual({ success: false });
  });
});

describe("NineRouterClient.getCliToolSettings", () => {
  it("returns settings for a CLI tool from /api/cli-tools/:tool-settings", async () => {
    const settings = {
      installed: true,
      settings: { env: { ANTHROPIC_BASE_URL: "http://localhost:20128/v1" } },
      has9Router: true,
    };
    const fetchFn = mockFetchOk(settings);
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getCliToolSettings("claude");
    expect(result).toEqual(settings);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/cli-tools/claude-settings"),
      expect.anything(),
    );
  });

  it("returns null on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.getCliToolSettings("claude");
    expect(result).toBeNull();
  });

  it("returns null on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.getCliToolSettings("claude");
    expect(result).toBeNull();
  });
});

describe("NineRouterClient.updateCliToolSettings", () => {
  it("posts updated settings to /api/cli-tools/:tool-settings", async () => {
    const fetchFn = mockFetchOk({ success: true });
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const patch = { env: { ANTHROPIC_MODEL: "cc/claude-opus-4-7" } };
    const result = await client.updateCliToolSettings("claude", patch);
    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/cli-tools/claude-settings"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(patch),
      }),
    );
  });

  it("returns false on error", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchError() });
    const result = await client.updateCliToolSettings("claude", {});
    expect(result).toBe(false);
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

describe("NineRouterClient branch coverage: !response.ok paths", () => {
  it("getCombos returns empty array on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.getCombos();
    expect(result).toEqual([]);
  });

  it("createCombo returns null on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.createCombo({ name: "x", models: [] });
    expect(result).toBeNull();
  });

  it("getPricing returns empty object on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.getPricing();
    expect(result).toEqual({});
  });

  it("importOAuthToken returns failure on non-ok response", async () => {
    const client = new NineRouterClient({ _fetchForTest: mockFetchNotOk() });
    const result = await client.importOAuthToken("cursor");
    expect(result).toEqual({ success: false });
  });

  it("getCombos handles missing combos field gracefully", async () => {
    const fetchFn = mockFetchOk({});
    const client = new NineRouterClient({ _fetchForTest: fetchFn });
    const result = await client.getCombos();
    expect(result).toEqual([]);
  });
});

describe("NineRouterClient circuit breaker (C-01)", () => {
  it("opens after 5 consecutive failures and skips upstream requests", async () => {
    const fetchFn = mockFetchError();
    const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
    const client = new NineRouterClient({ _fetchForTest: fetchFn, _breakerForTest: breaker });

    for (let i = 0; i < 5; i++) {
      await client.checkHealth();
    }
    expect(client.getBreakerState()).toBe("open");
    expect(fetchFn).toHaveBeenCalledTimes(5);

    // 6th call must NOT hit fetch — breaker is open
    const result = await client.checkHealth();
    expect(result).toEqual({ reachable: false });
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it("treats non-ok response (e.g. 503) as a failure for the breaker", async () => {
    const fetchFn = mockFetchNotOk();
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });
    const client = new NineRouterClient({ _fetchForTest: fetchFn, _breakerForTest: breaker });

    await client.getAccounts();
    await client.getAccounts();
    await client.getAccounts();
    expect(client.getBreakerState()).toBe("open");
  });

  it("auto-resets to half-open after cooldown elapses", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = mockFetchError();
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
      const client = new NineRouterClient({ _fetchForTest: fetchFn, _breakerForTest: breaker });

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
