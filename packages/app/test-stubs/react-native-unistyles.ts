// Stub for react-native-unistyles in vitest.
// The real package's web code (`src/web/`) is TypeScript that vitest tries to
// load via the .web.ts extension priority, bypassing compiled output.
import { vi } from "vitest";

// Proxy-based theme stub that returns safe defaults for any access pattern.
// This prevents failures when source code accesses theme.xxx.yyy at module scope.
const themeHandler: ProxyHandler<Record<string, unknown>> = {
  get(_target, prop) {
    if (typeof prop === "symbol") return undefined;
    // Return a nested proxy for any property access — allows theme.a.b.c etc.
    return new Proxy({} as Record<string, unknown>, {
      get(_t, innerProp) {
        if (typeof innerProp === "symbol") return undefined;
        // Return 0 for numeric-like keys (spacing[4], borderWidth[1]) and empty string/object otherwise
        if (/^\d+$/.test(String(innerProp))) return 0;
        return {};
      },
      // Spread support: ...theme.shadow.md
      ownKeys() {
        return [];
      },
      getOwnPropertyDescriptor() {
        return { configurable: true, enumerable: true, value: undefined };
      },
    });
  },
};
const STUB_THEME = new Proxy({} as Record<string, unknown>, themeHandler);

export const StyleSheet = {
  create: <T>(styles: T | ((theme: typeof STUB_THEME) => T)): T =>
    typeof styles === "function" ? (styles as (t: typeof STUB_THEME) => T)(STUB_THEME) : styles,
  configure: vi.fn(),
};

export function useUnistyles() {
  return {
    theme: {},
    rt: {},
    breakpoint: undefined,
  };
}

export const UnistylesRuntime = {
  setTheme: vi.fn(),
  themeName: "light",
  colorScheme: "light",
  hasAdaptiveThemes: false,
  setAdaptiveThemes: vi.fn(),
  addPlugin: vi.fn(),
  removePlugin: vi.fn(),
  updateTheme: vi.fn(),
  statusBar: { width: 0, height: 0 },
  navigationBar: { width: 0, height: 0 },
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  screen: { width: 375, height: 812 },
};
