import { describe, it, expect, vi, afterEach } from "vitest";
import { validateConfig, validateConfigOrExit } from "./config-validator.js";
import type { PaseoDaemonConfig } from "./bootstrap.js";

function makeConfig(overrides: Partial<PaseoDaemonConfig> = {}): PaseoDaemonConfig {
  return {
    listen: "127.0.0.1:6767",
    paseoHome: "/tmp/paseo-test",
    corsAllowedOrigins: [],
    hostnames: { allowed: [] },
    mcpEnabled: true,
    mcpInjectIntoAgents: false,
    mcpDebug: false,
    isDev: true,
    agentStoragePath: "/tmp/paseo-test/agents",
    staticDir: "public",
    agentClients: {},
    relayEnabled: false,
    relayEndpoint: "relay.paseo.sh:443",
    relayPublicEndpoint: "relay.paseo.sh:443",
    relayUseTls: false,
    appBaseUrl: "https://app.paseo.sh",
    openai: null,
    speech: { dictation: { provider: "off" }, tts: { provider: "off" } },
    voiceLlmProvider: null,
    voiceLlmProviderExplicit: false,
    voiceLlmModel: null,
    agentProviderSettings: undefined,
    providerOverrides: undefined,
    log: { level: "info", format: "pretty" },
    ...overrides,
  } as PaseoDaemonConfig;
}

describe("validateConfig", () => {
  it("returns no errors for valid config", () => {
    const errors = validateConfig(makeConfig(), { env: {} });
    expect(errors).toHaveLength(0);
  });

  it("returns error when paseoHome is empty", () => {
    const errors = validateConfig(makeConfig({ paseoHome: "" }), { env: {} });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("PASEO_HOME");
  });

  it("returns error when listen is empty", () => {
    const errors = validateConfig(makeConfig({ listen: "" }), { env: {} });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("PASEO_LISTEN");
  });

  it("returns password error in production without auth", () => {
    const errors = validateConfig(
      makeConfig({ auth: undefined, corsAllowedOrigins: ["https://app.paseo.sh"] }),
      { env: { NODE_ENV: "production" } },
    );
    expect(errors.some((e) => e.field === "PASEO_PASSWORD")).toBe(true);
  });

  it("returns no password error in production with auth", () => {
    const config = makeConfig({
      auth: { password: "$2b$12$hashed" },
      corsAllowedOrigins: ["https://app.paseo.sh"],
    });
    const errors = validateConfig(config, { env: { NODE_ENV: "production" } });
    expect(errors.some((e) => e.field === "PASEO_PASSWORD")).toBe(false);
  });

  it("warns about 0.0.0.0 without password in production", () => {
    const config = makeConfig({
      listen: "0.0.0.0:6767",
      auth: undefined,
      corsAllowedOrigins: ["https://app.paseo.sh"],
    });
    const errors = validateConfig(config, { env: { NODE_ENV: "production" } });
    const listenError = errors.find(
      (e) => e.field === "PASEO_LISTEN" && e.message.includes("all interfaces"),
    );
    expect(listenError).toBeDefined();
  });

  it("no listen warning when password is set", () => {
    const config = makeConfig({
      listen: "0.0.0.0:6767",
      auth: { password: "$2b$12$hashed" },
      corsAllowedOrigins: ["https://app.paseo.sh"],
    });
    const errors = validateConfig(config, { env: { NODE_ENV: "production" } });
    const listenError = errors.find(
      (e) => e.field === "PASEO_LISTEN" && e.message.includes("all interfaces"),
    );
    expect(listenError).toBeUndefined();
  });

  it("recognizes PASEO_NODE_ENV=production", () => {
    const errors = validateConfig(
      makeConfig({ auth: undefined, corsAllowedOrigins: ["https://app.paseo.sh"] }),
      { env: { PASEO_NODE_ENV: "production" } },
    );
    expect(errors.some((e) => e.field === "PASEO_PASSWORD")).toBe(true);
  });

  it("errors when CORS origins empty in production", () => {
    const config = makeConfig({
      auth: { password: "$2b$12$hashed" },
      corsAllowedOrigins: [],
    });
    const errors = validateConfig(config, { env: { NODE_ENV: "production" } });
    const corsError = errors.find(
      (e) => e.field === "PASEO_CORS_ORIGINS" && e.message.includes("No CORS origins"),
    );
    expect(corsError).toBeDefined();
  });

  it("warns about CORS wildcard in production", () => {
    const config = makeConfig({
      auth: { password: "$2b$12$hashed" },
      corsAllowedOrigins: ["*"],
    });
    const errors = validateConfig(config, { env: { NODE_ENV: "production" } });
    const corsWildcard = errors.find(
      (e) => e.field === "PASEO_CORS_ORIGINS" && e.message.includes("wildcard"),
    );
    expect(corsWildcard).toBeDefined();
  });

  it("no CORS error with explicit origins in production", () => {
    const config = makeConfig({
      auth: { password: "$2b$12$hashed" },
      corsAllowedOrigins: ["https://app.paseo.sh"],
    });
    const errors = validateConfig(config, { env: { NODE_ENV: "production" } });
    expect(errors.some((e) => e.field === "PASEO_CORS_ORIGINS")).toBe(false);
  });

  it("no CORS check in development mode", () => {
    const config = makeConfig({ corsAllowedOrigins: [] });
    const errors = validateConfig(config, { env: {} });
    expect(errors.some((e) => e.field === "PASEO_CORS_ORIGINS")).toBe(false);
  });
});

describe("validateConfigOrExit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing with valid config", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    validateConfigOrExit(makeConfig(), { env: {} });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("logs warnings in development mode", () => {
    const warned: string[] = [];
    const logger = {
      warn: (msg: string) => warned.push(msg),
      error: (msg: string) => warned.push(msg),
    };
    validateConfigOrExit(makeConfig({ paseoHome: "" }), { env: {}, logger });
    expect(warned.length).toBeGreaterThan(0);
    expect(warned[0]).toContain("PASEO_HOME");
  });

  it("exits in production mode with errors", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const logger = {
      warn: () => {},
      error: () => {},
    };
    validateConfigOrExit(
      makeConfig({ auth: undefined, corsAllowedOrigins: ["https://app.paseo.sh"] }),
      {
        env: { NODE_ENV: "production" },
        logger,
      },
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
