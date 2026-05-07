import { describe, expect, it } from "vitest";

import { AGENT_PROVIDER_DEFINITIONS, buildProviderRegistry } from "../provider-registry.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { OCC_PROVIDER_ID } from "./occ-agent.js";
import { CREWAI_PROVIDER_ID } from "./crewai-agent.js";
import { GEMINI_PROVIDER_ID, GEMINI_CAPABILITIES } from "./gemini-agent.js";

const logger = createTestLogger();

describe("CC GUI provider integration", () => {
  const CC_GUI_PROVIDERS = [OCC_PROVIDER_ID, CREWAI_PROVIDER_ID, GEMINI_PROVIDER_ID];

  it("all CC GUI providers have manifest definitions", () => {
    const definedIds = AGENT_PROVIDER_DEFINITIONS.map((d) => d.id);
    for (const id of CC_GUI_PROVIDERS) {
      expect(definedIds).toContain(id);
    }
  });

  it("all CC GUI providers have registry factories", () => {
    const registry = buildProviderRegistry(logger);
    for (const id of CC_GUI_PROVIDERS) {
      expect(registry[id]).toBeDefined();
      expect(registry[id].id).toBe(id);
    }
  });

  it("OCC manifest has correct label and modes", () => {
    const def = AGENT_PROVIDER_DEFINITIONS.find((d) => d.id === OCC_PROVIDER_ID);
    expect(def).toBeDefined();
    expect(def!.label).toBe("OpenClaude");
    expect(def!.modes.length).toBeGreaterThan(0);
    expect(def!.defaultModeId).toBe("default");
  });

  it("CrewAI manifest has correct label and no modes", () => {
    const def = AGENT_PROVIDER_DEFINITIONS.find((d) => d.id === CREWAI_PROVIDER_ID);
    expect(def).toBeDefined();
    expect(def!.label).toBe("CrewAI");
    expect(def!.modes).toHaveLength(0);
    expect(def!.defaultModeId).toBeNull();
  });

  it("Gemini manifest has correct label and no modes", () => {
    const def = AGENT_PROVIDER_DEFINITIONS.find((d) => d.id === GEMINI_PROVIDER_ID);
    expect(def).toBeDefined();
    expect(def!.label).toBe("Gemini");
    expect(def!.modes).toHaveLength(0);
    expect(def!.defaultModeId).toBeNull();
  });

  it("Gemini capabilities declare tool and session support", () => {
    expect(GEMINI_CAPABILITIES.supportsToolInvocations).toBe(true);
    expect(GEMINI_CAPABILITIES.supportsSessionPersistence).toBe(true);
  });

  it("registry entries have createClient function", () => {
    const registry = buildProviderRegistry(logger);
    for (const id of CC_GUI_PROVIDERS) {
      expect(typeof registry[id].createClient).toBe("function");
    }
  });

  it("registry provider count includes all CC GUI providers", () => {
    const registry = buildProviderRegistry(logger);
    const registryIds = Object.keys(registry);
    expect(registryIds.length).toBeGreaterThanOrEqual(AGENT_PROVIDER_DEFINITIONS.length);
    for (const id of CC_GUI_PROVIDERS) {
      expect(registryIds).toContain(id);
    }
  });
});
