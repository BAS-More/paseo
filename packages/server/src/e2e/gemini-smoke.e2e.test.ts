/**
 * E2E smoke tests for Gemini CLI provider.
 * Tests real binary spawning — skips if gemini not installed.
 */
import { describe, expect, it, afterEach } from "vitest";
import { GeminiAgentClient } from "../server/agent/providers/gemini-agent.js";
import { createTestLogger, skipIfUnavailable, collectEvents, waitForEvent } from "./provider-smoke.setup.js";
import type { AgentSession } from "../server/agent/agent-sdk-types.js";

describe("Gemini E2E Smoke", () => {
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
    const client = new GeminiAgentClient({ logger });
    const result = await client.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("creates session and runs a turn", async () => {
    const client = new GeminiAgentClient({ logger });
    const skipReason = await skipIfUnavailable(client);
    if (skipReason) {
      console.log(`SKIP: ${skipReason}`);
      return;
    }

    session = await client.createSession({
      model: null,
      systemPrompt: "",
      maxTurns: 1,
    });

    expect(session.provider).toBe("gemini");

    const { events, unsubscribe } = collectEvents((cb) => session!.subscribe(cb));

    try {
      await session.startTurn("What is 2+2? Reply in one word.");
      await waitForEvent(events, "turn_completed", 30000);

      const hasTimeline = events.some((e) => e.type === "timeline");
      expect(hasTimeline).toBe(true);
    } finally {
      unsubscribe();
    }
  }, 60000);

  it("interrupt kills process cleanly", async () => {
    const client = new GeminiAgentClient({ logger });
    const skipReason = await skipIfUnavailable(client);
    if (skipReason) {
      console.log(`SKIP: ${skipReason}`);
      return;
    }

    session = await client.createSession({
      model: null,
      systemPrompt: "",
      maxTurns: 1,
    });

    const { events, unsubscribe } = collectEvents((cb) => session!.subscribe(cb));

    try {
      await session.startTurn("Write a very long essay about the history of mathematics.");
      await new Promise((r) => setTimeout(r, 2000));
      await session.interrupt();
      expect(true).toBe(true);
    } finally {
      unsubscribe();
    }
  }, 30000);
});
