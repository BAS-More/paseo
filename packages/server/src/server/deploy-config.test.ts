import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..", "..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("deploy/rollback scripts (H-09)", () => {
  it("deploy.sh installs a trap on EXIT/INT/TERM", () => {
    const script = read("scripts/deploy.sh");
    expect(script).toMatch(/^trap\s+cleanup\s+EXIT\s+INT\s+TERM/m);
    expect(script).toMatch(/cleanup\(\)\s*\{/);
  });

  it("rollback.sh installs a trap on EXIT/INT/TERM", () => {
    const script = read("scripts/rollback.sh");
    expect(script).toMatch(/^trap\s+cleanup\s+EXIT\s+INT\s+TERM/m);
    expect(script).toMatch(/cleanup\(\)\s*\{/);
  });
});

describe("deploy.sh records image digests (H-10)", () => {
  const deploy = read("scripts/deploy.sh");

  it("captures RepoDigests for OLD_IMAGES (not just Config.Image)", () => {
    expect(deploy).toMatch(/RepoDigests/);
    expect(deploy).toMatch(/OLD_IMAGES\[\$svc\]="\$old_digest"/);
  });

  it("captures RepoDigests for NEW_IMAGES after pull", () => {
    // Both OLD and NEW should resolve via the same RepoDigests path.
    const matches = deploy.match(/RepoDigests/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

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

describe("CrewAI Dockerfile (H-08)", () => {
  const dockerfile = read("packages/crewai-bridge/Dockerfile");

  it("creates a non-root user", () => {
    expect(dockerfile).toMatch(/useradd[^\n]+--uid\s+\d+/);
  });

  it("switches to non-root via USER directive", () => {
    expect(dockerfile).toMatch(/^USER\s+(?!root\b)\w+/m);
  });

  it("does NOT run as root", () => {
    // No `USER root` after the privileged setup.
    expect(dockerfile).not.toMatch(/^USER\s+root\b/m);
  });
});

describe("container resource limits (M-12)", () => {
  const composeProd = read("docker-compose.prod.yml");
  const composeDeploy = read("docker-compose.deploy.yml");

  it("every prod service block declares deploy.resources.limits", () => {
    const matches = composeProd.match(/deploy:\s*\n\s+resources:/g) ?? [];
    // 5 services in prod compose: paseo-daemon, soifer-backend, 9router, crewai-bridge, caddy
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  it("every deploy (blue/green) slot declares deploy.resources.limits", () => {
    const matches = composeDeploy.match(/deploy:\s*\n\s+resources:/g) ?? [];
    // 8 service slots: 9router/crewai/soifer/paseo × blue+green
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });

  it("each limit declares both cpus and memory", () => {
    for (const compose of [composeProd, composeDeploy]) {
      const limitBlocks = compose.match(/limits:\s*\n(?:\s+\w+:\s*[^\n]+\n)+/g) ?? [];
      expect(limitBlocks.length).toBeGreaterThan(0);
      for (const block of limitBlocks) {
        expect(block).toMatch(/cpus:/);
        expect(block).toMatch(/memory:/);
      }
    }
  });
});

describe("compose secrets (C-03)", () => {
  it("docker-compose.prod.yml registers PASEO_AUDIT_HMAC_SECRET as a secret", () => {
    const compose = read("docker-compose.prod.yml");
    // Top-level secrets block must declare it
    expect(compose).toMatch(/^secrets:[\s\S]*PASEO_AUDIT_HMAC_SECRET:/m);
    // And paseo-daemon must consume it
    expect(compose).toMatch(/- PASEO_AUDIT_HMAC_SECRET/);
  });

  it("docker-compose.deploy.yml registers PASEO_AUDIT_HMAC_SECRET as a secret", () => {
    const compose = read("docker-compose.deploy.yml");
    expect(compose).toMatch(/^secrets:[\s\S]*PASEO_AUDIT_HMAC_SECRET:/m);
    expect(compose).toMatch(/- PASEO_AUDIT_HMAC_SECRET/);
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
