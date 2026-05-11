import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// Mock @sentry/node before importing our module
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  isInitialized: vi.fn(() => false),
  captureException: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
}));

import * as Sentry from "@sentry/node";
import { initSentry, sentryErrorHandler, flushSentry } from "./sentry.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initSentry", () => {
  it("calls Sentry.init when DSN is provided", () => {
    initSentry({ dsn: "https://key@sentry.io/123", environment: "test", release: "1.0.0" });
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@sentry.io/123",
        environment: "test",
        release: "1.0.0",
      }),
    );
  });

  it("skips init when DSN is undefined", () => {
    initSentry({ dsn: undefined, environment: "test", release: "1.0.0" });
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("skips init when enabled is false", () => {
    initSentry({
      dsn: "https://key@sentry.io/123",
      environment: "test",
      release: "1.0.0",
      enabled: false,
    });
    expect(Sentry.init).not.toHaveBeenCalled();
  });
});

describe("sentryErrorHandler", () => {
  it("captures exception and returns 500", () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const handler = sentryErrorHandler();
    const err = new Error("test crash");
    const res = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn();

    handler(err, {} as Request, res, next);

    expect(Sentry.captureException).toHaveBeenCalledWith(err);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("delegates to next if headers already sent", () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const handler = sentryErrorHandler();
    const err = new Error("late error");
    const res = { headersSent: true } as unknown as Response;
    const next = vi.fn();

    handler(err, {} as Request, res, next);

    expect(Sentry.captureException).toHaveBeenCalledWith(err);
    expect(next).toHaveBeenCalledWith(err);
  });

  it("does not call captureException when sentry not initialized", () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    const handler = sentryErrorHandler();
    const err = new Error("no sentry");
    const res = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    handler(err, {} as Request, res, vi.fn());

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("flushSentry", () => {
  it("calls Sentry.flush when initialized", async () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    await flushSentry(1000);
    expect(Sentry.flush).toHaveBeenCalledWith(1000);
  });

  it("skips flush when not initialized", async () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    await flushSentry();
    expect(Sentry.flush).not.toHaveBeenCalled();
  });
});
