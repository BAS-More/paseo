import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CircuitBreaker } from "./agent/circuit-breaker.js";
import { CrewAiBridgeManager } from "./crewai-bridge-manager.js";

function createMockProcess() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const proc = {
    pid: 12345,
    killed: false,
    exitCode: null as number | null,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] ??= [];
      listeners[event].push(cb);
      return proc;
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of listeners[event] ?? []) {
        cb(...args);
      }
    },
    kill: vi.fn(() => {
      proc.killed = true;
      return true;
    }),
  };
  return proc;
}

function createMockFetch(healthy = true) {
  return vi.fn(async (url: string) => {
    if (url.includes("/health")) {
      if (healthy) {
        return { ok: true, json: async () => ({ status: "ok" }) } as Response;
      }
      throw new Error("ECONNREFUSED");
    }
    return { ok: false } as Response;
  });
}

describe("CrewAiBridgeManager", () => {
  let manager: CrewAiBridgeManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("construction", () => {
    it("accepts a bridge script path", () => {
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: vi.fn(),
        _fetchForTest: createMockFetch(),
      });
      expect(manager).toBeDefined();
    });

    it("defaults port to 8000", () => {
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: vi.fn(),
        _fetchForTest: createMockFetch(),
      });
      expect(manager.getPort()).toBe(8000);
    });

    it("accepts custom port", () => {
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        port: 9000,
        _spawnForTest: vi.fn(),
        _fetchForTest: createMockFetch(),
      });
      expect(manager.getPort()).toBe(9000);
    });
  });

  describe("isRunning()", () => {
    it("returns false when not started", async () => {
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: vi.fn(),
        _fetchForTest: createMockFetch(false),
      });
      const running = await manager.isRunning();
      expect(running).toBe(false);
    });

    it("returns true when health check succeeds", async () => {
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: vi.fn(),
        _fetchForTest: createMockFetch(true),
      });
      const running = await manager.isRunning();
      expect(running).toBe(true);
    });
  });

  describe("start()", () => {
    it("spawns python process with correct args", async () => {
      const mockSpawn = vi.fn().mockReturnValue(createMockProcess());
      const mockFetch = createMockFetch(true);
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        pythonPath: "python3",
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
      });

      const startPromise = manager.start();
      await vi.advanceTimersByTimeAsync(500);
      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "python3",
        ["/path/to/api.py"],
        expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
      );
    });

    it("uses python as fallback if python3 not specified", async () => {
      const mockSpawn = vi.fn().mockReturnValue(createMockProcess());
      const mockFetch = createMockFetch(true);
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
      });

      const startPromise = manager.start();
      await vi.advanceTimersByTimeAsync(500);
      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith("python", expect.any(Array), expect.any(Object));
    });

    it("sets PORT env var in spawned process", async () => {
      const mockSpawn = vi.fn().mockReturnValue(createMockProcess());
      const mockFetch = createMockFetch(true);
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        port: 9001,
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
      });

      const startPromise = manager.start();
      await vi.advanceTimersByTimeAsync(500);
      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ PORT: "9001" }),
        }),
      );
    });

    it("does not spawn if already running", async () => {
      const mockSpawn = vi.fn().mockReturnValue(createMockProcess());
      const mockFetch = createMockFetch(true);
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
      });

      const p1 = manager.start();
      await vi.advanceTimersByTimeAsync(500);
      await p1;

      // Already healthy — second start should skip spawn
      await manager.start();
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
  });

  describe("stop()", () => {
    it("kills the process", async () => {
      const proc = createMockProcess();
      const mockSpawn = vi.fn().mockReturnValue(proc);
      const mockFetch = createMockFetch(true);
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
      });

      const startPromise = manager.start();
      await vi.advanceTimersByTimeAsync(500);
      await startPromise;

      manager.stop();
      expect(proc.kill).toHaveBeenCalled();
    });

    it("does nothing if not started", () => {
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: vi.fn(),
        _fetchForTest: createMockFetch(false),
      });
      // Should not throw
      manager.stop();
    });
  });

  describe("getStatus()", () => {
    it("returns stopped when not started", () => {
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: vi.fn(),
        _fetchForTest: createMockFetch(false),
      });
      expect(manager.getStatus()).toBe("stopped");
    });

    it("returns running after successful start", async () => {
      const mockSpawn = vi.fn().mockReturnValue(createMockProcess());
      const mockFetch = createMockFetch(true);
      manager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
      });

      const startPromise = manager.start();
      await vi.advanceTimersByTimeAsync(500);
      await startPromise;

      expect(manager.getStatus()).toBe("running");
    });
  });

  describe("crash detection + auto-restart (H-11)", () => {
    it("increments restartCount and re-spawns when child exits unexpectedly", async () => {
      const proc1 = createMockProcess();
      const proc2 = createMockProcess();
      const mockSpawn = vi.fn().mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);
      const mockFetch = createMockFetch(true);
      const localManager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
        maxCrashRestarts: 3,
        crashWindowMs: 60_000,
      });

      const startPromise = localManager.start();
      await vi.advanceTimersByTimeAsync(500); // first health check succeeds
      await startPromise;

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(localManager.getStatus()).toBe("running");

      // Crash the child
      proc1.emit("exit", 1, null);
      expect(localManager.getRestartCount()).toBe(1);

      // First backoff = 1000ms — drain it then let start() complete.
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(500);

      expect(mockSpawn).toHaveBeenCalledTimes(2);

      localManager.stop();
    });

    it("gives up after exceeding maxCrashRestarts and reports error status", async () => {
      const procs = [
        createMockProcess(),
        createMockProcess(),
        createMockProcess(),
        createMockProcess(),
        createMockProcess(),
      ];
      const mockSpawn = vi.fn();
      for (const p of procs) {
        mockSpawn.mockReturnValueOnce(p);
      }
      // Health probe never succeeds — drives "starting" state forever.
      const mockFetch = createMockFetch(false);

      const localManager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
        maxCrashRestarts: 2,
        crashWindowMs: 60_000,
      });

      // Don't await start — it'll loop on health check.
      void localManager.start();
      // First spawn happens synchronously.
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // Crash 3 times — exceeds maxCrashRestarts (2).
      procs[0].emit("exit", 1, null);
      await vi.advanceTimersByTimeAsync(1100); // backoff #1 = 1s
      procs[1].emit("exit", 1, null);
      await vi.advanceTimersByTimeAsync(2100); // backoff #2 = 2s
      procs[2].emit("exit", 1, null);

      expect(localManager.getStatus()).toBe("error");
      expect(localManager.getRestartCount()).toBe(3);
      localManager.stop();
    });

    it("does NOT auto-restart after stop()", async () => {
      const proc = createMockProcess();
      const mockSpawn = vi.fn().mockReturnValue(proc);
      const mockFetch = createMockFetch(true);
      const localManager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: mockSpawn,
        _fetchForTest: mockFetch,
      });

      const startPromise = localManager.start();
      await vi.advanceTimersByTimeAsync(500);
      await startPromise;

      localManager.stop();
      // Crash AFTER stop — must NOT trigger a respawn.
      proc.emit("exit", 1, null);
      await vi.advanceTimersByTimeAsync(2000);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(localManager.getRestartCount()).toBe(0);
    });
  });

  describe("circuit breaker (C-01)", () => {
    it("opens after 5 consecutive isRunning failures and skips fetch", async () => {
      vi.useRealTimers();
      const fetchFn = createMockFetch(false);
      const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
      const localManager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: vi.fn(),
        _fetchForTest: fetchFn,
        _breakerForTest: breaker,
      });

      for (let i = 0; i < 5; i++) {
        await localManager.isRunning();
      }
      expect(localManager.getBreakerState()).toBe("open");
      expect(fetchFn).toHaveBeenCalledTimes(5);

      const result = await localManager.isRunning();
      expect(result).toBe(false);
      expect(fetchFn).toHaveBeenCalledTimes(5);
      vi.useFakeTimers();
    });

    it("auto-resets to half-open after cooldown elapses", async () => {
      const fetchFn = createMockFetch(false);
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
      const localManager = new CrewAiBridgeManager({
        bridgePath: "/path/to/api.py",
        _spawnForTest: vi.fn(),
        _fetchForTest: fetchFn,
        _breakerForTest: breaker,
      });

      await localManager.isRunning();
      await localManager.isRunning();
      expect(localManager.getBreakerState()).toBe("open");

      vi.advanceTimersByTime(1000);
      expect(localManager.getBreakerState()).toBe("half-open");
    });
  });
});
