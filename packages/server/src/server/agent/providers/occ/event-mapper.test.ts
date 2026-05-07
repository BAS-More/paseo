import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { mapOccEventToStreamEvents, type OccStreamEvent } from "./event-mapper.js";

function getTimelineItem(event: AgentStreamEvent): Record<string, unknown> {
  if (event.type === "timeline" && "item" in event) {
    return event.item as unknown as Record<string, unknown>;
  }
  throw new Error(`Expected timeline event, got ${event.type}`);
}

const PROVIDER = "occ";
const SESSION_ID = "test-session-123";
const TURN_ID = "turn-1";

describe("OCC event mapper", () => {
  describe("system init event", () => {
    it("maps init to thread_started", () => {
      const event: OccStreamEvent = {
        type: "system",
        subtype: "init",
        session_id: "occ-abc",
      };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        { type: "thread_started", sessionId: "occ-abc", provider: PROVIDER },
      ]);
    });

    it("uses fallback sessionId when event has none", () => {
      const event: OccStreamEvent = { type: "system", subtype: "init" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        { type: "thread_started", sessionId: SESSION_ID, provider: PROVIDER },
      ]);
    });
  });

  describe("stream_event (assistant text delta)", () => {
    it("maps stream_event to timeline assistant_message", () => {
      const event: OccStreamEvent = { type: "stream_event", text: "Hello world" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "timeline",
          provider: PROVIDER,
          turnId: TURN_ID,
          item: { type: "assistant_message", text: "Hello world" },
        },
      ]);
    });

    it("falls back to delta field", () => {
      const event: OccStreamEvent = { type: "stream_event", delta: "delta text" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "timeline",
          provider: PROVIDER,
          turnId: TURN_ID,
          item: { type: "assistant_message", text: "delta text" },
        },
      ]);
    });
  });

  describe("assistant message event", () => {
    it("maps assistant with text content block", () => {
      const event: OccStreamEvent = {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Full response text" }],
        },
      };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "timeline",
          provider: PROVIDER,
          turnId: TURN_ID,
          item: { type: "assistant_message", text: "Full response text" },
        },
      ]);
    });

    it("returns empty array when no text content blocks", () => {
      const event: OccStreamEvent = {
        type: "assistant",
        message: { content: [] },
      };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([]);
    });
  });

  describe("tool_use event", () => {
    it("maps tool_use to timeline tool_call running", () => {
      const event: OccStreamEvent = {
        type: "tool_use",
        name: "Read",
        input: { file_path: "/src/index.ts" },
        tool_use_id: "tool-1",
      };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toHaveLength(1);
      const item = result[0];
      expect(item).toMatchObject({
        type: "timeline",
        provider: PROVIDER,
        turnId: TURN_ID,
      });
      expect(getTimelineItem(item)).toMatchObject({
        type: "tool_call",
        callId: "tool-1",
        name: "Read",
        status: "running",
        error: null,
      });
    });
  });

  describe("tool_result event", () => {
    it("maps tool_result to timeline tool_call completed", () => {
      const event: OccStreamEvent = {
        type: "tool_result",
        tool_use_id: "tool-1",
        content: "File contents here",
        is_error: false,
      };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toHaveLength(1);
      const item = result[0];
      expect(getTimelineItem(item)).toMatchObject({
        type: "tool_call",
        callId: "tool-1",
        status: "completed",
        error: null,
      });
    });

    it("maps error tool_result to timeline tool_call failed", () => {
      const event: OccStreamEvent = {
        type: "tool_result",
        tool_use_id: "tool-1",
        content: "Permission denied",
        is_error: true,
      };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toHaveLength(1);
      const item = result[0];
      expect(getTimelineItem(item)).toMatchObject({
        type: "tool_call",
        callId: "tool-1",
        status: "failed",
        error: "Permission denied",
      });
    });
  });

  describe("thinking event", () => {
    it("maps thinking to timeline reasoning", () => {
      const event: OccStreamEvent = { type: "thinking", content: "Let me think..." };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "timeline",
          provider: PROVIDER,
          turnId: TURN_ID,
          item: { type: "reasoning", text: "Let me think..." },
        },
      ]);
    });

    it("uses thinking field as fallback", () => {
      const event: OccStreamEvent = { type: "thinking", thinking: "Alternative field" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "timeline",
          provider: PROVIDER,
          turnId: TURN_ID,
          item: { type: "reasoning", text: "Alternative field" },
        },
      ]);
    });
  });

  describe("error event", () => {
    it("maps error to timeline error", () => {
      const event: OccStreamEvent = { type: "error", message: "Something went wrong" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "timeline",
          provider: PROVIDER,
          turnId: TURN_ID,
          item: { type: "error", message: "Something went wrong" },
        },
      ]);
    });

    it("uses error field as fallback", () => {
      const event: OccStreamEvent = { type: "error", error: "Fallback error" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "timeline",
          provider: PROVIDER,
          turnId: TURN_ID,
          item: { type: "error", message: "Fallback error" },
        },
      ]);
    });
  });

  describe("result event", () => {
    it("maps successful result to turn_completed", () => {
      const event: OccStreamEvent = { type: "result", subtype: "success", result: "Done!" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([{ type: "turn_completed", provider: PROVIDER, turnId: TURN_ID }]);
    });

    it("maps failed result to turn_failed", () => {
      const event: OccStreamEvent = { type: "result", subtype: "error", result: "Failed" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        { type: "turn_failed", provider: PROVIDER, error: "Failed", turnId: TURN_ID },
      ]);
    });
  });

  describe("stop event", () => {
    it("maps stop to turn_completed", () => {
      const event: OccStreamEvent = { type: "stop", reason: "user_interrupt" };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([{ type: "turn_completed", provider: PROVIDER, turnId: TURN_ID }]);
    });
  });

  describe("permission_request event", () => {
    it("maps permission_request to permission_requested", () => {
      const event: OccStreamEvent = {
        type: "permission_request",
        tool_name: "Bash",
        input: { command: "rm -rf /" },
        request_id: "perm-1",
      };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "permission_requested",
          provider: PROVIDER,
          turnId: TURN_ID,
          request: {
            id: "perm-1",
            provider: PROVIDER,
            name: "Bash",
            kind: "tool",
            title: "Tool permission: Bash",
            input: { command: "rm -rf /" },
          },
        },
      ]);
    });
  });

  describe("agent_spawn event", () => {
    it("maps agent_spawn to timeline tool_call", () => {
      const event: OccStreamEvent = {
        type: "agent_spawn",
        description: "Research agent",
        prompt: "Find the bug",
        agent_id: "agent-1",
      };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toHaveLength(1);
      const item = result[0];
      expect(getTimelineItem(item)).toMatchObject({
        type: "tool_call",
        callId: "agent-1",
        name: "Agent",
        status: "running",
      });
    });
  });

  describe("stream_request_start event", () => {
    it("maps to turn_started", () => {
      const event: OccStreamEvent = { type: "stream_request_start", turn: 2 };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([{ type: "turn_started", provider: PROVIDER, turnId: TURN_ID }]);
    });
  });

  describe("compaction event", () => {
    it("maps compaction to timeline compaction item", () => {
      const event: OccStreamEvent = { type: "compaction", count: 42 };
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([
        {
          type: "timeline",
          provider: PROVIDER,
          turnId: TURN_ID,
          item: { type: "compaction", status: "completed" },
        },
      ]);
    });
  });

  describe("unknown event", () => {
    it("returns empty array for unknown event types", () => {
      const event = { type: "some_future_event" } as unknown as OccStreamEvent;
      const result = mapOccEventToStreamEvents(event, {
        provider: PROVIDER,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(result).toEqual([]);
    });
  });
});
