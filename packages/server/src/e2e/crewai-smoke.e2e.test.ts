/**
 * E2E smoke tests for CrewAI provider.
 * Tests real HTTP connection to bridge — skips if bridge not running.
 */
import { describe, expect, it, afterEach } from "vitest";
import { CrewAiAgentClient } from "../server/agent/providers/crewai-agent.js";
import { createTestLogger, skipIfUnavailable, collectEvents } from "./provider-smoke.setup.js";
import type { AgentSession } from "../server/agent/agent-sdk-types.js";

describe("CrewAI E2E Smoke", () => {
  const logger = createTestLogger();
  let session: AgentSession | null = null;

  afterEach(async () => {
    if (session) {
      try {
        await session.close();
      } catch {}
      session = null;
    }
  });

  it("isAvailable returns boolean without crashing", async () => {
    const client = new CrewAiAgentClient({ logger });
    const result = await client.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("listModels returns crew list (may be empty)", async () => {
    const client = new CrewAiAgentClient({ logger });
    const skipReason = await skipIfUnavailable(client);
    if (skipReason) {
      console.log(`SKIP: ${skipReason}`);
      return;
    }

    const models = await client.listModels({});
    expect(Array.isArray(models)).toBe(true);
  });

  it("resumeSession throws not supported", async () => {
    const client = new CrewAiAgentClient({ logger });
    await expect(
      client.resumeSession({ sessionId: "test-123", provider: "crewai" }),
    ).rejects.toThrow(/not supported/i);
  });

  it("creates session and starts turn against bridge", async () => {
    const client = new CrewAiAgentClient({ logger });
    const skipReason = await skipIfUnavailable(client);
    if (skipReason) {
      console.log(`SKIP: ${skipReason}`);
      return;
    }

    const models = await client.listModels({});
    if (models.length === 0) {
      console.log("SKIP: no crews available in bridge");
      return;
    }

    session = await client.createSession({
      model: models[0]!.id,
      systemPrompt: "",
      maxTurns: 1,
    });

    expect(session.provider).toBe("crewai");

    const { events, unsubscribe } = collectEvents((cb) => session!.subscribe(cb));
    try {
      await session.startTurn("Test task");
      // Wait briefly for any events
      await new Promise((r) => setTimeout(r, 5000));
      // Session created is enough — crew may fail without full CrewAI install

      expect(events.some((e) => e.type === "turn_started")).toBe(true);
    } finally {
      unsubscribe();
    }
  }, 60000);
});
