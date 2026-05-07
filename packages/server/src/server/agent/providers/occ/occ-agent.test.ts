import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { Logger } from "pino";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { OccAgentClient, OCC_PROVIDER_ID, OCC_CAPABILITIES } from "../occ-agent.js";
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

function createMockProcess(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  proc.stdout = new EventEmitter() as unknown as Readable;
  proc.stderr = new EventEmitter() as unknown as Readable;
  proc.stdin = { end: vi.fn() } as unknown as Writable;
  proc.kill = vi.fn().mockReturnValue(true);
  proc.pid = 12345;
  return proc;
}

describe("OccAgentClient", () => {
  let logger: Logger;
  let client: OccAgentClient;

  beforeEach(() => {
    logger = createMockLogger();
    client = new OccAgentClient({ logger });
  });

  describe("provider identity", () => {
    it("has correct provider id", () => {
      expect(client.provider).toBe(OCC_PROVIDER_ID);
    });

    it("has correct capabilities", () => {
      expect(client.capabilities).toEqual(OCC_CAPABILITIES);
    });

    it("supports streaming", () => {
      expect(client.capabilities.supportsStreaming).toBe(true);
    });

    it("supports session persistence via resume", () => {
      expect(client.capabilities.supportsSessionPersistence).toBe(true);
    });

    it("does not support dynamic modes", () => {
      expect(client.capabilities.supportsDynamicModes).toBe(false);
    });

    it("supports tool invocations", () => {
      expect(client.capabilities.supportsToolInvocations).toBe(true);
    });

    it("supports reasoning stream", () => {
      expect(client.capabilities.supportsReasoningStream).toBe(true);
    });
  });

  describe("isAvailable", () => {
    it("returns false when OCC_PATH points to nonexistent binary", async () => {
      const c = new OccAgentClient({
        logger,
        occPath: "/nonexistent/path/to/occ-binary-that-does-not-exist",
      });
      const available = await c.isAvailable();
      expect(available).toBe(false);
    });
  });

  it("listModels returns at least one model", async () => {
    const models = await client.listModels({ cwd: ".", force: false });
    expect(models.length).toBeGreaterThan(0);
  });

  it("listModels returns models with correct provider", async () => {
    const models = await client.listModels({ cwd: ".", force: false });
    for (const model of models) {
      expect(model.provider).toBe(OCC_PROVIDER_ID);
    }
  });

  it("listModels has exactly one default model", async () => {
    const models = await client.listModels({ cwd: ".", force: false });
    const defaults = models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
  });

  describe("createSession", () => {
    it("creates a session with correct provider", async () => {
      const mockProc = createMockProcess();
      const c = new OccAgentClient({
        logger,
        _spawnForTest: () => mockProc,
      });

      const session = await c.createSession({
        provider: OCC_PROVIDER_ID,
        cwd: "/test/project",
      });

      expect(session.provider).toBe(OCC_PROVIDER_ID);
    });

    it("passes model to spawn args when specified", async () => {
      let capturedArgs: string[] = [];
      const mockProc = createMockProcess();
      const c = new OccAgentClient({
        logger,
        _spawnForTest: (_cmd, args) => {
          capturedArgs = args ?? [];
          return mockProc;
        },
      });

      await c.createSession({
        provider: OCC_PROVIDER_ID,
        cwd: "/test/project",
        model: "claude-sonnet-4-20250514",
      });

      expect(capturedArgs).toContain("--model");
      expect(capturedArgs).toContain("claude-sonnet-4-20250514");
    });

    it("includes --output-format stream-json in spawn args", async () => {
      let capturedArgs: string[] = [];
      const mockProc = createMockProcess();
      const c = new OccAgentClient({
        logger,
        _spawnForTest: (_cmd, args) => {
          capturedArgs = args ?? [];
          return mockProc;
        },
      });

      await c.createSession({
        provider: OCC_PROVIDER_ID,
        cwd: "/test/project",
      });

      expect(capturedArgs).toContain("--output-format");
      expect(capturedArgs).toContain("stream-json");
    });
  });

  describe("resumeSession", () => {
    it("passes --resume flag with session id", async () => {
      let capturedArgs: string[] = [];
      const mockProc = createMockProcess();
      const c = new OccAgentClient({
        logger,
        _spawnForTest: (_cmd, args) => {
          capturedArgs = args ?? [];
          return mockProc;
        },
      });

      await c.resumeSession({
        provider: OCC_PROVIDER_ID,
        sessionId: "existing-session-42",
      });

      expect(capturedArgs).toContain("--resume");
      expect(capturedArgs).toContain("existing-session-42");
    });
  });

  describe("environment variable forwarding", () => {
    it("forwards OPENAI_API_BASE as ANTHROPIC_BASE_URL", async () => {
      let capturedEnv: Record<string, string> = {};
      const mockProc = createMockProcess();
      const c = new OccAgentClient({
        logger,
        _spawnForTest: (_cmd, _args, opts) => {
          capturedEnv = ((opts as Record<string, unknown>)?.env as Record<string, string>) ?? {};
          return mockProc;
        },
        env: { OPENAI_API_BASE: "https://proxy.example.com/v1" },
      });

      await c.createSession({
        provider: OCC_PROVIDER_ID,
        cwd: "/test/project",
      });

      expect(capturedEnv.ANTHROPIC_BASE_URL).toBe("https://proxy.example.com");
    });
  });
});

describe("OccAgentSession", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it("emits timeline events when stdout receives JSON lines", async () => {
    const mockProc = createMockProcess();
    const client = new OccAgentClient({
      logger,
      _spawnForTest: () => mockProc,
    });

    const session = await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    mockProc.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "stream_event", text: "Hello" }) + "\n"),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(events.some((e) => e.type === "timeline")).toBe(true);
  });

  it("emits error timeline on stderr", async () => {
    const mockProc = createMockProcess();
    const client = new OccAgentClient({
      logger,
      _spawnForTest: () => mockProc,
    });

    const session = await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    mockProc.stderr!.emit("data", Buffer.from("Fatal error occurred\n"));

    await new Promise((r) => setTimeout(r, 10));

    const hasError = events.some(
      (e) => e.type === "timeline" && "item" in e && e.item.type === "error",
    );
    expect(hasError).toBe(true);
  });

  it("interrupt kills the spawned process", async () => {
    const mockProc = createMockProcess();
    const client = new OccAgentClient({
      logger,
      _spawnForTest: () => mockProc,
    });

    const session = await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
    });

    await session.interrupt();

    expect(mockProc.kill).toHaveBeenCalled();
  });

  it("close kills the process and cleans up", async () => {
    const mockProc = createMockProcess();
    const client = new OccAgentClient({
      logger,
      _spawnForTest: () => mockProc,
    });

    const session = await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
    });

    await session.close();

    expect(mockProc.kill).toHaveBeenCalled();
  });

  it("getRuntimeInfo returns provider and model", async () => {
    const mockProc = createMockProcess();
    const client = new OccAgentClient({
      logger,
      _spawnForTest: () => mockProc,
    });

    const session = await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
      model: "claude-sonnet-4-20250514",
    });

    const info = await session.getRuntimeInfo();
    expect(info.provider).toBe(OCC_PROVIDER_ID);
    expect(info.model).toBe("claude-sonnet-4-20250514");
  });

  it("startTurn spawns a new process for each turn", async () => {
    const mockProc1 = createMockProcess();
    const mockProc2 = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);
    const client = new OccAgentClient({
      logger,
      _spawnForTest: mockSpawn,
    });

    const session = await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);

    await session.startTurn("Second turn");
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const secondCallArgs = mockSpawn.mock.calls[1][1] as string[];
    expect(secondCallArgs).toContain("-p");
    expect(secondCallArgs).toContain("Second turn");
    expect(secondCallArgs).toContain("--output-format");
  });

  it("run resolves when process exits cleanly", async () => {
    const mockProc1 = createMockProcess();
    const mockProc2 = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);
    const client = new OccAgentClient({
      logger,
      _spawnForTest: mockSpawn,
    });

    const session = await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
    });

    const runPromise = session.run("test prompt");
    await new Promise((r) => setTimeout(r, 10));
    mockProc2.emit("close", 0);

    const result = await runPromise;
    expect(result.sessionId).toBeTruthy();
  });

  it("run resolves with turn_failed on non-zero exit", async () => {
    const mockProc1 = createMockProcess();
    const mockProc2 = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);
    const client = new OccAgentClient({
      logger,
      _spawnForTest: mockSpawn,
    });

    const session = await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    const runPromise = session.run("test prompt");
    await new Promise((r) => setTimeout(r, 10));
    mockProc2.emit("close", 1);

    await runPromise;
    expect(events.some((e) => e.type === "turn_failed")).toBe(true);
  });
});

describe("OccAgentClient uses spawnProcess by default", () => {
  it("calls spawnProcess from utils when no _spawnForTest provided", async () => {
    const mockProc = createMockProcess();
    const spy = vi
      .spyOn(spawnUtils, "spawnProcess")
      .mockReturnValue(mockProc as unknown as ChildProcess);

    const client = new OccAgentClient({ logger: createMockLogger() });
    await client.createSession({
      provider: OCC_PROVIDER_ID,
      cwd: "/test",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("occ");
    spy.mockRestore();
  });

  it("uses spawnProcess for isAvailable check", async () => {
    const mockProc = createMockProcess();
    const spy = vi
      .spyOn(spawnUtils, "spawnProcess")
      .mockReturnValue(mockProc as unknown as ChildProcess);

    const client = new OccAgentClient({ logger: createMockLogger() });
    const availablePromise = client.isAvailable();
    mockProc.emit("close", 0);
    await availablePromise;

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
