import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAuditLogger,
  createAuditMiddleware,
  type AuditEvent,
  type AuditLogger,
} from "./audit-log.js";

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "paseo-audit-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("createAuditLogger", () => {
  it("writes structured audit event to file", () => {
    const dir = makeTempDir();
    const logger = createAuditLogger({ auditLogDir: dir });

    logger.log({
      action: "auth.login",
      actor: "bearer:abc123",
      ip: "192.168.1.1",
      path: "/api/health",
      method: "GET",
      statusCode: 200,
    });

    logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    expect(auditFile).toBeDefined();

    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const entry = JSON.parse(content);
    expect(entry.action).toBe("auth.login");
    expect(entry.actor).toBe("bearer:abc123");
    expect(entry.ip).toBe("192.168.1.1");
    expect(entry.ts).toBeDefined();
  });

  it("includes HMAC signature for tamper evidence", () => {
    const dir = makeTempDir();
    const logger = createAuditLogger({
      auditLogDir: dir,
      hmacSecret: "test-secret-key",
    });

    logger.log({
      action: "data.create",
      actor: "bearer:xyz",
      ip: "10.0.0.1",
      path: "/mcp/agents",
      method: "POST",
      statusCode: 201,
    });

    logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const entry = JSON.parse(content);
    expect(entry._hmac).toBeDefined();
    expect(typeof entry._hmac).toBe("string");
    expect(entry._hmac.length).toBeGreaterThan(0);
  });

  it("omits HMAC when no secret configured", () => {
    const dir = makeTempDir();
    const logger = createAuditLogger({ auditLogDir: dir });

    logger.log({
      action: "auth.reject",
      actor: "anonymous",
      ip: "1.2.3.4",
      path: "/api/status",
      method: "GET",
      statusCode: 401,
    });

    logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const entry = JSON.parse(content);
    expect(entry._hmac).toBeUndefined();
  });

  it("includes metadata when provided", () => {
    const dir = makeTempDir();
    const logger = createAuditLogger({ auditLogDir: dir });

    logger.log({
      action: "data.delete",
      actor: "bearer:admin",
      ip: "10.0.0.5",
      path: "/mcp/agents/agent-123",
      method: "DELETE",
      statusCode: 200,
      meta: { agentId: "agent-123" },
    });

    logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const entry = JSON.parse(content);
    expect(entry.meta).toEqual({ agentId: "agent-123" });
  });
});

describe("createAuditMiddleware", () => {
  function mockReq(overrides: Record<string, unknown> = {}) {
    return {
      method: "GET",
      path: "/api/health",
      ip: "127.0.0.1",
      headers: {},
      ...overrides,
    };
  }

  function mockRes() {
    let _statusCode = 200;
    const listeners: Record<string, Array<() => void>> = {};
    return {
      get statusCode() {
        return _statusCode;
      },
      set statusCode(v: number) {
        _statusCode = v;
      },
      on(event: string, fn: () => void) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
        return this;
      },
      _emit(event: string) {
        for (const fn of listeners[event] ?? []) fn();
      },
    };
  }

  it("logs auth.reject on 401 responses", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({ method: "POST", path: "/api/status" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    expect(next).toHaveBeenCalled();

    res.statusCode = 401;
    res._emit("finish");

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("auth.reject");
    expect(events[0].statusCode).toBe(401);
  });

  it("logs data.mutate on POST/PUT/PATCH/DELETE to mutation paths", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({
      method: "POST",
      path: "/mcp/agents",
      headers: { authorization: "Bearer tok123" },
    });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 201;
    res._emit("finish");

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("data.mutate");
    expect(events[0].method).toBe("POST");
  });

  it("logs data.mutate on DELETE", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({
      method: "DELETE",
      path: "/mcp/agents/agent-42",
      headers: { authorization: "Bearer tok123" },
    });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 200;
    res._emit("finish");

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("data.mutate");
  });

  it("skips health endpoints", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({ path: "/health/live" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res._emit("finish");

    expect(events).toHaveLength(0);
  });

  it("skips GET requests to non-mutation paths", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({ method: "GET", path: "/api/status" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 200;
    res._emit("finish");

    expect(events).toHaveLength(0);
  });

  it("extracts actor from bearer token (hashed, not raw)", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({
      method: "POST",
      path: "/mcp/agents",
      headers: { authorization: "Bearer my-secret-token-value" },
    });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 201;
    res._emit("finish");

    expect(events[0].actor).toMatch(/^bearer:[a-f0-9]+$/);
    expect(events[0].actor).not.toContain("my-secret-token-value");
  });

  it("uses 'anonymous' actor when no auth header", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({ method: "POST", path: "/mcp/agents" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 401;
    res._emit("finish");

    expect(events[0].actor).toBe("anonymous");
  });
});
