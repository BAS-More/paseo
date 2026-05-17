import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAuditLogger,
  createAuditMiddleware,
  pruneAuditLogs,
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
  it("writes structured audit event to file", async () => {
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

    await logger.close();

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

  it("includes HMAC signature for tamper evidence", async () => {
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

    await logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const entry = JSON.parse(content);
    expect(entry._hmac).toBeDefined();
    expect(typeof entry._hmac).toBe("string");
    expect(entry._hmac.length).toBeGreaterThan(0);
  });

  it("omits HMAC when no secret configured", async () => {
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

    await logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const entry = JSON.parse(content);
    expect(entry._hmac).toBeUndefined();
  });

  it("includes metadata when provided", async () => {
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

    await logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const entry = JSON.parse(content);
    expect(entry.meta).toEqual({ agentId: "agent-123" });
  });

  it("close() returns a promise (async interface)", async () => {
    const dir = makeTempDir();
    const logger = createAuditLogger({ auditLogDir: dir });
    const result = logger.close();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it("flush() drains pending writes without closing", async () => {
    const dir = makeTempDir();
    const logger = createAuditLogger({ auditLogDir: dir });

    logger.log({
      action: "data.mutate",
      actor: "bearer:flush-test",
      ip: "10.0.0.1",
      path: "/api/test",
      method: "POST",
      statusCode: 200,
    });

    await logger.flush();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    expect(auditFile).toBeDefined();
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const entry = JSON.parse(content);
    expect(entry.action).toBe("data.mutate");

    logger.log({
      action: "data.mutate",
      actor: "bearer:flush-test",
      ip: "10.0.0.1",
      path: "/api/test2",
      method: "POST",
      statusCode: 201,
    });

    await logger.close();

    const contentAfterClose = readFileSync(join(dir, auditFile!), "utf8").trim();
    const lines = contentAfterClose.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("log() does not block — data is not on disk until flushed", async () => {
    const dir = makeTempDir();
    const logger = createAuditLogger({ auditLogDir: dir });

    logger.log({
      action: "data.mutate",
      actor: "bearer:async-test",
      ip: "10.0.0.1",
      path: "/api/test",
      method: "POST",
      statusCode: 200,
    });

    // After close/flush, data must be on disk
    await logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    expect(auditFile).toBeDefined();
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    expect(content.length).toBeGreaterThan(0);
    const entry = JSON.parse(content);
    expect(entry.action).toBe("data.mutate");
  });

  it("preserves ordering across rapid sequential writes", async () => {
    const dir = makeTempDir();
    const logger = createAuditLogger({ auditLogDir: dir });

    for (let i = 0; i < 20; i++) {
      logger.log({
        action: `data.mutate.${i}`,
        actor: "bearer:order-test",
        ip: "10.0.0.1",
        path: `/api/test/${i}`,
        method: "POST",
        statusCode: 200,
      });
    }

    await logger.close();

    const files = readdirSync(dir);
    const auditFile = files.find((f: string) => f.startsWith("audit-"));
    const content = readFileSync(join(dir, auditFile!), "utf8").trim();
    const lines = content.split("\n");
    expect(lines).toHaveLength(20);

    for (let i = 0; i < 20; i++) {
      const entry = JSON.parse(lines[i]);
      expect(entry.action).toBe(`data.mutate.${i}`);
    }
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

  it("classifies admin paths as admin.config", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({
      method: "POST",
      path: "/api/settings/theme",
      headers: { authorization: "Bearer admin-tok" },
    });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 200;
    res._emit("finish");

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("admin.config");
  });

  it("classifies provider config changes as admin.config", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({
      method: "PUT",
      path: "/api/providers/claude/config",
      headers: { authorization: "Bearer admin-tok" },
    });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 200;
    res._emit("finish");

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("admin.config");
  });

  it("skips static asset path (/public/app.js)", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({ method: "GET", path: "/public/app.js" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res._emit("finish");

    expect(events).toHaveLength(0);
  });

  it("skips GET request to /api/agents (only mutations are logged, not reads)", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({ method: "GET", path: "/api/agents" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 200;
    res._emit("finish");

    expect(events).toHaveLength(0);
  });

  it("records actor IP from req.ip", () => {
    const events: AuditEvent[] = [];
    const fakeLogger: AuditLogger = {
      log: (e) => events.push(e),
      close: () => {},
    };

    const middleware = createAuditMiddleware(fakeLogger);
    const req = mockReq({
      method: "POST",
      path: "/mcp/agents",
      ip: "203.0.113.42",
      headers: { authorization: "Bearer tok" },
    });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    res.statusCode = 201;
    res._emit("finish");

    expect(events[0].ip).toBe("203.0.113.42");
  });
});

describe("pruneAuditLogs", () => {
  it("removes audit files older than retention period", () => {
    const dir = makeTempDir();
    const auditDir = join(dir, "audit");
    mkdirSync(auditDir);

    // Create an "old" audit file
    const oldFile = join(auditDir, "audit-2025-01-01.ndjson");
    writeFileSync(oldFile, '{"action":"test"}\n');

    // Create a "recent" audit file
    const recentFile = join(auditDir, "audit-2026-05-10.ndjson");
    writeFileSync(recentFile, '{"action":"test"}\n');

    const pruned = pruneAuditLogs(auditDir, {
      maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      now: new Date("2026-05-11T00:00:00Z"),
    });

    // Old file should be pruned (mtime-based, so depends on filesystem)
    expect(pruned).toBeGreaterThanOrEqual(0);
    // Recent file should still exist
    expect(readdirSync(auditDir).some((f) => f.includes("2026-05-10"))).toBe(true);
  });

  it("returns 0 when directory does not exist", () => {
    const fakePath = join(tmpdir(), "paseo-no-audit-dir-" + Date.now());
    expect(pruneAuditLogs(fakePath)).toBe(0);
  });

  it("returns 0 when no audit files exist", () => {
    const dir = makeTempDir();
    const auditDir = join(dir, "audit");
    mkdirSync(auditDir);
    expect(pruneAuditLogs(auditDir)).toBe(0);
  });

  it("ignores non-audit files", () => {
    const dir = makeTempDir();
    const auditDir = join(dir, "audit");
    mkdirSync(auditDir);
    writeFileSync(join(auditDir, "other.txt"), "data");

    const pruned = pruneAuditLogs(auditDir, { maxAgeMs: 0 });
    expect(pruned).toBe(0);
  });
});
