// Stub for react-native-safe-area-context in vitest.
// The real package ships TypeScript source (`"react-native": "src/index.tsx"`)
// which vitest cannot transform from node_modules.
import * as React from "react";

const DEFAULT_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };
const DEFAULT_FRAME = { x: 0, y: 0, width: 0, height: 0 };

export const SafeAreaInsetsContext = React.createContext(DEFAULT_INSETS);
export const SafeAreaFrameContext = React.createContext(DEFAULT_FRAME);

export function SafeAreaProvider({ children }: { children?: React.ReactNode }) {
  return React.createElement(SafeAreaInsetsContext.Provider, { value: DEFAULT_INSETS }, children);
}

export function useSafeAreaInsets() {
  return DEFAULT_INSETS;
}

export function useSafeAreaFrame() {
  return DEFAULT_FRAME;
}

export function withSafeAreaInsets<T>(WrappedComponent: React.ComponentType<T>) {
  return WrappedComponent;
}

export function SafeAreaView({ children }: { children?: React.ReactNode }) {
  return React.createElement("div", null, children);
}

export const initialWindowMetrics = {
  insets: DEFAULT_INSETS,
  frame: DEFAULT_FRAME,
};
