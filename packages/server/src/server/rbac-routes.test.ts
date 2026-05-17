import express from "express";
import { describe, expect, it, beforeEach } from "vitest";

import { createRbacMiddleware, requirePermission } from "./rbac.js";

/**
 * H-06: lightweight integration test for the requirePermission middleware,
 * mounted the same way bootstrap.ts wires it: RBAC middleware first
 * (attaches req.paseoRole), then a route-level requirePermission gate.
 *
 * The full daemon route table is too big to boot here — this test verifies
 * the contract: a viewer hitting a write route gets 403, an admin gets 200.
 */
describe("requirePermission gate (H-06)", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    // Mimic the auth attach: pass a custom resolveRole via createRbacMiddleware
    // by injecting plain-text "hashes".
    app.use((req, _res, next) => {
      // Stand-in for the bearer-auth middleware that normally precedes RBAC.
      const auth = req.header("authorization") ?? "";
      if (auth.startsWith("Bearer ")) {
        (req.headers as Record<string, string>).authorization = auth;
      }
      next();
    });
    app.use(
      createRbacMiddleware(
        { admin: "admin-pw", operator: "operator-pw", viewer: "viewer-pw" },
        // The standard compareSync isn't reachable in tests without real hashes;
        // patch resolveRole to use our fake compare via createRbacMiddleware
        // — but the public API doesn't take a compareFn for the middleware. So
        // we synthesise req.paseoRole directly below for the test.
      ),
    );
    // Bypass the bcrypt compare — set role from a header for test simplicity.
    app.use((req, _res, next) => {
      const roleHeader = req.header("x-test-role");
      if (roleHeader) {
        (req as unknown as Record<string, unknown>).paseoRole = roleHeader;
      }
      next();
    });

    app.post("/api/config/foo", requirePermission("config:write"), (_req, res) => {
      res.json({ ok: true });
    });
    app.delete("/api/agents/:id", requirePermission("agent:delete"), (_req, res) => {
      res.json({ ok: true });
    });
    app.get("/api/data", requirePermission("data:read"), (_req, res) => {
      res.json({ ok: true });
    });
  });

  async function request(
    path: string,
    method: "GET" | "POST" | "DELETE",
    role?: string,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          server.close();
          reject(new Error("no address"));
          return;
        }
        const headers: Record<string, string> = {};
        if (role) headers["x-test-role"] = role;
        fetch(`http://127.0.0.1:${addr.port}${path}`, { method, headers })
          .then((response) => {
            server.close();
            resolve(response.status);
            return undefined;
          })
          .catch((err: unknown) => {
            server.close();
            reject(err instanceof Error ? err : new Error(String(err)));
          });
      });
    });
  }

  it("viewer is denied config:write with 403", async () => {
    expect(await request("/api/config/foo", "POST", "viewer")).toBe(403);
  });

  it("operator is denied config:write with 403", async () => {
    expect(await request("/api/config/foo", "POST", "operator")).toBe(403);
  });

  it("admin can hit config:write", async () => {
    expect(await request("/api/config/foo", "POST", "admin")).toBe(200);
  });

  it("viewer is denied agent:delete with 403", async () => {
    expect(await request("/api/agents/abc", "DELETE", "viewer")).toBe(403);
  });

  it("operator is denied agent:delete with 403", async () => {
    expect(await request("/api/agents/abc", "DELETE", "operator")).toBe(403);
  });

  it("admin can hit agent:delete", async () => {
    expect(await request("/api/agents/abc", "DELETE", "admin")).toBe(200);
  });

  it("viewer can hit data:read", async () => {
    expect(await request("/api/data", "GET", "viewer")).toBe(200);
  });

  it("no role attached returns 403", async () => {
    expect(await request("/api/data", "GET")).toBe(403);
  });
});
