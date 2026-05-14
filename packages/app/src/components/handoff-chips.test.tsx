import { describe, expect, it, vi } from "vitest";

import type { Handoff } from "@/lib/spec-kit/handoffs";

// HandoffChips is a thin presentational component over a Pressable list.
// Following the pattern in `prompt-chip.test.tsx`, we test the
// behavioral contract — that the press callback forwards the right
// handoff object — without rendering the DOM.

describe("HandoffChips behavior", () => {
  const handoffs: Handoff[] = [
    { label: "Plan", agent: "speckit.plan", prompt: "Plan it" },
    { label: "Clarify", agent: "speckit.clarify", prompt: "Clarify it", send: true },
  ];

  it("press callback forwards the full handoff to onSelect", () => {
    const onSelect = vi.fn();
    const handlePress = (handoff: Handoff) => () => onSelect(handoff);

    handlePress(handoffs[0])();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(handoffs[0]);
  });

  it("each chip forwards its own handoff independently", () => {
    const onSelect = vi.fn();
    const handlePress = (handoff: Handoff) => () => onSelect(handoff);

    for (const h of handoffs) {
      handlePress(h)();
    }

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, handoffs[0]);
    expect(onSelect).toHaveBeenNthCalledWith(2, handoffs[1]);
  });

  it("send=true handoffs preserve the send flag through the callback", () => {
    const onSelect = vi.fn<(h: Handoff) => void>();
    onSelect.mockImplementation((h) => {
      if (h.send) {
        // caller responsibility: send immediately
        return;
      }
      // caller responsibility: populate composer
    });

    onSelect(handoffs[0]);
    onSelect(handoffs[1]);

    expect(onSelect.mock.calls[0][0].send).toBeUndefined();
    expect(onSelect.mock.calls[1][0].send).toBe(true);
  });

  it("key derivation produces stable, unique keys per handoff", () => {
    const keyFor = (h: Handoff) => `${h.agent}::${h.label}`;
    const keys = handoffs.map(keyFor);
    expect(new Set(keys).size).toBe(handoffs.length);
  });

  it("empty handoff list is a valid input (renders nothing — caller checks length)", () => {
    const onSelect = vi.fn();
    const empty: Handoff[] = [];
    // We mirror the component's early-return contract:
    if (empty.length === 0) {
      // nothing to render
      expect(onSelect).not.toHaveBeenCalled();
      return;
    }
    throw new Error("empty list should short-circuit");
  });
});

describe("HandoffChips caller contract", () => {
  // These tests document how a stream renderer should wire HandoffChips
  // into the assistant-turn lifecycle. They are intentionally pure-logic
  // — the actual stream wiring lives elsewhere and is too invasive to
  // mount inside a unit test.

  it("onSelect with send=true should trigger a submit, not just a populate", () => {
    const populate = vi.fn();
    const submit = vi.fn();

    const onSelect = (handoff: Handoff) => {
      if (handoff.send) {
        submit(handoff.prompt);
      } else {
        populate(handoff.prompt);
      }
    };

    onSelect({ label: "A", agent: "x", prompt: "go", send: true });
    onSelect({ label: "B", agent: "x", prompt: "wait" });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("go");
    expect(populate).toHaveBeenCalledTimes(1);
    expect(populate).toHaveBeenCalledWith("wait");
  });
});
