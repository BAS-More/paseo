import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { usePinnedWorkspacesStore } from "./pinned-workspaces-store";

describe("pinned-workspaces-store", () => {
  beforeEach(() => {
    // Clear all pins between tests
    const state = usePinnedWorkspacesStore.getState();
    for (const key of state.pinnedKeys) {
      state.togglePin(key);
    }
  });

  it("starts with empty pinnedKeys set", () => {
    const state = usePinnedWorkspacesStore.getState();
    expect(state.pinnedKeys.size).toBe(0);
  });

  it("togglePin adds a workspace key", () => {
    usePinnedWorkspacesStore.getState().togglePin("ws-1");
    const state = usePinnedWorkspacesStore.getState();
    expect(state.pinnedKeys.has("ws-1")).toBe(true);
    expect(state.pinnedKeys.size).toBe(1);
  });

  it("togglePin removes an already-pinned key", () => {
    usePinnedWorkspacesStore.getState().togglePin("ws-2");
    expect(usePinnedWorkspacesStore.getState().pinnedKeys.has("ws-2")).toBe(true);

    usePinnedWorkspacesStore.getState().togglePin("ws-2");
    expect(usePinnedWorkspacesStore.getState().pinnedKeys.has("ws-2")).toBe(false);
  });

  it("isPinned returns correct boolean", () => {
    usePinnedWorkspacesStore.getState().togglePin("ws-3");
    expect(usePinnedWorkspacesStore.getState().isPinned("ws-3")).toBe(true);
    expect(usePinnedWorkspacesStore.getState().isPinned("ws-unknown")).toBe(false);
  });

  it("handles multiple pins independently", () => {
    const store = usePinnedWorkspacesStore.getState();
    store.togglePin("a");
    store.togglePin("b");
    store.togglePin("c");

    const state = usePinnedWorkspacesStore.getState();
    expect(state.pinnedKeys.size).toBe(3);
    expect(state.isPinned("a")).toBe(true);
    expect(state.isPinned("b")).toBe(true);
    expect(state.isPinned("c")).toBe(true);
  });

  it("partialize serializes Set to array for persistence", () => {
    const persistApi = (
      usePinnedWorkspacesStore as unknown as {
        persist: {
          getOptions: () => { partialize: (s: Record<string, unknown>) => Record<string, unknown> };
        };
      }
    ).persist;
    const options = persistApi.getOptions();
    const mockState = { pinnedKeys: new Set(["x", "y"]), togglePin: vi.fn(), isPinned: vi.fn() };
    const serialized = options.partialize(mockState as unknown as Record<string, unknown>) as {
      pinnedKeys: string[];
    };
    expect(Array.isArray(serialized.pinnedKeys)).toBe(true);
    expect(serialized.pinnedKeys).toContain("x");
    expect(serialized.pinnedKeys).toContain("y");
  });

  it("merge deserializes array back to Set", () => {
    const persistApi = (
      usePinnedWorkspacesStore as unknown as {
        persist: {
          getOptions: () => {
            merge: (persisted: unknown, current: unknown) => Record<string, unknown>;
          };
        };
      }
    ).persist;
    const options = persistApi.getOptions();
    const current = usePinnedWorkspacesStore.getState();
    const result = options.merge({ pinnedKeys: ["a", "b"] }, current) as {
      pinnedKeys: Set<string>;
    };
    expect(result.pinnedKeys instanceof Set).toBe(true);
    expect(result.pinnedKeys.has("a")).toBe(true);
    expect(result.pinnedKeys.has("b")).toBe(true);
  });
});
