import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import {
  createHealthState,
  createLivenessHandler,
  createReadinessHandler,
  createStartupHandler,
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
