import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SidebarRenameStoreState {
  customNames: Record<string, string>;
  getCustomName: (projectKey: string) => string | null;
  setCustomName: (projectKey: string, name: string) => void;
  clearCustomName: (projectKey: string) => void;
}

export const useSidebarRenameStore = create<SidebarRenameStoreState>()(
  persist(
    (set, get) => ({
      customNames: {},
      getCustomName: (projectKey) => get().customNames[projectKey] ?? null,
      setCustomName: (projectKey, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          customNames: { ...state.customNames, [projectKey]: trimmed },
        }));
      },
      clearCustomName: (projectKey) => {
        set((state) => {
          const next = { ...state.customNames };
          delete next[projectKey];
          return { customNames: next };
        });
      },
    }),
    {
      name: "sidebar-custom-names",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ customNames: state.customNames }),
    },
  ),
);
