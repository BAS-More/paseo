/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme, nineRouterState, refreshMock } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, "1.5": 6, 2: 8, 3: 12, 4: 16, 6: 24 },
    iconSize: { sm: 14, md: 20 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400" },
    borderRadius: { lg: 8, full: 9999 },
    opacity: { 50: 0.5 },
    colors: {
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      accent: "#0a84ff",
      statusSuccess: "#00ff00",
      statusWarning: "#ff9500",
      statusDanger: "#ff0000",
      palette: { red: { 300: "#ff6b6b" }, white: "#fff" },
    },
  },
  nineRouterState: {
    status: undefined as
      | {
          reachable: boolean;
          accounts: Array<{ id: string; name: string; provider: string; status: string }>;
          usage: {
            totalRequests: number;
            totalTokens: number;
            totalCost: number;
            byAccount: Array<{ id: string; requests: number; tokens: number; cost: number }>;
          };
        }
      | undefined,
    isLoading: false,
    error: null as string | null,
  },
  refreshMock: vi.fn(async () => {}),
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Pressable: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => React.createElement("div", { "data-testid": testID, onClick: onPress }, children),
  ActivityIndicator: () => React.createElement("span", { "data-testid": "activity-indicator" }),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    Activity: icon("Activity"),
    RefreshCw: icon("RefreshCw"),
    Wifi: icon("Wifi"),
    WifiOff: icon("WifiOff"),
  };
});

vi.mock("@/hooks/use-nine-router-status", () => ({
  useNineRouterStatus: () => ({
    status: nineRouterState.status,
    isLoading: nineRouterState.isLoading,
    error: nineRouterState.error,
    refresh: refreshMock,
  }),
}));

vi.mock("@/styles/settings", () => ({
  settingsStyles: {
    section: {},
    card: {},
    row: {},
    rowBorder: {},
    rowContent: {},
    rowTitle: {},
    rowHint: {},
  },
}));

vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({ title, children }: { title: string; children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "settings-section" }, [
      React.createElement("span", { key: "title" }, title),
      children,
    ]),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
}));

import { NineRouterSection } from "./nine-router-section";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  nineRouterState.status = undefined;
  nineRouterState.isLoading = false;
  nineRouterState.error = null;
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.clearAllMocks();
});

function render(serverId: string | null = "server-1"): void {
  act(() => {
    root.render(React.createElement(NineRouterSection, { serverId }));
  });
}

describe("NineRouterSection", () => {
  it("renders section title", () => {
    render();
    expect(container.textContent).toContain("9Router");
  });

  it("shows loading state", () => {
    nineRouterState.isLoading = true;
    render();
    expect(container.querySelector("[data-testid='activity-indicator']")).toBeTruthy();
  });

  it("shows connected status when reachable", () => {
    nineRouterState.status = {
      reachable: true,
      accounts: [{ id: "acc-1", name: "GPT-4", provider: "openai", status: "active" }],
      usage: { totalRequests: 100, totalTokens: 50000, totalCost: 1.5, byAccount: [] },
    };
    render();
    expect(container.textContent).toContain("Connected");
  });

  it("shows not connected status when unreachable", () => {
    nineRouterState.status = {
      reachable: false,
      accounts: [],
      usage: { totalRequests: 0, totalTokens: 0, totalCost: 0, byAccount: [] },
    };
    render();
    expect(container.textContent).toContain("Not connected");
  });

  it("renders account list when reachable", () => {
    nineRouterState.status = {
      reachable: true,
      accounts: [
        { id: "acc-1", name: "GPT-4", provider: "openai", status: "active" },
        { id: "acc-2", name: "Claude", provider: "anthropic", status: "active" },
      ],
      usage: { totalRequests: 100, totalTokens: 50000, totalCost: 1.5, byAccount: [] },
    };
    render();
    expect(container.textContent).toContain("GPT-4");
    expect(container.textContent).toContain("Claude");
    expect(container.textContent).toContain("openai");
    expect(container.textContent).toContain("anthropic");
  });

  it("renders usage stats when reachable", () => {
    nineRouterState.status = {
      reachable: true,
      accounts: [],
      usage: { totalRequests: 100, totalTokens: 50000, totalCost: 1.5, byAccount: [] },
    };
    render();
    expect(container.textContent).toContain("100");
    expect(container.textContent).toContain("50,000");
    expect(container.textContent).toContain("$1.50");
  });

  it("shows error message", () => {
    nineRouterState.error = "Connection refused";
    render();
    expect(container.textContent).toContain("Connection refused");
  });

  it("renders nothing when serverId is null", () => {
    render(null);
    expect(container.textContent).toBe("");
  });
});
