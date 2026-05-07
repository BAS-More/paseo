import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Logger } from "pino";

import { CrewAiAgentClient, CREWAI_PROVIDER_ID, CREWAI_CAPABILITIES } from "../crewai-agent.js";

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

describe("CrewAiAgentClient", () => {
  let logger: Logger;
  let client: CrewAiAgentClient;

  beforeEach(() => {
    logger = createMockLogger();
    client = new CrewAiAgentClient({ logger });
  });

  it("has correct provider id", () => {
    expect(client.provider).toBe(CREWAI_PROVIDER_ID);
  });

  it("has correct capabilities", () => {
    expect(client.capabilities).toEqual(CREWAI_CAPABILITIES);
  });

  it("supports streaming", () => {
    expect(client.capabilities.supportsStreaming).toBe(true);
  });

  it("does not support session persistence", () => {
    expect(client.capabilities.supportsSessionPersistence).toBe(false);
  });

  it("does not support MCP servers", () => {
    expect(client.capabilities.supportsMcpServers).toBe(false);
  });

  it("isAvailable returns false when bridge is unreachable", async () => {
    const c = new CrewAiAgentClient({
      logger,
      bridgeUrl: "http://localhost:19999",
    });
    const available = await c.isAvailable();
    expect(available).toBe(false);
  });

  it("listModels returns empty when bridge is unreachable", async () => {
    const c = new CrewAiAgentClient({
      logger,
      bridgeUrl: "http://localhost:19999",
    });
    const models = await c.listModels({ cwd: ".", force: false });
    expect(models).toEqual([]);
  });

  it("resumeSession throws not supported", async () => {
    await expect(
      client.resumeSession({ provider: CREWAI_PROVIDER_ID, sessionId: "x" }),
    ).rejects.toThrow("not supported");
  });
});

describe("CrewAiAgentClient with mock fetch", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it("isAvailable returns true when bridge responds 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    });
    const c = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const available = await c.isAvailable();
    expect(available).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("listModels maps crew list to model definitions", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: "crew-1", name: "Research Crew" },
          { id: "crew-2", name: "Writing Crew" },
        ]),
    });
    const c = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const models = await c.listModels({ cwd: ".", force: false });
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      provider: CREWAI_PROVIDER_ID,
      id: "crew-1",
      label: "Research Crew",
    });
    expect(models[1]).toMatchObject({
      provider: CREWAI_PROVIDER_ID,
      id: "crew-2",
      label: "Writing Crew",
    });
  });

  it("listModels marks first crew as default", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: "crew-1", name: "Only Crew" }]),
    });
    const c = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const models = await c.listModels({ cwd: ".", force: false });
    expect(models[0].isDefault).toBe(true);
  });
});
