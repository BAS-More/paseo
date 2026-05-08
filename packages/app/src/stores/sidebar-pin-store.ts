import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SidebarPinStoreState {
  pinnedProjectKeys: Record<string, string[]>;
  isPinned: (serverId: string, projectKey: string) => boolean;
  togglePin: (serverId: string, projectKey: string) => void;
  getPinnedKeys: (serverId: string) => string[];
}

export const useSidebarPinStore = create<SidebarPinStoreState>()(
  persist(
    (set, get) => ({
      pinnedProjectKeys: {},
      isPinned: (serverId, projectKey) => {
        const key = serverId.trim();
        if (!key) return false;
        return (get().pinnedProjectKeys[key] ?? []).includes(projectKey);
      },
      togglePin: (serverId, projectKey) => {
        const key = serverId.trim();
        if (!key) return;
        set((state) => {
          const current = state.pinnedProjectKeys[key] ?? [];
          const next = current.includes(projectKey)
            ? current.filter((k) => k !== projectKey)
            : [...current, projectKey];
          return {
            pinnedProjectKeys: {
              ...state.pinnedProjectKeys,
              [key]: next,
            },
          };
        });
      },
      getPinnedKeys: (serverId) => {
        const key = serverId.trim();
        if (!key) return [];
        return get().pinnedProjectKeys[key] ?? [];
      },
    }),
    {
      name: "sidebar-pinned-projects",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pinnedProjectKeys: state.pinnedProjectKeys,
      }),
    },
  ),
);
