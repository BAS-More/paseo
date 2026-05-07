import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Logger } from "pino";
import { EventEmitter } from "node:events";

import { GeminiAgentClient, GEMINI_PROVIDER_ID, GEMINI_CAPABILITIES } from "../gemini-agent.js";

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
