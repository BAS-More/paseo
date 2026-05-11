import { describe, expect, test } from "vitest";

import { shouldSendMessage } from "./ws-backpressure.js";

describe("shouldSendMessage", () => {
  const DEFAULT_THRESHOLD = 1_048_576; // 1 MB

  test("returns true when bufferedAmount is 0", () => {
    expect(shouldSendMessage(0)).toBe(true);
  });

  test("returns true when bufferedAmount is well below threshold", () => {
    expect(shouldSendMessage(1024)).toBe(true);
  });

  test("returns true when bufferedAmount is just below the default threshold", () => {
    expect(shouldSendMessage(DEFAULT_THRESHOLD - 1)).toBe(true);
  });

  test("returns false when bufferedAmount equals the default threshold", () => {
    expect(shouldSendMessage(DEFAULT_THRESHOLD)).toBe(false);
  });

  test("returns false when bufferedAmount exceeds the default threshold", () => {
    expect(shouldSendMessage(DEFAULT_THRESHOLD + 1)).toBe(false);
  });

  test("returns false when bufferedAmount is far above threshold", () => {
    expect(shouldSendMessage(10_000_000)).toBe(false);
  });

  test("respects a custom threshold (lower)", () => {
    const customThreshold = 512;
    expect(shouldSendMessage(511, customThreshold)).toBe(true);
    expect(shouldSendMessage(512, customThreshold)).toBe(false);
    expect(shouldSendMessage(513, customThreshold)).toBe(false);
  });

  test("respects a custom threshold (higher)", () => {
    const customThreshold = 2_097_152; // 2 MB
    expect(shouldSendMessage(2_097_151, customThreshold)).toBe(true);
    expect(shouldSendMessage(2_097_152, customThreshold)).toBe(false);
  });

  test("returns true at zero with any custom threshold", () => {
    expect(shouldSendMessage(0, 1)).toBe(true);
    expect(shouldSendMessage(0, 1_000_000)).toBe(true);
  });
});
