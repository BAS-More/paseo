import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface PinnedWorkspacesState {
  pinnedKeys: Set<string>;
  togglePin: (workspaceKey: string) => void;
  isPinned: (workspaceKey: string) => boolean;
}

export const usePinnedWorkspacesStore = create<PinnedWorkspacesState>()(
  persist(
    (set, get) => ({
      pinnedKeys: new Set<string>(),
      togglePin: (workspaceKey: string) =>
        set((state) => {
          const next = new Set(state.pinnedKeys);
          if (next.has(workspaceKey)) {
            next.delete(workspaceKey);
          } else {
            next.add(workspaceKey);
          }
          return { pinnedKeys: next };
        }),
      isPinned: (workspaceKey: string) => get().pinnedKeys.has(workspaceKey),
    }),
    {
      name: "@paseo:pinned-workspaces",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pinnedKeys: Array.from(state.pinnedKeys),
      }),
      merge: (persisted, current) => ({
        ...current,
        pinnedKeys: new Set((persisted as { pinnedKeys?: string[] })?.pinnedKeys ?? []),
      }),
    },
  ),
);
