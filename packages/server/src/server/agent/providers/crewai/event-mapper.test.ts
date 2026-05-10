import { describe, expect, it } from "vitest";

import { mapCrewAiSseToStreamEvents, parseSseLine, type CrewAiSseEvent } from "./event-mapper.js";

const PROVIDER = "crewai";
const TURN_ID = "turn-1";

describe("CrewAI event mapper", () => {
  it("maps status event to timeline assistant_message", () => {
    const event: CrewAiSseEvent = { type: "status", message: "Starting crew run..." };
    const result = mapCrewAiSseToStreamEvents(event, { provider: PROVIDER, turnId: TURN_ID });
    expect(result).toEqual([
      {
        type: "timeline",
        provider: PROVIDER,
        turnId: TURN_ID,
        item: { type: "assistant_message", text: "Starting crew run..." },
      },
    ]);
  });

  it("maps result event to turn_completed with final text timeline", () => {
    const event: CrewAiSseEvent = { type: "result", output: "The analysis is complete." };
    const result = mapCrewAiSseToStreamEvents(event, { provider: PROVIDER, turnId: TURN_ID });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: "timeline",
      provider: PROVIDER,
      turnId: TURN_ID,
      item: { type: "assistant_message", text: "The analysis is complete." },
    });
    expect(result[1]).toEqual({
      type: "turn_completed",
      provider: PROVIDER,
      turnId: TURN_ID,
    });
  });

  it("maps error event to turn_failed", () => {
    const event: CrewAiSseEvent = { type: "error", message: "Crew execution failed" };
    const result = mapCrewAiSseToStreamEvents(event, { provider: PROVIDER, turnId: TURN_ID });
    expect(result).toEqual([
      {
        type: "turn_failed",
        provider: PROVIDER,
        error: "Crew execution failed",
        turnId: TURN_ID,
      },
    ]);
  });

  it("maps done signal to turn_completed", () => {
    const event: CrewAiSseEvent = { type: "done" };
    const result = mapCrewAiSseToStreamEvents(event, { provider: PROVIDER, turnId: TURN_ID });
    expect(result).toEqual([
      {
        type: "turn_completed",
        provider: PROVIDER,
        turnId: TURN_ID,
      },
    ]);
  });

  it("returns empty array for unknown event types", () => {
    const event = { type: "unknown_type" } as unknown as CrewAiSseEvent;
    const result = mapCrewAiSseToStreamEvents(event, { provider: PROVIDER, turnId: TURN_ID });
    expect(result).toEqual([]);
  });
});

describe("parseSseLine", () => {
  it("parses valid SSE data line", () => {
    const result = parseSseLine('data: {"type":"status","message":"hello"}');
    expect(result).toEqual({ type: "status", message: "hello" });
  });

  it("returns null for non-data lines", () => {
    expect(parseSseLine("event: message")).toBeNull();
    expect(parseSseLine("")).toBeNull();
    expect(parseSseLine("   ")).toBeNull();
    expect(parseSseLine("id: 123")).toBeNull();
  });

  it("parses [DONE] signal", () => {
    const result = parseSseLine("data: [DONE]");
    expect(result).toEqual({ type: "done" });
  });

  it("returns null for malformed JSON", () => {
    const result = parseSseLine("data: {invalid json}");
    expect(result).toBeNull();
  });

  it("handles whitespace around data line", () => {
    const result = parseSseLine('  data: {"type":"error","message":"fail"}  ');
    expect(result).toEqual({ type: "error", message: "fail" });
  });
});
