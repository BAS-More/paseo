import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CrewAiBridgeManager } from "./crewai-bridge-manager.js";

function createMockProcess() {
  const proc = {
    pid: 12345,
    killed: false,
    exitCode: null as number | null,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
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
});
