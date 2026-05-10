import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Logger } from "pino";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
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

function createSseStream(...lines: string[]) {
  const encoder = new globalThis.TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + "\n"));
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i]!);
        i++;
      } else {
        controller.close();
      }
    },
  });
}

describe("CrewAiAgentSession", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it("createSession returns session with correct provider and id", async () => {
    const mockFetch = vi.fn();
    const client = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const session = await client.createSession({ model: "crew-1", systemPrompt: "", maxTurns: 1 });
    expect(session.provider).toBe(CREWAI_PROVIDER_ID);
    expect(session.id).toMatch(/^crewai-/);
    await session.close();
  });

  it("startTurn emits turn_started and streams SSE events", async () => {
    const stream = createSseStream(
      'data: {"type":"status","message":"Starting crew run..."}',
      'data: {"type":"result","output":"Done!"}',
      "data: [DONE]",
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    });

    const client = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const session = await client.createSession({ model: "crew-1", systemPrompt: "", maxTurns: 1 });

    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    await session.startTurn("test prompt");
    // Wait for SSE processing
    await new Promise((r) => setTimeout(r, 200));

    expect(events[0]!.type).toBe("turn_started");
    expect(events.some((e) => e.type === "timeline")).toBe(true);
    expect(events.some((e) => e.type === "turn_completed")).toBe(true);

    await session.close();
  });

  it("startTurn emits turn_failed on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
    });

    const client = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const session = await client.createSession({ model: "crew-1", systemPrompt: "", maxTurns: 1 });

    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    await session.startTurn("test");
    await new Promise((r) => setTimeout(r, 200));

    expect(events.some((e) => e.type === "turn_failed")).toBe(true);
    await session.close();
  });

  it("run resolves when turn_completed is emitted", async () => {
    const stream = createSseStream('data: {"type":"result","output":"Answer"}', "data: [DONE]");

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: stream });

    const client = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const session = await client.createSession({ model: "crew-1", systemPrompt: "", maxTurns: 1 });

    const result = await session.run("test prompt");
    expect(result.sessionId).toMatch(/^crewai-/);

    await session.close();
  });

  it("interrupt aborts the stream", async () => {
    function createAbortableFetch(_url: string, opts: { signal: AbortSignal }) {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    const mockFetch = vi.fn().mockImplementation(createAbortableFetch);

    const client = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const session = await client.createSession({ model: "crew-1", systemPrompt: "", maxTurns: 1 });

    await session.startTurn("long task");
    await session.interrupt();
    // Should not throw
    await session.close();
  });

  it("streamHistory yields nothing", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });
    const events: AgentStreamEvent[] = [];
    for await (const e of session.streamHistory()) {
      events.push(e);
    }
    expect(events).toHaveLength(0);
    await session.close();
  });

  it("getRuntimeInfo returns provider and session info", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const session = await client.createSession({ model: "crew-x", systemPrompt: "", maxTurns: 1 });
    const info = await session.getRuntimeInfo();
    expect(info.provider).toBe(CREWAI_PROVIDER_ID);
    expect(info.model).toBe("crew-x");
    await session.close();
  });

  it("getAvailableModes returns empty array", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });
    expect(await session.getAvailableModes()).toEqual([]);
    await session.close();
  });

  it("getCurrentMode returns null", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });
    expect(await session.getCurrentMode()).toBeNull();
    await session.close();
  });

  it("setMode is a no-op", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });
    await expect(session.setMode("plan")).resolves.toBeUndefined();
    await session.close();
  });

  it("getPendingPermissions returns empty", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });
    expect(session.getPendingPermissions()).toEqual([]);
    await session.close();
  });

  it("respondToPermission is a no-op", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });
    await expect(session.respondToPermission("req-1", { allow: true })).resolves.toBeUndefined();
    await session.close();
  });

  it("describePersistence returns null", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });
    expect(session.describePersistence()).toBeNull();
    await session.close();
  });

  it("startTurn handles array prompt input", async () => {
    const stream = createSseStream('data: {"type":"result","output":"ok"}', "data: [DONE]");
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: stream });

    const client = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });

    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    await session.startTurn([
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ]);
    await new Promise((r) => setTimeout(r, 200));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("line 1\\nline 2"),
      }),
    );

    await session.close();
  });

  it("handles partial-line SSE chunks that split across reads", async () => {
    const encoder = new globalThis.TextEncoder();
    // First chunk delivers partial JSON, second completes it + [DONE]
    const chunk1 = encoder.encode('data: {"type":"status","mess');
    const chunk2 = encoder.encode('age":"hi"}\ndata: [DONE]\n');
    let i = 0;
    const chunks = [chunk1, chunk2];
    const stream = new ReadableStream({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(chunks[i]!);
          i++;
        } else {
          controller.close();
        }
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: stream });
    const client = new CrewAiAgentClient({ logger, _fetchForTest: mockFetch });
    const session = await client.createSession({ model: "c", systemPrompt: "", maxTurns: 1 });

    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    await session.startTurn("test");
    await new Promise((r) => setTimeout(r, 200));

    const timeline = events.filter((e) => e.type === "timeline");
    expect(timeline).toHaveLength(1);
    expect((timeline[0] as { item: { text: string } }).item.text).toBe("hi");

    await session.close();
  });

  it("listPersistedAgents returns empty array", async () => {
    const client = new CrewAiAgentClient({ logger, _fetchForTest: vi.fn() });
    const result = await client.listPersistedAgents!();
    expect(result).toEqual([]);
  });
});
