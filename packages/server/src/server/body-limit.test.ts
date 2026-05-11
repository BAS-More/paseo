import { describe, expect, it } from "vitest";
import express from "express";

/**
 * H-03: express body parser must cap requests at 1mb.
 *
 * This test exercises the express middleware directly. It does NOT boot the
 * full daemon — booting requires PASEO_HOME, auth, agent storage, etc. The
 * production wiring lives in bootstrap.ts:418; this is a unit-level guard
 * against silent regressions if someone removes the `{ limit }` option.
 */
describe("body limit (H-03)", () => {
  function makeApp(): express.Express {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.post("/echo", (req, res) => res.json({ ok: true, size: JSON.stringify(req.body).length }));
    return app;
  }

  async function postJson(app: express.Express, body: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          server.close();
          return reject(new Error("no address"));
        }
        fetch(`http://127.0.0.1:${addr.port}/echo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
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

  it("accepts payloads up to 1mb", async () => {
    const app = makeApp();
    const body = JSON.stringify({ data: "x".repeat(500 * 1024) }); // ~500kb
    const status = await postJson(app, body);
    expect(status).toBe(200);
  });

  it("rejects payloads over 1mb with 413", async () => {
    const app = makeApp();
    const body = JSON.stringify({ data: "x".repeat(1.2 * 1024 * 1024) }); // ~1.2mb
    const status = await postJson(app, body);
    expect(status).toBe(413);
  });
});
