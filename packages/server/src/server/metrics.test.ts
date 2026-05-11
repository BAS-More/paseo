import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * NOTE: prom-client is NOT installed yet.
 * Run `npm i prom-client` in packages/server to enable real metrics.
 *
 * These tests mock prom-client via vi.mock so the module's logic
 * is exercised regardless of whether the package is on disk.
 */

// vi.hoisted runs before vi.mock hoisting, so refs are valid inside the factory.
const mocks = vi.hoisted(() => {
  const gaugeSet = vi.fn();
  const gaugeInc = vi.fn();
  const gaugeDec = vi.fn();
  const counterInc = vi.fn();
  const histogramObserve = vi.fn();
  const histogramStartTimer = vi.fn(() => histogramObserve);
  const registerMetrics = vi.fn(() => "# HELP mock metrics\n");
  const registerContentType = "text/plain; version=0.0.4; charset=utf-8";
  return {
    gaugeSet,
    gaugeInc,
    gaugeDec,
    counterInc,
    histogramObserve,
    histogramStartTimer,
    registerMetrics,
    registerContentType,
  };
});

vi.mock("prom-client", () => ({
  Gauge: vi.fn().mockImplementation(() => ({
    set: mocks.gaugeSet,
    inc: mocks.gaugeInc,
    dec: mocks.gaugeDec,
  })),
  Counter: vi.fn().mockImplementation(() => ({
    inc: mocks.counterInc,
  })),
  Histogram: vi.fn().mockImplementation(() => ({
    observe: mocks.histogramObserve,
    startTimer: mocks.histogramStartTimer,
  })),
  register: {
    metrics: mocks.registerMetrics,
    contentType: mocks.registerContentType,
  },
}));

import {
  createMetrics,
  createMetricsMiddleware,
  createMetricsHandler,
  ensureMetricsReady,
} from "./metrics.js";

function mockReq(overrides?: Partial<Request>): Request {
  return {
    method: "GET",
    path: "/api/health",
    ...overrides,
  } as Request;
}

function mockRes(): Response {
  const res = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    on: vi.fn(),
  } as unknown as Response;
  return res;
}

describe("ensureMetricsReady", () => {
  it("resolves to true when prom-client is available (mocked)", async () => {
    const ready = await ensureMetricsReady();
    expect(ready).toBe(true);
  });
});

describe("createMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an object with all expected metric handles", () => {
    const metrics = createMetrics();
    expect(metrics).toHaveProperty("wsConnectionsActive");
    expect(metrics).toHaveProperty("agentsActive");
    expect(metrics).toHaveProperty("httpRequestsTotal");
    expect(metrics).toHaveProperty("httpRequestDurationSeconds");
    expect(metrics).toHaveProperty("backupLastSuccessTimestamp");
    expect(metrics).toHaveProperty("agentErrorsTotal");
  });

  it("exposes gauge inc/dec on wsConnectionsActive", () => {
    const metrics = createMetrics();
    metrics.wsConnectionsActive.inc();
    expect(mocks.gaugeInc).toHaveBeenCalled();
    metrics.wsConnectionsActive.dec();
    expect(mocks.gaugeDec).toHaveBeenCalled();
  });

  it("exposes gauge set on agentsActive", () => {
    const metrics = createMetrics();
    metrics.agentsActive.set(5);
    expect(mocks.gaugeSet).toHaveBeenCalledWith(5);
  });

  it("exposes counter inc on httpRequestsTotal", () => {
    const metrics = createMetrics();
    metrics.httpRequestsTotal.inc({ method: "GET", path: "/api/health", status: "200" });
    expect(mocks.counterInc).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/health",
      status: "200",
    });
  });

  it("exposes histogram startTimer on httpRequestDurationSeconds", () => {
    const metrics = createMetrics();
    metrics.httpRequestDurationSeconds.startTimer();
    expect(mocks.histogramStartTimer).toHaveBeenCalled();
  });

  it("exposes gauge set on backupLastSuccessTimestamp", () => {
    const metrics = createMetrics();
    const now = Date.now() / 1000;
    metrics.backupLastSuccessTimestamp.set(now);
    expect(mocks.gaugeSet).toHaveBeenCalledWith(now);
  });

  it("exposes counter inc on agentErrorsTotal with provider label", () => {
    const metrics = createMetrics();
    metrics.agentErrorsTotal.inc({ provider: "claude" });
    expect(mocks.counterInc).toHaveBeenCalledWith({ provider: "claude" });
  });
});

describe("createMetricsMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() to continue the middleware chain", () => {
    const metrics = createMetrics();
    const middleware = createMetricsMiddleware(metrics);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("increments httpRequestsTotal on response finish", () => {
    const metrics = createMetrics();
    const middleware = createMetricsMiddleware(metrics);
    const req = mockReq({ method: "POST", path: "/api/sessions" });
    const res = mockRes();
    res.statusCode = 201;
    const next = vi.fn();

    middleware(req, res, next);

    const onCall = (res.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "finish",
    );
    expect(onCall).toBeDefined();
    const finishCallback = onCall![1] as () => void;
    finishCallback();

    expect(mocks.counterInc).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/sessions",
      status: "201",
    });
  });

  it("observes request duration on response finish via startTimer", () => {
    const metrics = createMetrics();
    const middleware = createMetricsMiddleware(metrics);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(mocks.histogramStartTimer).toHaveBeenCalled();

    const onCall = (res.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "finish",
    );
    const finishCallback = onCall![1] as () => void;
    finishCallback();

    expect(mocks.histogramObserve).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/health",
      status: "200",
    });
  });

  it("normalizes path to strip ID-like segments for cardinality control", () => {
    const metrics = createMetrics();
    const middleware = createMetricsMiddleware(metrics);
    const req = mockReq({ method: "GET", path: "/api/agents/abc-123-def/status" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    const onCall = (res.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "finish",
    );
    const finishCallback = onCall![1] as () => void;
    finishCallback();

    expect(mocks.counterInc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/agents/:id/status",
      }),
    );
  });
});

describe("createMetricsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a request handler function", () => {
    const handler = createMetricsHandler();
    expect(typeof handler).toBe("function");
  });

  it("sets content-type from prom-client register and returns metrics", async () => {
    await ensureMetricsReady();
    const handler = createMetricsHandler();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await handler(req, res, next);

    expect(res.set).toHaveBeenCalledWith("Content-Type", mocks.registerContentType);
    expect(res.end).toHaveBeenCalledWith("# HELP mock metrics\n");
  });

  it("returns 500 if register.metrics() throws", async () => {
    await ensureMetricsReady();
    mocks.registerMetrics.mockRejectedValueOnce(new Error("registry broken"));

    const handler = createMetricsHandler();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await handler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.end).toHaveBeenCalled();
  });
});
