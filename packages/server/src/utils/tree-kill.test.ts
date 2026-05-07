import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  treeKill: vi.fn(),
}));

vi.mock("tree-kill", () => ({
  default: mocks.treeKill,
}));

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.signalCode = typeof signal === "string" ? signal : "SIGTERM";
    this.emit("exit");
    return true;
  });
}

describe("terminateWithTreeKill", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.treeKill.mockReset();
  });

  test("preserves graceful-then-force shutdown timing", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    const onForceSignal = vi.fn();

    mocks.treeKill.mockImplementation(
      (_pid: number, signal: NodeJS.Signals, callback: (error?: Error) => void) => {
        callback();
        if (signal === "SIGKILL") {
          child.signalCode = "SIGKILL";
          child.emit("exit");
        }
      },
    );

    const { terminateWithTreeKill } = await import("./tree-kill.js");
    const resultPromise = terminateWithTreeKill(child, {
      gracefulTimeoutMs: 100,
      forceTimeoutMs: 100,
      onForceSignal,
    });

    expect(mocks.treeKill).toHaveBeenCalledWith(4242, "SIGTERM", expect.any(Function));
    expect(onForceSignal).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(onForceSignal).toHaveBeenCalledOnce();
    expect(mocks.treeKill).toHaveBeenCalledWith(4242, "SIGKILL", expect.any(Function));
    expect(result).toBe("killed");
  });

  test("falls back to direct child signaling if tree-kill cannot traverse", async () => {
    const child = new FakeChildProcess();
    mocks.treeKill.mockImplementation(
      (_pid: number, _signal: NodeJS.Signals, callback: (error?: Error) => void) => {
        callback(new Error("tree unavailable"));
      },
    );

    const { terminateWithTreeKill } = await import("./tree-kill.js");
    const result = await terminateWithTreeKill(child, {
      gracefulTimeoutMs: 100,
      forceTimeoutMs: 100,
    });

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result).toBe("terminated");
  });
});
