/**
 * E2E smoke tests for OCC (OpenClaude) provider.
 * Tests real binary spawning — skips if occ not installed.
 */
import { describe, expect, it, afterEach } from "vitest";
import { OccAgentClient } from "../server/agent/providers/occ-agent.js";
import { createTestLogger, skipIfUnavailable, collectEvents, waitForEvent } from "./provider-smoke.setup.js";
import type { AgentSession } from "../server/agent/agent-sdk-types.js";

describe("OCC E2E Smoke", () => {
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
    const client = new OccAgentClient({ logger });
    const result = await client.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("creates session and runs a turn", async () => {
    const client = new OccAgentClient({ logger });
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

    expect(session.provider).toBe("occ");

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
    const client = new OccAgentClient({ logger });
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
      await session.startTurn("Write a very long essay about the history of computing.");
      // Interrupt after a brief delay
      await new Promise((r) => setTimeout(r, 2000));
      await session.interrupt();

      // Should not throw — session should be in a clean state
      expect(true).toBe(true);
    } finally {
      unsubscribe();
    }
  }, 30000);
});
