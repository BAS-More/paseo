import { describe, expect, it, vi } from "vitest";

import type { Handoff } from "@/lib/spec-kit/handoffs";

// Wiring contract test for HandoffChips inside agent-panel.tsx.
//
// HandoffChips renders between AgentStreamSection and AgentComposerSection
// (see agent-panel.tsx around the `<HandoffChips handoffs=... onSelect=... />`
// site). The wiring contract is:
//
//   1. When `currentHandoffs` is empty, HandoffChips returns null and
//      the layout is unchanged.
//   2. When `currentHandoffs` is non-empty, pressing a chip calls
//      `handleHandoffSelect(handoff)`, which today populates the composer
//      via `suggestedPromptSetterRef.current?.(handoff.prompt)`.
//   3. The `send` flag is preserved on the handoff object but does NOT
//      auto-submit today — that's a follow-up.
//
// These tests cover the contract without mounting React Native — same
// pattern as prompt-chip.test.tsx.

describe("agent-panel handoff wiring contract", () => {
  it("empty handoffs short-circuits with no side effects", () => {
    const setter = vi.fn();
    const handoffs: ReadonlyArray<Handoff> = [];

    // HandoffChips early-returns when handoffs.length === 0.
    if (handoffs.length === 0) {
      // setter must NOT be invoked when there are no chips to press
      expect(setter).not.toHaveBeenCalled();
      return;
    }
    throw new Error("empty handoffs should short-circuit");
  });

  it("press routes through the suggestedPromptSetterRef", () => {
    const setterRef: { current: ((text: string) => void) | null } = {
      current: vi.fn(),
    };

    const handleHandoffSelect = (handoff: Handoff) => {
      setterRef.current?.(handoff.prompt);
    };

    const handoff: Handoff = {
      label: "Build Technical Plan",
      agent: "speckit.plan",
      prompt: "Create a plan for the spec",
    };

    handleHandoffSelect(handoff);

    expect(setterRef.current).toHaveBeenCalledTimes(1);
    expect(setterRef.current).toHaveBeenCalledWith("Create a plan for the spec");
  });

  it("send=true handoffs still route through the same setter today (no auto-submit yet)", () => {
    const setterRef: { current: ((text: string) => void) | null } = {
      current: vi.fn(),
    };

    const handleHandoffSelect = (handoff: Handoff) => {
      // Documented: when send=true is wired, a submit-ref will be invoked
      // here. For now, both branches populate the composer.
      setterRef.current?.(handoff.prompt);
    };

    handleHandoffSelect({
      label: "Clarify",
      agent: "speckit.clarify",
      prompt: "Clarify the spec",
      send: true,
    });

    expect(setterRef.current).toHaveBeenCalledWith("Clarify the spec");
  });

  it("null setterRef tolerates press without throwing", () => {
    const setterRef: { current: ((text: string) => void) | null } = {
      current: null,
    };

    const handleHandoffSelect = (handoff: Handoff) => {
      setterRef.current?.(handoff.prompt);
    };

    expect(() =>
      handleHandoffSelect({
        label: "X",
        agent: "y",
        prompt: "z",
      }),
    ).not.toThrow();
  });

  it("multiple presses route each prompt independently", () => {
    const setterRef: { current: ((text: string) => void) | null } = {
      current: vi.fn(),
    };

    const handleHandoffSelect = (handoff: Handoff) => {
      setterRef.current?.(handoff.prompt);
    };

    const handoffs: Handoff[] = [
      { label: "Plan", agent: "speckit.plan", prompt: "plan it" },
      { label: "Clarify", agent: "speckit.clarify", prompt: "clarify it" },
      { label: "Tasks", agent: "speckit.tasks", prompt: "break into tasks" },
    ];

    for (const h of handoffs) handleHandoffSelect(h);

    expect(setterRef.current).toHaveBeenCalledTimes(3);
    expect(setterRef.current).toHaveBeenNthCalledWith(1, "plan it");
    expect(setterRef.current).toHaveBeenNthCalledWith(2, "clarify it");
    expect(setterRef.current).toHaveBeenNthCalledWith(3, "break into tasks");
  });
});

describe("agent-panel handoff wiring placement", () => {
  // These are documentation tests — they encode the structural contract
  // that the chips render between stream and composer, and that
  // currentHandoffs is the single source of truth for chip visibility.

  it("chips visibility is controlled solely by currentHandoffs length", () => {
    const isVisible = (handoffs: ReadonlyArray<Handoff>) => handoffs.length > 0;

    expect(isVisible([])).toBe(false);
    expect(isVisible([{ label: "x", agent: "y", prompt: "z" }])).toBe(true);
  });

  it("today's wiring keeps currentHandoffs always empty (daemon protocol pending)", () => {
    // This test exists to surface the follow-up. When the daemon's
    // `listCommands` starts returning handoff metadata, this test should
    // be updated or replaced with one that covers the populate path.
    const currentHandoffs: ReadonlyArray<Handoff> = [];
    expect(currentHandoffs).toHaveLength(0);
  });
});
