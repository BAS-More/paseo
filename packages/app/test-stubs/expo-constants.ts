// Stub for expo-constants in vitest.
// The real package references __DEV__ global which isn't defined in vitest.

const Constants = {
  expoConfig: null,
  expoGoConfig: null,
  easConfig: null,
  appOwnership: null,
  debugMode: false,
  deviceName: "Test Device",
  deviceYearClass: 2024,
  executionEnvironment: "bare",
  experienceUrl: "",
  getWebViewUserAgentAsync: async () => "vitest",
  installationId: "test-installation-id",
  isDevice: false,
  isHeadless: true,
  linkingUri: "",
  manifest: null,
  manifest2: null,
  nativeAppVersion: "1.0.0",
  nativeBuildVersion: "1",
  platform: { web: {} },
  sessionId: "test-session-id",
  statusBarHeight: 0,
  systemFonts: [],
};

export default Constants;
