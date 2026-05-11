import { describe, it, expect, vi } from "vitest";
import {
  type Role,
  ROLE_PERMISSIONS,
  hasPermission,
  requirePermission,
  resolveRole,
  resolveRoleAsync,
} from "./rbac.js";

describe("ROLE_PERMISSIONS", () => {
  it("admin has all permissions", () => {
    const adminPerms = ROLE_PERMISSIONS.admin;
    expect(adminPerms).toContain("agent:create");
    expect(adminPerms).toContain("agent:delete");
    expect(adminPerms).toContain("agent:read");
    expect(adminPerms).toContain("agent:run");
    expect(adminPerms).toContain("config:read");
    expect(adminPerms).toContain("config:write");
    expect(adminPerms).toContain("data:read");
    expect(adminPerms).toContain("data:write");
  });

  it("operator can run agents but not delete or change config", () => {
    const opPerms = ROLE_PERMISSIONS.operator;
    expect(opPerms).toContain("agent:run");
    expect(opPerms).toContain("agent:read");
    expect(opPerms).toContain("agent:create");
    expect(opPerms).toContain("data:read");
    expect(opPerms).toContain("data:write");
    expect(opPerms).not.toContain("agent:delete");
    expect(opPerms).not.toContain("config:write");
  });

  it("viewer can only read", () => {
    const viewPerms = ROLE_PERMISSIONS.viewer;
    expect(viewPerms).toContain("agent:read");
    expect(viewPerms).toContain("data:read");
    expect(viewPerms).toContain("config:read");
    expect(viewPerms).not.toContain("agent:create");
    expect(viewPerms).not.toContain("agent:delete");
    expect(viewPerms).not.toContain("agent:run");
    expect(viewPerms).not.toContain("data:write");
    expect(viewPerms).not.toContain("config:write");
  });
});

describe("hasPermission", () => {
  it("returns true when role has permission", () => {
    expect(hasPermission("admin", "config:write")).toBe(true);
    expect(hasPermission("operator", "agent:run")).toBe(true);
    expect(hasPermission("viewer", "data:read")).toBe(true);
  });

  it("returns false when role lacks permission", () => {
    expect(hasPermission("viewer", "agent:create")).toBe(false);
    expect(hasPermission("operator", "agent:delete")).toBe(false);
    expect(hasPermission("viewer", "config:write")).toBe(false);
  });
});

describe("resolveRole", () => {
  it("returns admin for token matching admin password", () => {
    const passwords = {
      admin: "$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01",
    };
    // Use sync compare — mock by providing a custom comparator
    const role = resolveRole("test-token", passwords, (token, hash) => {
      return token === "test-token" && hash === passwords.admin;
    });
    expect(role).toBe("admin");
  });

  it("returns operator for token matching operator password", () => {
    const passwords = {
      admin: "admin-hash",
      operator: "op-hash",
    };
    const role = resolveRole("op-token", passwords, (_token, hash) => {
      return hash === "op-hash";
    });
    expect(role).toBe("operator");
  });

  it("returns viewer for token matching viewer password", () => {
    const passwords = {
      admin: "admin-hash",
      operator: "op-hash",
      viewer: "viewer-hash",
    };
    const role = resolveRole("viewer-token", passwords, (_token, hash) => {
      return hash === "viewer-hash";
    });
    expect(role).toBe("viewer");
  });

  it("returns null when no password matches", () => {
    const passwords = { admin: "admin-hash" };
    const role = resolveRole("bad-token", passwords, () => false);
    expect(role).toBeNull();
  });

  it("returns admin when no role passwords configured (legacy mode)", () => {
    const role = resolveRole("any-token", {});
    expect(role).toBe("admin");
  });
});

describe("resolveRoleAsync (H-05)", () => {
  it("returns admin for token matching admin password", async () => {
    const passwords = { admin: "admin-hash" };
    const role = await resolveRoleAsync(
      "test",
      passwords,
      async (_, hash) => hash === "admin-hash",
    );
    expect(role).toBe("admin");
  });

  it("returns operator when only operator matches", async () => {
    const passwords = { admin: "admin-hash", operator: "op-hash" };
    const role = await resolveRoleAsync("test", passwords, async (_, hash) => hash === "op-hash");
    expect(role).toBe("operator");
  });

  it("returns null when no password matches", async () => {
    const role = await resolveRoleAsync("test", { admin: "h" }, async () => false);
    expect(role).toBeNull();
  });

  it("returns admin in legacy single-password mode", async () => {
    const role = await resolveRoleAsync("test", {});
    expect(role).toBe("admin");
  });

  it("returns a Promise (not a sync value)", () => {
    const result = resolveRoleAsync("test", { admin: "h" }, async () => false);
    expect(result).toBeInstanceOf(Promise);
  });

  it("awaits each compare before checking the next role", async () => {
    const order: string[] = [];
    await resolveRoleAsync(
      "test",
      { admin: "h1", operator: "h2", viewer: "h3" },
      async (_, hash) => {
        order.push(hash);
        return false;
      },
    );
    // Admin is checked first, then operator, then viewer (priority order).
    expect(order).toEqual(["h1", "h2", "h3"]);
  });
});

describe("requirePermission", () => {
  function mockReq(role?: Role) {
    const req: Record<string, unknown> = {
      method: "POST",
      path: "/mcp/agents",
    };
    if (role) {
      req.paseoRole = role;
    }
    return req;
  }

  function mockRes() {
    let _status = 200;
    let _body: unknown = null;
    return {
      status(code: number) {
        _status = code;
        return this;
      },
      json(body: unknown) {
        _body = body;
        return this;
      },
      get _status() {
        return _status;
      },
      get _body() {
        return _body;
      },
    };
  }

  it("calls next when role has permission", () => {
    const middleware = requirePermission("agent:create");
    const req = mockReq("admin");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 403 when role lacks permission", () => {
    const middleware = requirePermission("config:write");
    const req = mockReq("viewer");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("returns 403 when no role set on request", () => {
    const middleware = requirePermission("agent:create");
    const req = mockReq(); // no role
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("allows admin for any permission", () => {
    const middleware = requirePermission("config:write");
    const req = mockReq("admin");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    expect(next).toHaveBeenCalled();
  });
});
