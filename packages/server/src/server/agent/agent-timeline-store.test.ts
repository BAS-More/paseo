import { describe, expect, it } from "vitest";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";

describe("InMemoryAgentTimelineStore ring-buffer cap (M-03)", () => {
  it("drops the oldest rows once maxRowsPerAgent is exceeded", () => {
    const store = new InMemoryAgentTimelineStore({ maxRowsPerAgent: 3 });
    store.initialize("agent-1");

    store.append("agent-1", { type: "assistant_message", text: "one" });
    store.append("agent-1", { type: "assistant_message", text: "two" });
    store.append("agent-1", { type: "assistant_message", text: "three" });
    store.append("agent-1", { type: "assistant_message", text: "four" });

    const rows = store.getRows("agent-1");
    expect(rows).toHaveLength(3);
    // Oldest ("one") evicted; "two" is the new head.
    expect(rows[0].seq).toBe(2);
    expect(rows[2].seq).toBe(4);
  });

  it("seq counter keeps incrementing past evicted rows", () => {
    const store = new InMemoryAgentTimelineStore({ maxRowsPerAgent: 2 });
    store.initialize("agent-1");

    for (let i = 0; i < 10; i++) {
      store.append("agent-1", { type: "assistant_message", text: `m${i}` });
    }

    const rows = store.getRows("agent-1");
    expect(rows).toHaveLength(2);
    expect(rows[0].seq).toBe(9);
    expect(rows[1].seq).toBe(10);
  });
});

describe("InMemoryAgentTimelineStore", () => {
  it("returns a bounded reset window when an after cursor is behind retained history", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
      limit: 1,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "after",
      reset: true,
      staleCursor: false,
      gap: true,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });
});
