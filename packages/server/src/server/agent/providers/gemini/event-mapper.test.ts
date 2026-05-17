import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import {
  mapGeminiEventToStreamEvents,
  type GeminiStreamEvent,
  type GeminiEventContext,
} from "./event-mapper.js";

const PROVIDER = "gemini";
const TURN_ID = "turn-1";
const CTX: GeminiEventContext = { provider: PROVIDER, turnId: TURN_ID };

function getTimelineItem(event: AgentStreamEvent): Record<string, unknown> {
  if (event.type === "timeline" && "item" in event) {
    return event.item as unknown as Record<string, unknown>;
  }
  throw new Error(`Expected timeline event, got ${event.type}`);
}

describe("Gemini event mapper", () => {
  it("maps init event to thread_started", () => {
    const event: GeminiStreamEvent = { type: "init", session_id: "sess-123" };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toEqual([
      {
        type: "thread_started",
        provider: PROVIDER,
        sessionId: "sess-123",
      },
    ]);
  });

  it("maps assistant message with delta=true to timeline text", () => {
    const event: GeminiStreamEvent = {
      type: "message",
      role: "assistant",
      content: "Hello world",
      delta: true,
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toHaveLength(1);
    const item = getTimelineItem(result[0]);
    expect(item.type).toBe("assistant_message");
    expect(item.text).toBe("Hello world");
  });

  it("maps assistant message with delta=false to timeline text plus turn_completed", () => {
    const event: GeminiStreamEvent = {
      type: "message",
      role: "assistant",
      content: "Final answer",
      delta: false,
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toHaveLength(2);
    const item = getTimelineItem(result[0]);
    expect(item.type).toBe("assistant_message");
    expect(item.text).toBe("Final answer");
    expect(result[1].type).toBe("turn_completed");
  });

  it("maps tool_use event to timeline with tool invocation", () => {
    const event: GeminiStreamEvent = {
      type: "tool_use",
      tool_id: "tool-1",
      tool_name: "read_file",
      parameters: { path: "/foo.txt" },
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toHaveLength(1);
    const item = getTimelineItem(result[0]);
    expect(item.type).toBe("tool_call");
    expect(item.name).toBe("read_file");
    expect(item.callId).toBe("tool-1");
    expect(item.status).toBe("running");
  });

  it("maps tool_result success to timeline with completed tool call", () => {
    const event: GeminiStreamEvent = {
      type: "tool_result",
      tool_id: "tool-1",
      output: "file contents here",
      status: "success",
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toHaveLength(1);
    const item = getTimelineItem(result[0]);
    expect(item.type).toBe("tool_call");
    expect(item.callId).toBe("tool-1");
    expect(item.status).toBe("completed");
  });

  it("maps tool_result error to timeline with failed tool call", () => {
    const event: GeminiStreamEvent = {
      type: "tool_result",
      tool_id: "tool-1",
      output: "permission denied",
      status: "error",
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toHaveLength(1);
    const item = getTimelineItem(result[0]);
    expect(item.type).toBe("tool_call");
    expect(item.callId).toBe("tool-1");
    expect(item.status).toBe("failed");
  });

  it("maps result event to turn_completed", () => {
    const event: GeminiStreamEvent = {
      type: "result",
      stats: { total_tokens: 1500 },
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toEqual([{ type: "turn_completed", provider: PROVIDER, turnId: TURN_ID }]);
  });

  it("maps error event to turn_failed", () => {
    const event: GeminiStreamEvent = {
      type: "error",
      error: "API key invalid",
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toEqual([
      {
        type: "turn_failed",
        provider: PROVIDER,
        error: "API key invalid",
        turnId: TURN_ID,
      },
    ]);
  });

  it("maps error event with message field to turn_failed", () => {
    const event: GeminiStreamEvent = {
      type: "error",
      message: "Rate limit exceeded",
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toEqual([
      {
        type: "turn_failed",
        provider: PROVIDER,
        error: "Rate limit exceeded",
        turnId: TURN_ID,
      },
    ]);
  });

  it("returns empty array for unknown event types", () => {
    const event = { type: "unknown" } as unknown as GeminiStreamEvent;
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toEqual([]);
  });

  it("ignores non-assistant message events", () => {
    const event: GeminiStreamEvent = {
      type: "message",
      role: "user",
      content: "user input",
    };
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toEqual([]);
  });

  it("init event with no session_id falls back to empty string", () => {
    const event: GeminiStreamEvent = { type: "init" } as GeminiStreamEvent;
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toEqual([{ type: "thread_started", provider: PROVIDER, sessionId: "" }]);
  });

  it("error event with neither error nor message uses fallback string", () => {
    const event = { type: "error" } as unknown as GeminiStreamEvent;
    const result = mapGeminiEventToStreamEvents(event, CTX);
    expect(result).toEqual([
      {
        type: "turn_failed",
        provider: PROVIDER,
        error: "Unknown error",
        turnId: TURN_ID,
      },
    ]);
  });
});
