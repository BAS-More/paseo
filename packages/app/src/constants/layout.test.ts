import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

vi.mock("@/desktop/host", () => ({
  isElectronRuntime: () => false,
}));

vi.mock("@/desktop/settings/desktop-settings", () => ({
  loadDesktopSettings: vi.fn(),
  migrateLegacyDesktopSettings: vi.fn(),
}));

describe("layout constants", () => {
  it("exports expected values", async () => {
    const mod = await import("./layout");

    expect(mod.MAX_CONTENT_WIDTH).toBe(820);
    expect(mod.HEADER_INNER_HEIGHT).toBe(48);
    expect(mod.HEADER_INNER_HEIGHT_MOBILE).toBe(56);
    expect(mod.FOOTER_HEIGHT).toBe(75);
    expect(mod.DESKTOP_TRAFFIC_LIGHT_WIDTH).toBe(78);
    expect(mod.DESKTOP_WINDOW_CONTROLS_WIDTH).toBe(140);
    expect(mod.WORKSPACE_SECONDARY_HEADER_HEIGHT).toBe(36);
  });

  it("supportsDesktopPaneSplits returns boolean", async () => {
    const mod = await import("./layout");
    const result = mod.supportsDesktopPaneSplits();
    expect(typeof result).toBe("boolean");
  });
});
