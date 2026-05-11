import { beforeEach, describe, expect, it, vi } from "vitest";

import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";

function makeBreaker(opts?: Partial<CircuitBreakerOptions>): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    halfOpenMaxAttempts: 1,
    ...opts,
  });
}

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("starts in the closed state", () => {
    const cb = makeBreaker();
    expect(cb.state).toBe("closed");
  });

  it("allows execution when closed", () => {
    const cb = makeBreaker();
    expect(cb.canExecute()).toBe(true);
  });

  it("stays closed after failures below the threshold", () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("opens after reaching the failure threshold", () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");
  });

  it("rejects execution when open", () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");
    expect(cb.canExecute()).toBe(false);
  });

  it("transitions to half-open after the reset timeout elapses", () => {
    const cb = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(5000);
    expect(cb.state).toBe("half-open");
  });

  it("does not transition to half-open before the timeout", () => {
    const cb = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(4999);
    expect(cb.state).toBe("open");
  });

  it("allows a single execution attempt in half-open", () => {
    const cb = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, halfOpenMaxAttempts: 1 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");
    expect(cb.canExecute()).toBe(true);
  });

  it("blocks further attempts in half-open once the quota is exhausted", () => {
    const cb = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, halfOpenMaxAttempts: 1 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(1000);

    // First call should be allowed
    expect(cb.canExecute()).toBe(true);
    // Subsequent call without outcome recorded — blocked
    expect(cb.canExecute()).toBe(false);
  });

  it("closes on success in half-open state", () => {
    const cb = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, halfOpenMaxAttempts: 1 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    cb.recordSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("re-opens on failure in half-open state", () => {
    const cb = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, halfOpenMaxAttempts: 1 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    cb.recordFailure();
    expect(cb.state).toBe("open");
    expect(cb.canExecute()).toBe(false);
  });

  it("resets failure counter on success", () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess(); // resets counter
    cb.recordFailure();
    cb.recordFailure();
    // Only 2 consecutive failures after the success — should still be closed
    expect(cb.state).toBe("closed");
  });

  it("reset() returns the breaker to closed with zero failures", () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");

    cb.reset();
    expect(cb.state).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("reset() in half-open clears state and returns closed", () => {
    const cb = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    cb.reset();
    expect(cb.state).toBe("closed");
  });

  it("uses default options when none are supplied", () => {
    const cb = new CircuitBreaker();
    // Default failureThreshold is 5
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("open");
  });
});

describe("CircuitBreaker.execute", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("calls fn and returns its result when closed", async () => {
    const cb = makeBreaker();
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await cb.execute(fn, "fallback");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
    expect(cb.state).toBe("closed");
  });

  it("records success when fn resolves", async () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    cb.recordFailure(); // 1 failure so far
    await cb.execute(() => Promise.resolve(1), 0);
    cb.recordFailure(); // count reset by success → 1 again, still closed
    expect(cb.state).toBe("closed");
  });

  it("records failure and returns fallback when fn throws", async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await cb.execute(fn, "fallback");
    expect(result).toBe("fallback");
    // 1 failure recorded; still closed
    expect(cb.state).toBe("closed");
  });

  it("opens after threshold consecutive fn rejections", async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await cb.execute(fn, "fb");
    await cb.execute(fn, "fb");
    await cb.execute(fn, "fb");
    expect(cb.state).toBe("open");
  });

  it("skips fn and returns fallback when open", async () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");
    const fn = vi.fn();
    const result = await cb.execute(fn, "fallback");
    expect(result).toBe("fallback");
    expect(fn).not.toHaveBeenCalled();
  });

  it("allows a probe call in half-open and closes on success", async () => {
    const cb = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(1000);
    const fn = vi.fn().mockResolvedValue("recovered");
    const result = await cb.execute(fn, "fallback");
    expect(result).toBe("recovered");
    expect(cb.state).toBe("closed");
  });
});
