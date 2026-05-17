/**
 * E2E smoke tests for 9Router infrastructure service.
 * Tests real HTTP connection — skips if 9Router not running.
 */
import { describe, expect, it } from "vitest";
import { NineRouterClient } from "../server/nine-router-client.js";

describe("9Router E2E Smoke", () => {
  it("checkHealth returns reachable boolean without crashing", async () => {
    const client = new NineRouterClient();
    const result = await client.checkHealth();
    expect(typeof result.reachable).toBe("boolean");
  });

  it("getAccounts returns array when reachable", async () => {
    const client = new NineRouterClient();
    const health = await client.checkHealth();
    if (!health.reachable) {
      console.log("SKIP: 9Router not reachable");
      return;
    }

    const accounts = await client.getAccounts();
    expect(Array.isArray(accounts)).toBe(true);
  });

  it("getUsage returns valid shape when reachable", async () => {
    const client = new NineRouterClient();
    const health = await client.checkHealth();
    if (!health.reachable) {
      console.log("SKIP: 9Router not reachable");
      return;
    }

    const usage = await client.getUsage();
    expect(usage).toHaveProperty("totalRequests");
    expect(usage).toHaveProperty("totalTokens");
    expect(usage).toHaveProperty("totalCost");
  });

  it("getStatus aggregates health + accounts + usage", async () => {
    const client = new NineRouterClient();
    const health = await client.checkHealth();
    if (!health.reachable) {
      console.log("SKIP: 9Router not reachable");
      return;
    }

    const status = await client.getStatus();
    expect(status).toHaveProperty("reachable", true);
    expect(status).toHaveProperty("accounts");
    expect(status).toHaveProperty("usage");
  });
});
