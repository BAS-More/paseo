import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Logger } from "pino";
import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { GeminiAgentClient, GEMINI_PROVIDER_ID, GEMINI_CAPABILITIES } from "../gemini-agent.js";
import * as spawnUtils from "../../../../utils/spawn.js";

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

interface MockProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: ReturnType<typeof vi.fn> };
  pid: number;
  kill: ReturnType<typeof vi.fn>;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() };
  proc.pid = 12345;
  proc.kill = vi.fn();
  return proc;
}

describe("GeminiAgentClient", () => {
  let logger: Logger;
  let client: GeminiAgentClient;

  beforeEach(() => {
    logger = createMockLogger();
    client = new GeminiAgentClient({ logger });
  });

  it("has correct provider id", () => {
    expect(client.provider).toBe(GEMINI_PROVIDER_ID);
  });

  it("has correct capabilities", () => {
    expect(client.capabilities).toEqual(GEMINI_CAPABILITIES);
  });

  it("supports streaming", () => {
    expect(client.capabilities.supportsStreaming).toBe(true);
  });

  it("supports session persistence", () => {
    expect(client.capabilities.supportsSessionPersistence).toBe(true);
  });

  it("does not support MCP servers", () => {
    expect(client.capabilities.supportsMcpServers).toBe(false);
  });

  it("supports tool invocations", () => {
    expect(client.capabilities.supportsToolInvocations).toBe(true);
  });

  it("listModels returns hardcoded gemini models", async () => {
    const models = await client.listModels({ cwd: ".", force: false });
    expect(models.length).toBeGreaterThanOrEqual(2);
    expect(models[0].provider).toBe(GEMINI_PROVIDER_ID);
    expect(models[0].isDefault).toBe(true);
    expect(models.some((m) => m.id.includes("flash"))).toBe(true);
  });

  it("resumeSession spawns process with --resume flag", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const c = new GeminiAgentClient({ logger, _spawnForTest: mockSpawn });
    const session = await c.resumeSession({
      provider: GEMINI_PROVIDER_ID,
      sessionId: "gemini-session-abc",
    });
    expect(session).toBeDefined();
    expect(session.id).toBeTruthy();
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--resume");
    expect(spawnArgs).toContain("gemini-session-abc");
  });
});

describe("GeminiAgentClient isAvailable", () => {
  it("returns true when gemini binary is found", async () => {
    const mockSpawnSync = vi.fn().mockReturnValue({ status: 0, error: null });
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnSyncForTest: mockSpawnSync,
    });
    const available = await client.isAvailable();
    expect(available).toBe(true);
  });

  it("returns false when gemini binary is not found", async () => {
    const mockSpawnSync = vi.fn().mockReturnValue({ status: null, error: new Error("ENOENT") });
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnSyncForTest: mockSpawnSync,
    });
    const available = await client.isAvailable();
    expect(available).toBe(false);
  });
});

describe("GeminiAgentSession streaming", () => {
  it("emits turn_started on startTurn", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
    });
    const session = await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));
    await session.startTurn("Hello");

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({
      type: "turn_started",
      provider: GEMINI_PROVIDER_ID,
    });
  });

  it("parses NDJSON from stdout and emits mapped events", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
    });
    const session = await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));
    await session.startTurn("Hello");

    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "Hi there",
      delta: true,
    });
    mockProcess.stdout.emit("data", Buffer.from(line + "\n"));

    const timelineEvents = events.filter((e) => (e as Record<string, unknown>).type === "timeline");
    expect(timelineEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("emits turn_failed on stderr", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
    });
    const session = await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));
    await session.startTurn("Hello");

    mockProcess.stderr.emit("data", Buffer.from("fatal error occurred\n"));

    await new Promise((r) => setTimeout(r, 10));
    const errorEvents = events.filter((e) => (e as Record<string, unknown>).type === "turn_failed");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("interrupt kills spawned process", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
    });
    const session = await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });
    await session.startTurn("test");
    await session.interrupt();
    expect(mockProcess.kill).toHaveBeenCalled();
  });

  it("close kills process and removes listeners", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
    });
    const session = await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });
    await session.startTurn("test");
    await session.close();
    expect(mockProcess.kill).toHaveBeenCalled();
  });

  it("startTurn spawns a new process for each turn", async () => {
    const mockProcess1 = createMockProcess();
    const mockProcess2 = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValueOnce(mockProcess1).mockReturnValueOnce(mockProcess2);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
    });
    const session = await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);

    await session.startTurn("Second turn");
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const secondCallArgs = mockSpawn.mock.calls[1][1] as string[];
    expect(secondCallArgs).toContain("--prompt");
    expect(secondCallArgs).toContain("Second turn");
    expect(secondCallArgs).toContain("--output-format");
  });

  it("run resolves when process exits cleanly", async () => {
    const mockProcess1 = createMockProcess();
    const mockProcess2 = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValueOnce(mockProcess1).mockReturnValueOnce(mockProcess2);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
    });
    const session = await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    const runPromise = session.run("test prompt");
    await new Promise((r) => setTimeout(r, 10));
    mockProcess2.emit("close", 0);

    const result = await runPromise;
    expect(result.sessionId).toBeTruthy();
  });

  it("getRuntimeInfo returns provider and model", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
    });
    const session = await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
      model: "gemini-2.5-pro",
    });
    const info = await session.getRuntimeInfo();
    expect(info.provider).toBe(GEMINI_PROVIDER_ID);
    expect(info.model).toBe("gemini-2.5-pro");
  });
});

describe("GeminiAgentClient uses spawnProcess by default", () => {
  it("calls spawnProcess from utils when no _spawnForTest provided", async () => {
    const mockProcess = createMockProcess();
    const spy = vi
      .spyOn(spawnUtils, "spawnProcess")
      .mockReturnValue(mockProcess as unknown as ChildProcess);

    const client = new GeminiAgentClient({ logger: createMockLogger() });
    await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("gemini");
    spy.mockRestore();
  });
});

describe("GeminiAgentSession — gap-fill coverage", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it("streamHistory yields nothing", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });
    const events: unknown[] = [];
    for await (const e of session.streamHistory()) {
      events.push(e);
    }
    expect(events).toHaveLength(0);
  });

  it("getAvailableModes returns empty array", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });
    expect(await session.getAvailableModes()).toEqual([]);
  });

  it("getCurrentMode returns null", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });
    expect(await session.getCurrentMode()).toBeNull();
  });

  it("setMode is a no-op", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });
    await expect(session.setMode("plan")).resolves.toBeUndefined();
  });

  it("getPendingPermissions returns empty", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });
    expect(session.getPendingPermissions()).toEqual([]);
  });

  it("respondToPermission is a no-op", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });
    await expect(session.respondToPermission("req-1", { allow: true })).resolves.toBeUndefined();
  });

  it("describePersistence returns provider and sessionId", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });
    const handle = session.describePersistence();
    expect(handle).not.toBeNull();
    expect(handle!.provider).toBe(GEMINI_PROVIDER_ID);
    expect(handle!.sessionId).toMatch(/^gemini-/);
  });

  it("processLine with malformed JSON is silently ignored", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));

    mockProc.stdout.emit("data", Buffer.from("not valid json\n"));
    await new Promise((r) => setTimeout(r, 10));

    // Malformed JSON should NOT produce events (unlike OCC which emits raw text)
    const failEvents = events.filter((e) => (e as Record<string, unknown>).type === "turn_failed");
    expect(failEvents).toHaveLength(0);
  });

  it("stderr DeprecationWarning is filtered out", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));

    mockProc.stderr.emit("data", Buffer.from("DeprecationWarning: some old api\n"));
    await new Promise((r) => setTimeout(r, 10));

    const failEvents = events.filter((e) => (e as Record<string, unknown>).type === "turn_failed");
    expect(failEvents).toHaveLength(0);
  });

  it("stderr 'Loaded cached credentials' is filtered out", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));

    mockProc.stderr.emit("data", Buffer.from("Loaded cached credentials for user\n"));
    await new Promise((r) => setTimeout(r, 10));

    const failEvents = events.filter((e) => (e as Record<string, unknown>).type === "turn_failed");
    expect(failEvents).toHaveLength(0);
  });

  it("session ID extracted from init event", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    mockProc.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "init", session_id: "gemini-custom-42" }) + "\n"),
    );
    await new Promise((r) => setTimeout(r, 10));

    const handle = session.describePersistence();
    expect(handle!.sessionId).toBe("gemini-custom-42");
  });

  it("startTurn with array prompt extracts text blocks", async () => {
    const mockProc1 = createMockProcess();
    const mockProc2 = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);
    const client = new GeminiAgentClient({ logger, _spawnForTest: mockSpawn });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    await session.startTurn([
      { type: "text", text: "part 1" },
      { type: "text", text: "part 2" },
    ]);

    const secondCallArgs = mockSpawn.mock.calls[1][1] as string[];
    const promptIndex = secondCallArgs.indexOf("--prompt");
    expect(secondCallArgs[promptIndex + 1]).toBe("part 1\npart 2");
  });

  it("process error emits turn_failed", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));

    mockProc.emit("error", new Error("spawn ENOENT"));
    await new Promise((r) => setTimeout(r, 10));

    expect(events.some((e) => (e as Record<string, unknown>).type === "turn_failed")).toBe(true);
  });

  it("non-zero exit code emits turn_failed", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));

    mockProc.emit("close", 1);
    await new Promise((r) => setTimeout(r, 10));

    const failEvents = events.filter((e) => (e as Record<string, unknown>).type === "turn_failed");
    expect(failEvents.length).toBeGreaterThan(0);
  });

  it("remaining lineBuffer flushed on close", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));

    // Send data without trailing newline (stays in buffer)
    mockProc.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ type: "message", role: "assistant", content: "buffered", delta: true }),
      ),
    );
    // Close should flush the buffer
    mockProc.emit("close", 0);
    await new Promise((r) => setTimeout(r, 10));

    expect(events.some((e) => (e as Record<string, unknown>).type === "timeline")).toBe(true);
  });

  it("run resolves on turn_failed too", async () => {
    const mockProc1 = createMockProcess();
    const mockProc2 = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);
    const client = new GeminiAgentClient({ logger, _spawnForTest: mockSpawn });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    const runPromise = session.run("test");
    await new Promise((r) => setTimeout(r, 10));
    mockProc2.emit("close", 1);

    const result = await runPromise;
    expect(result.sessionId).toBeTruthy();
  });

  it("isAvailable returns false when spawnSync throws", async () => {
    const client = new GeminiAgentClient({
      logger,
      _spawnSyncForTest: () => {
        throw new Error("ENOENT");
      },
    });
    const available = await client.isAvailable();
    expect(available).toBe(false);
  });

  it("resumeSession passes overrides", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const client = new GeminiAgentClient({ logger, _spawnForTest: mockSpawn });
    const session = await client.resumeSession(
      { provider: GEMINI_PROVIDER_ID, sessionId: "gemini-old" },
      { model: "gemini-2.5-pro", cwd: "/project" },
    );
    expect(session.id).toBe("gemini-old");
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--model");
    expect(args).toContain("gemini-2.5-pro");
  });

  it("createSession with systemPrompt passes --prompt", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const client = new GeminiAgentClient({ logger, _spawnForTest: mockSpawn });
    await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
      systemPrompt: "You are a helpful assistant",
    });
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--prompt");
    expect(args).toContain("You are a helpful assistant");
  });

  it("empty stderr is ignored", async () => {
    const mockProc = createMockProcess();
    const client = new GeminiAgentClient({ logger, _spawnForTest: () => mockProc });
    const session = await client.createSession({ provider: GEMINI_PROVIDER_ID, cwd: "." });

    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));

    mockProc.stderr.emit("data", Buffer.from("   \n"));
    await new Promise((r) => setTimeout(r, 10));

    const failEvents = events.filter((e) => (e as Record<string, unknown>).type === "turn_failed");
    expect(failEvents).toHaveLength(0);
  });
});

describe("GeminiAgentClient MCP config injection", () => {
  it("passes --mcp-config when ~/.gemini.json has mcpServers", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
      _readFileForTest: async () =>
        JSON.stringify({ mcpServers: { myServer: { command: "node", args: ["server.js"] } } }),
    });

    await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--mcp-config");
  });

  it("does not pass --mcp-config when ~/.gemini.json has no mcpServers", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
      _readFileForTest: async () => JSON.stringify({}),
    });

    await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain("--mcp-config");
  });

  it("does not pass --mcp-config when ~/.gemini.json does not exist", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
      _readFileForTest: async () => {
        throw new Error("ENOENT");
      },
    });

    await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: ".",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain("--mcp-config");
  });

  it("detects project-specific mcpServers in geminiProjects", async () => {
    const mockProcess = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProcess);
    const client = new GeminiAgentClient({
      logger: createMockLogger(),
      _spawnForTest: mockSpawn,
      _readFileForTest: async () =>
        JSON.stringify({
          geminiProjects: {
            "/my/project": { mcpServers: { db: { command: "sqlite-mcp" } } },
          },
        }),
    });

    await client.createSession({
      provider: GEMINI_PROVIDER_ID,
      cwd: "/my/project",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--mcp-config");
  });
});
