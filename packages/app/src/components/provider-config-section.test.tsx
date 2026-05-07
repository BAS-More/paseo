/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme, configState, patchConfigMock } = vi.hoisted(() => ({
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
  configState: {
    config: null as Record<string, unknown> | null,
    isLoading: false,
  },
  patchConfigMock: vi.fn(async () => {}),
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  TextInput: ({
    value,
    placeholder,
    testID,
  }: {
    value?: string;
    placeholder?: string;
    testID?: string;
  }) => React.createElement("input", { value, placeholder, "data-testid": testID }),
  Pressable: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", onClick: onPress, "data-testid": testID },
      children,
    ),
  ActivityIndicator: () => React.createElement("div", { "data-testid": "loading" }),
  StyleSheet: { create: (s: Record<string, unknown>) => s },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factoryOrObj: unknown) =>
      typeof factoryOrObj === "function" ? factoryOrObj(theme) : factoryOrObj,
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({ title, children }: { title: string; children?: React.ReactNode }) =>
    React.createElement("section", null, React.createElement("h3", null, title), children),
}));

vi.mock("@/styles/settings", () => ({
  settingsStyles: {
    card: { borderRadius: 8 },
    row: { padding: 16 },
    rowBorder: { borderTopWidth: 1 },
    rowContent: { flex: 1 },
    rowTitle: { fontSize: 15 },
    rowHint: { fontSize: 11 },
  },
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: configState.config,
    isLoading: configState.isLoading,
    patchConfig: patchConfigMock,
  }),
}));

vi.mock("@/constants/platform", () => ({
  isWeb: false,
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveTextInput: ({
    value,
    placeholder,
    testID,
  }: {
    value?: string;
    placeholder?: string;
    testID?: string;
  }) => React.createElement("input", { value, placeholder, "data-testid": testID }),
}));

let container: HTMLDivElement;
let root: Root;

function render(ui: React.ReactElement) {
  act(() => {
    root.render(ui);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  configState.config = null;
  configState.isLoading = false;
  patchConfigMock.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("ProviderConfigSection", () => {
  async function loadComponent() {
    const mod = await import("./provider-config-section.js");
    return mod.ProviderConfigSection;
  }

  it("renders nothing for providers without config fields", async () => {
    const ProviderConfigSection = await loadComponent();
    render(
      React.createElement(ProviderConfigSection, {
        provider: "claude",
        serverId: "srv-1",
      }),
    );
    expect(container.textContent).toBe("");
  });

  it("renders OCC config fields", async () => {
    configState.config = { providers: {} };
    const ProviderConfigSection = await loadComponent();
    render(
      React.createElement(ProviderConfigSection, {
        provider: "occ",
        serverId: "srv-1",
      }),
    );
    expect(container.textContent).toContain("Configuration");
    expect(container.textContent).toContain("Binary Path");
    expect(container.textContent).toContain("Agents Path");
    expect(container.textContent).toContain("API Base URL");
  });

  it("renders CrewAI config fields", async () => {
    configState.config = { providers: {} };
    const ProviderConfigSection = await loadComponent();
    render(
      React.createElement(ProviderConfigSection, {
        provider: "crewai",
        serverId: "srv-1",
      }),
    );
    expect(container.textContent).toContain("Configuration");
    expect(container.textContent).toContain("Bridge URL");
  });

  it("renders Gemini config fields", async () => {
    configState.config = { providers: {} };
    const ProviderConfigSection = await loadComponent();
    render(
      React.createElement(ProviderConfigSection, {
        provider: "gemini",
        serverId: "srv-1",
      }),
    );
    expect(container.textContent).toContain("Configuration");
    expect(container.textContent).toContain("Binary Path");
  });

  it("shows saved config values from provider config", async () => {
    configState.config = {
      providers: {
        occ: {
          occPath: "/custom/occ",
          agentsPath: "/my/agents",
          apiBaseUrl: "https://proxy.example.com",
        },
      },
    };
    const ProviderConfigSection = await loadComponent();
    render(
      React.createElement(ProviderConfigSection, {
        provider: "occ",
        serverId: "srv-1",
      }),
    );
    const inputs = container.querySelectorAll("input");
    const values = Array.from(inputs).map((i) => i.getAttribute("value"));
    expect(values).toContain("/custom/occ");
    expect(values).toContain("/my/agents");
    expect(values).toContain("https://proxy.example.com");
  });

  it("shows placeholder text for empty fields", async () => {
    configState.config = { providers: {} };
    const ProviderConfigSection = await loadComponent();
    render(
      React.createElement(ProviderConfigSection, {
        provider: "occ",
        serverId: "srv-1",
      }),
    );
    const inputs = container.querySelectorAll("input");
    const placeholders = Array.from(inputs).map((i) => i.getAttribute("placeholder"));
    expect(placeholders.some((p) => p && p.includes("occ"))).toBe(true);
  });
});
