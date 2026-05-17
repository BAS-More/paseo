import { describe, it, expect, vi } from "vitest";
import { createCacheHeadersMiddleware } from "./cache-headers.js";

function mockReq(path: string) {
  return { path };
}

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    getHeaders() {
      return headers;
    },
  };
}

describe("createCacheHeadersMiddleware", () => {
  it("sets immutable cache for hashed assets", () => {
    const middleware = createCacheHeadersMiddleware();
    const req = mockReq("/public/assets/app-abc123.js");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(res.getHeaders()["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(next).toHaveBeenCalled();
  });

  it("sets no-cache for HTML files", () => {
    const middleware = createCacheHeadersMiddleware();
    const req = mockReq("/public/index.html");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(res.getHeaders()["Cache-Control"]).toBe("no-cache, no-store, must-revalidate");
    expect(next).toHaveBeenCalled();
  });

  it("sets short cache for API responses", () => {
    const middleware = createCacheHeadersMiddleware();
    const req = mockReq("/api/status");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(res.getHeaders()["Cache-Control"]).toBe("no-store");
    expect(next).toHaveBeenCalled();
  });

  it("sets immutable for font files", () => {
    const middleware = createCacheHeadersMiddleware();
    const req = mockReq("/public/fonts/inter.woff2");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(res.getHeaders()["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(next).toHaveBeenCalled();
  });

  it("sets immutable for image files", () => {
    const middleware = createCacheHeadersMiddleware();
    const req = mockReq("/public/images/logo.png");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(res.getHeaders()["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(next).toHaveBeenCalled();
  });

  it("skips non-public, non-API paths", () => {
    const middleware = createCacheHeadersMiddleware();
    const req = mockReq("/health/live");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(res.getHeaders()["Cache-Control"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
