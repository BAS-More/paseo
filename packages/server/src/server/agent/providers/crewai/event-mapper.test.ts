import { describe, expect, it } from "vitest";

import { mapCrewAiSseToStreamEvents, type CrewAiSseEvent } from "./event-mapper.js";

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
