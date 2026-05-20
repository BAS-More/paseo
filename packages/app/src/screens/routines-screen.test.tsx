/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { formatCadence, statusVariant } from "@/hooks/use-schedules";

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => null,
  useHostRuntimeIsConnected: () => false,
  useHosts: () => [],
}));

describe("RoutinesScreen helpers", () => {
  it("formatCadence handles every-type cadence", () => {
    expect(formatCadence({ type: "every", everyMs: 3_600_000 })).toBe("every 1h");
  });

  it("statusVariant maps active to success", () => {
    expect(statusVariant("active")).toBe("success");
  });

  it("statusVariant maps paused to muted", () => {
    expect(statusVariant("paused")).toBe("muted");
  });
});
