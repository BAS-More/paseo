/** @vitest-environment jsdom */
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Explicit isolation decision: test sidebar composition, not native animation
// or daemon fetching. Real buttons/tabs/footer render; separate list tests and
// the unchanged Playwright suite cover the actual workspace/session behavior.
vi.mock("@/hooks/use-open-project-picker", () => ({ useOpenProjectPicker: () => vi.fn() }));
vi.mock("@/hooks/use-sidebar-shortcut-model", () => ({ useSidebarShortcutModel: vi.fn() }));
vi.mock("@/hooks/use-sidebar-workspaces-list", () => ({ useSidebarWorkspacesList: vi.fn() }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: vi.fn(),
  useHostRuntimeSnapshot: () => null,
}));
vi.mock("@/hooks/use-agent-history", () => ({ useAgentHistory: vi.fn() }));
vi.mock("@/stores/session-store", () => ({ useSessionStore: vi.fn() }));
vi.mock("@/utils/workspace-navigation", () => ({ navigateToPreparedWorkspaceTab: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));
vi.mock("@gorhom/portal", () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@gorhom/bottom-sheet", () => ({ useBottomSheetModalInternal: () => null }));
vi.mock("lucide-react-native", () => {
  const Icon = () => <svg />;
  return {
    MessagesSquare: Icon,
    FolderPlus: Icon,
    PanelLeftOpen: Icon,
    Plus: Icon,
    Search: Icon,
    Settings: Icon,
    X: Icon,
    Zap: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
  };
});
vi.mock("expo-router", () => ({
  router: { push: vi.fn(), navigate: vi.fn() },
  usePathname: () => "/h/test-host/workspace/project",
  useLocalSearchParams: () => ({}),
}));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { layoutMode: "claude-desktop" } }),
}));
vi.mock("@/utils/desktop-window", () => ({
  useWindowControlsPadding: () => ({ top: 0, left: 0, right: 0 }),
}));
vi.mock("@/components/desktop/titlebar-drag-region", () => ({ TitlebarDragRegion: () => null }));
vi.mock("@/components/sidebar-workspace-list", () => ({
  SidebarWorkspaceList: ({ serverId }: { serverId: string | null }) => (
    <div data-testid="workspace-surface">Workspaces for {serverId}</div>
  ),
}));
vi.mock("@/components/sidebar/sidebar-session-list", () => ({
  SidebarSessionList: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="session-surface">Sessions for {activeTab}</div>
  ),
}));
vi.mock("@/components/sidebar-callout-slot", () => ({
  SidebarCalloutSlot: () => <div data-testid="callout-surface">Update available</div>,
}));
vi.mock("@/components/ui/combobox", () => ({ Combobox: () => null, ComboboxItem: () => null }));
vi.mock("@/hooks/use-shortcut-keys", () => ({ useShortcutKeys: () => null }));
vi.mock("@/contexts/sidebar-animation-context", () => ({
  useSidebarAnimation: () => ({
    translateX: { value: 0 },
    backdropOpacity: { value: 1 },
    windowWidth: 390,
    animateToOpen: vi.fn(),
    animateToClose: vi.fn(),
    isGesturing: { value: false },
    gestureAnimatingRef: { current: false },
    closeGestureRef: { current: undefined },
  }),
}));
vi.mock("react-native-gesture-handler", () => {
  function gesture(): object {
    const chain: object = new Proxy({}, { get: () => () => chain });
    return chain;
  }
  return {
    Gesture: { Pan: gesture, Native: gesture },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  return {
    default: { View },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (callback: () => unknown) => callback(),
    runOnJS: (callback: unknown) => callback,
    interpolate: () => 1,
    Extrapolation: { CLAMP: "clamp" },
  };
});
vi.mock("react-native-unistyles", async () => {
  const { darkTheme } = await import("@/styles/theme");
  const { StyleSheet: nativeStyles } = await import("react-native");
  return {
    StyleSheet: {
      ...nativeStyles,
      create: (factory: unknown) => (typeof factory === "function" ? factory(darkTheme) : factory),
    },
    useUnistyles: () => ({ theme: darkTheme, rt: {} }),
    UnistylesRuntime: { themeName: "dark" },
  };
});
import { DesktopSidebar, MobileSidebar } from "./left-sidebar";
import { darkTheme } from "@/styles/theme";
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
function props(): ComponentProps<typeof DesktopSidebar> {
  return {
    theme: darkTheme,
    activeServerId: "test-host",
    activeHostLabel: "Test host",
    activeHostStatusColor: "green",
    hostOptions: [],
    hostTriggerRef: { current: null },
    isHostPickerOpen: false,
    setIsHostPickerOpen: vi.fn(),
    projects: [],
    isInitialLoad: false,
    isRevalidating: false,
    isManualRefresh: false,
    collapsedProjectKeys: new Set(),
    shortcutIndexByWorkspaceKey: new Map(),
    toggleProjectCollapsed: vi.fn(),
    handleRefresh: vi.fn(),
    handleHostSelect: vi.fn(),
    handleOpenProject: vi.fn(),
    handleSettings: vi.fn(),
    renderHostOption: () => <div />,
    agentHistoryAgents: [],
    agentHistoryIsLoading: false,
    agentHistoryLoadMore: vi.fn(),
    handleSessionPress: vi.fn(),
    insetsTop: 0,
    isOpen: true,
    handleViewMore: vi.fn(),
    handleRoutines: vi.fn(),
  };
}
describe("LeftSidebar navigation surfaces", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  function button(testId: string): HTMLElement {
    const result = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    expect(result).not.toBeNull();
    return result!;
  }
  it("keeps Code workspaces reachable without removing the fork's session tabs", () => {
    act(() => root.render(<DesktopSidebar {...props()} />));
    expect(container.querySelector('[data-testid="workspace-surface"]')?.textContent).toBe(
      "Workspaces for test-host",
    );
    expect(container.querySelector('[data-testid="session-surface"]')?.textContent).toBe(
      "Sessions for code",
    );
    const chat = container.querySelector<HTMLElement>('[role="tab"][aria-label="Chat"]');
    expect(chat).not.toBeNull();
    act(() => chat!.click());
    expect(container.querySelector('[data-testid="workspace-surface"]')).toBeNull();
    expect(container.querySelector('[data-testid="session-surface"]')?.textContent).toBe(
      "Sessions for chat",
    );
  });
  it("wires desktop Sessions and Settings controls and keeps update callouts mounted", () => {
    const input = props();
    act(() => root.render(<DesktopSidebar {...input} />));
    act(() => button("sidebar-sessions").click());
    act(() => button("sidebar-settings").click());
    expect(input.handleViewMore).toHaveBeenCalledTimes(1);
    expect(input.handleSettings).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="callout-surface"]')?.textContent).toBe(
      "Update available",
    );
  });
  it("keeps Settings reachable when the desktop sidebar is collapsed", () => {
    const input = props();
    act(() => root.render(<DesktopSidebar {...input} isOpen={false} />));
    act(() => button("sidebar-settings").click());
    expect(input.handleSettings).toHaveBeenCalledTimes(1);
  });
  it("keeps compact Settings and Close available in the default claude-desktop layout", () => {
    const input = props();
    const close = vi.fn();
    act(() =>
      root.render(
        <MobileSidebar
          {...input}
          insetsBottom={0}
          closeToAgent={close}
          handleViewMoreNavigate={input.handleViewMore}
          handleRoutinesNavigate={input.handleRoutines}
        />,
      ),
    );
    act(() => button("sidebar-settings").click());
    act(() => button("sidebar-close").click());
    expect(input.handleSettings).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
