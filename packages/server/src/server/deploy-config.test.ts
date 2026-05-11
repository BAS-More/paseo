import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..", "..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Caddyfile.deploy (C-02)", () => {
  const caddyfile = read("Caddyfile.deploy");

  it("binds admin API to localhost only", () => {
    expect(caddyfile).toMatch(/admin\s+localhost:2019/);
  });

  it("does NOT bind admin API to all interfaces", () => {
    // Reject the unsafe `admin :2019` form (no host = all interfaces).
    expect(caddyfile).not.toMatch(/^\s*admin\s+:2019/m);
  });
});

describe("docker-compose.deploy.yml (C-02 + H-07)", () => {
  const compose = read("docker-compose.deploy.yml");

  it("does NOT publish Caddy admin port 2019 to the host", () => {
    expect(compose).not.toMatch(/^\s*-\s*"2019:2019"/m);
    expect(compose).not.toMatch(/^\s*-\s*"127\.0\.0\.1:2019:2019"/m);
  });

  it("binds all Caddy-published ports to 127.0.0.1", () => {
    // Every published port for Caddy must include the loopback prefix.
    const lines = compose.split(/\r?\n/);
    let inCaddyPorts = false;
    let caddyServiceSeen = false;
    let foundAtLeastOnePort = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^\s{2}caddy:/.test(line)) {
        caddyServiceSeen = true;
      }
      if (caddyServiceSeen && /^\s{4}ports:/.test(line)) {
        inCaddyPorts = true;
        continue;
      }
      if (inCaddyPorts) {
        // Exit on next service-level key or end of caddy block
        if (/^\s{4}\w/.test(line) && !/^\s{6}-/.test(line)) {
          inCaddyPorts = false;
          continue;
        }
        const portMatch = line.match(/^\s{6}-\s*"([^"]+)"/);
        if (portMatch) {
          foundAtLeastOnePort = true;
          expect(portMatch[1]).toMatch(/^127\.0\.0\.1:/);
        }
      }
    }
    expect(caddyServiceSeen).toBe(true);
    expect(foundAtLeastOnePort).toBe(true);
  });
});
