import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn<(_: string) => Promise<string | null>>(),
  setItem: vi.fn<(_: string, __: string) => Promise<void>>(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorageMock,
}));

vi.mock("@/desktop/host", () => ({
  isElectronRuntime: () => false,
}));

vi.mock("@/desktop/settings/desktop-settings", () => ({
  loadDesktopSettings: vi.fn<() => Promise<unknown>>(),
  migrateLegacyDesktopSettings: vi.fn<(_: unknown) => Promise<void>>(),
}));

describe("use-settings layoutMode", () => {
  beforeEach(() => {
    vi.resetModules();
    asyncStorageMock.getItem.mockReset();
    asyncStorageMock.setItem.mockReset();
  });

  it("defaults layoutMode to workspace", async () => {
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.layoutMode).toBe("workspace");
  });

  it("persists claude-desktop layoutMode from storage", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({ layoutMode: "claude-desktop" });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.layoutMode).toBe("claude-desktop");
  });

  it("ignores invalid layoutMode values", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({ layoutMode: "invalid-mode" });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.layoutMode).toBe("workspace");
  });

  it("includes layoutMode in DEFAULT_APP_SETTINGS", async () => {
    const mod = await import("./use-settings");
    expect(mod.DEFAULT_APP_SETTINGS.layoutMode).toBe("workspace");
  });

  it("preserves other settings when layoutMode is set", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          theme: "dark",
          layoutMode: "claude-desktop",
          sendBehavior: "queue",
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.theme).toBe("dark");
    expect(result.layoutMode).toBe("claude-desktop");
    expect(result.sendBehavior).toBe("queue");
  });
});
