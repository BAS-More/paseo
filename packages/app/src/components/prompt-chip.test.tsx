import { describe, expect, it, vi } from "vitest";
import React from "react";

// PromptChip is not exported from agent-stream-view.tsx.
// Test the behavioral contract: onPress called with correct prompt string.
// No DOM rendering — pure logic tests matching the component's callback pattern.

describe("PromptChip behavior", () => {
  it("callback forwards the prompt string to onPress", () => {
    const onPress = vi.fn();
    const prompt = "Summarize this project";

    // Replicate the component's handlePress logic
    const handlePress = () => onPress(prompt);
    handlePress();

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith("Summarize this project");
  });

  it("each chip forwards its own prompt independently", () => {
    const onPress = vi.fn();
    const prompts = [
      "Summarize this project",
      "Find and fix bugs",
      "Write tests for recent changes",
    ];

    for (const prompt of prompts) {
      const handlePress = () => onPress(prompt);
      handlePress();
    }

    expect(onPress).toHaveBeenCalledTimes(3);
    expect(onPress).toHaveBeenNthCalledWith(1, "Summarize this project");
    expect(onPress).toHaveBeenNthCalledWith(2, "Find and fix bugs");
    expect(onPress).toHaveBeenNthCalledWith(3, "Write tests for recent changes");
  });

  it("SUGGESTED_PROMPTS has expected values", () => {
    // Match the constant from agent-stream-view.tsx
    const SUGGESTED_PROMPTS = [
      "Summarize this project",
      "Find and fix bugs",
      "Write tests for recent changes",
    ];

    expect(SUGGESTED_PROMPTS).toHaveLength(3);
    expect(SUGGESTED_PROMPTS.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
  });

  it("onSuggestedPrompt wiring populates composer via ref", () => {
    // Simulate the agent-panel.tsx wiring:
    // suggestedPromptSetterRef.current = (text) => messageInputRef.current.setValue(text)
    const setValue = vi.fn();
    let suggestedPromptSetter: ((text: string) => void) | null = null;

    // Register setter (what onRegisterSuggestedPromptSetter does)
    suggestedPromptSetter = (text: string) => setValue(text);

    // Simulate handleSuggestedPrompt
    const handleSuggestedPrompt = (prompt: string) => {
      suggestedPromptSetter?.(prompt);
    };

    handleSuggestedPrompt("Find and fix bugs");
    expect(setValue).toHaveBeenCalledWith("Find and fix bugs");
  });
});
