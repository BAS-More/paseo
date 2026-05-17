import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  createHealthState,
  createLivenessHandler,
  createReadinessHandler,
  createStartupHandler,
  type DependencyCheck,
} from "./health-probes.js";

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const fakeReq = {} as Request;

describe("health probes", () => {
  describe("createHealthState", () => {
    it("starts with both flags false", () => {
      const state = createHealthState();
      expect(state.bootstrapped).toBe(false);
      expect(state.listening).toBe(false);
    });
  });

  describe("/health/live", () => {
    it("returns 200 always", () => {
      const res = mockRes();
      createLivenessHandler()(fakeReq, res, vi.fn());
      expect(res.json).toHaveBeenCalledWith({ status: "ok" });
    });
  });

  describe("/health/ready", () => {
    it("returns 503 before bootstrap", () => {
      const state = createHealthState();
      const res = mockRes();
      createReadinessHandler(state)(fakeReq, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        status: "unavailable",
        bootstrapped: false,
        listening: false,
      });
    });

    it("returns 503 if bootstrapped but not listening", () => {
      const state = createHealthState();
      state.bootstrapped = true;
      const res = mockRes();
      createReadinessHandler(state)(fakeReq, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ bootstrapped: true, listening: false }),
      );
    });

    it("returns 200 when bootstrapped and listening", () => {
      const state = createHealthState();
      state.bootstrapped = true;
      state.listening = true;
      const res = mockRes();
      createReadinessHandler(state)(fakeReq, res, vi.fn());
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ status: "ok" });
    });
  });

  describe("/health/startup", () => {
    it("returns 503 before bootstrap", () => {
      const state = createHealthState();
      const res = mockRes();
      createStartupHandler(state)(fakeReq, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ status: "starting" });
    });

    it("returns 200 after bootstrap", () => {
      const state = createHealthState();
      state.bootstrapped = true;
      const res = mockRes();
      createStartupHandler(state)(fakeReq, res, vi.fn());
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ status: "ok" });
    });
  });
});

describe("/health/ready dependency checks", () => {
  function readyState() {
    const state = createHealthState();
    state.bootstrapped = true;
    state.listening = true;
    return state;
  }

  it("returns 200 when all dependency checks pass", async () => {
    const state = readyState();
    const checks: DependencyCheck[] = [
      () => Promise.resolve({ name: "storage", ok: true }),
      () => Promise.resolve({ name: "home-writable", ok: true }),
    ];
    const res = mockRes();
    await createReadinessHandler(state, { dependencyChecks: checks })(fakeReq, res, vi.fn());
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: "ok" });
  });

  it("returns 503 when any dependency check fails", async () => {
    const state = readyState();
    const checks: DependencyCheck[] = [
      () => Promise.resolve({ name: "storage", ok: true }),
      () => Promise.resolve({ name: "home-writable", ok: false, error: "EACCES" }),
    ];
    const res = mockRes();
    await createReadinessHandler(state, { dependencyChecks: checks })(fakeReq, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unavailable",
        failedChecks: expect.arrayContaining([
          expect.objectContaining({ name: "home-writable", ok: false }),
        ]),
      }),
    );
  });

  it("returns 503 listing all failed checks when multiple fail", async () => {
    const state = readyState();
    const checks: DependencyCheck[] = [
      () => Promise.resolve({ name: "storage", ok: false, error: "ENOENT" }),
      () => Promise.resolve({ name: "home-writable", ok: false, error: "EACCES" }),
    ];
    const res = mockRes();
    await createReadinessHandler(state, { dependencyChecks: checks })(fakeReq, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      failedChecks: unknown[];
    };
    expect(jsonArg.failedChecks).toHaveLength(2);
  });

  it("returns 503 before bootstrap even with passing checks", async () => {
    const state = createHealthState(); // not bootstrapped, not listening
    const checks: DependencyCheck[] = [() => Promise.resolve({ name: "storage", ok: true })];
    const res = mockRes();
    await createReadinessHandler(state, { dependencyChecks: checks })(fakeReq, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("works without dependency checks option (backwards compatible)", async () => {
    const state = readyState();
    const res = mockRes();
    // createReadinessHandler with no second argument — existing behaviour unchanged
    await createReadinessHandler(state)(fakeReq, res, vi.fn());
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: "ok" });
  });

  it("passes check error message into the response", async () => {
    const state = readyState();
    const checks: DependencyCheck[] = [
      () => Promise.resolve({ name: "home-writable", ok: false, error: "Permission denied" }),
    ];
    const res = mockRes();
    await createReadinessHandler(state, { dependencyChecks: checks })(fakeReq, res, vi.fn());
    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      failedChecks: Array<{ error?: string }>;
    };
    expect(jsonArg.failedChecks[0].error).toBe("Permission denied");
  });
});
