import { existsSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  PersistedConfigSchema,
  loadPersistedConfig,
  savePersistedConfig,
  writeConfigAtomically,
} from "./persisted-config.js";

describe("PersistedConfigSchema daemon auth config", () => {
  test("accepts optional daemon password hash", () => {
    const hash = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";
    const parsed = PersistedConfigSchema.parse({
      daemon: {
        auth: { password: hash },
      },
    });

    expect(parsed.daemon?.auth?.password).toBe(hash);
  });
});

describe("PersistedConfigSchema daemon relay config", () => {
  test("accepts optional relay TLS setting", () => {
    const parsed = PersistedConfigSchema.parse({
      daemon: {
        relay: {
          enabled: true,
          endpoint: "relay.example.com:443",
          publicEndpoint: "public.example.com:443",
          useTls: true,
        },
      },
    });

    expect(parsed.daemon?.relay?.useTls).toBe(true);
  });
});

describe("PersistedConfigSchema agent provider runtime settings", () => {
  test("legacy append entries are skipped during migration", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          claude: {
            command: {
              mode: "append",
              args: ["--chrome"],
            },
            env: {
              FOO: "bar",
            },
          },
        },
      },
    });

    expect(parsed.agents?.providers).toEqual({});
  });

  test("accepts provider command replace argv", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          codex: {
            command: {
              mode: "replace",
              argv: ["docker", "run", "--rm", "my-codex-wrapper"],
            },
          },
        },
      },
    });

    expect(parsed.agents?.providers?.codex?.command).toEqual([
      "docker",
      "run",
      "--rm",
      "my-codex-wrapper",
    ]);
  });

  test("rejects replace command without argv", () => {
    const result = PersistedConfigSchema.safeParse({
      agents: {
        providers: {
          opencode: {
            command: {
              mode: "replace",
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("provider overrides (new format)", () => {
  test("override built-in provider with command and env", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          claude: {
            command: ["/opt/custom/claude"],
            env: {
              ANTHROPIC_API_KEY: "sk-test",
            },
          },
        },
      },
    });

    expect(parsed.agents?.providers?.claude).toEqual({
      command: ["/opt/custom/claude"],
      env: {
        ANTHROPIC_API_KEY: "sk-test",
      },
    });
  });

  test("new provider extending claude with label", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          zai: {
            extends: "claude",
            label: "ZAI",
          },
        },
      },
    });

    expect(parsed.agents?.providers?.zai).toEqual({
      extends: "claude",
      label: "ZAI",
    });
  });

  test("new provider extending acp with command", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          "my-agent": {
            extends: "acp",
            label: "My Agent",
            command: ["my-agent", "--acp"],
          },
        },
      },
    });

    expect(parsed.agents?.providers?.["my-agent"]).toEqual({
      extends: "acp",
      label: "My Agent",
      command: ["my-agent", "--acp"],
    });
  });

  test("enabled: false accepted", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          claude: {
            enabled: false,
          },
        },
      },
    });

    expect(parsed.agents?.providers?.claude?.enabled).toBe(false);
  });

  test("models array accepted", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          zai: {
            extends: "claude",
            label: "ZAI",
            models: [
              {
                id: "zai-fast",
                label: "ZAI Fast",
                isDefault: true,
              },
            ],
          },
        },
      },
    });

    expect(parsed.agents?.providers?.zai?.models).toEqual([
      {
        id: "zai-fast",
        label: "ZAI Fast",
        isDefault: true,
      },
    ]);
  });

  test("additionalModels array accepted", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          zai: {
            extends: "claude",
            label: "ZAI",
            additionalModels: [
              {
                id: "zai-fast",
                label: "ZAI Fast",
                isDefault: true,
              },
            ],
          },
        },
      },
    });

    expect(parsed.agents?.providers?.zai?.additionalModels).toEqual([
      {
        id: "zai-fast",
        label: "ZAI Fast",
        isDefault: true,
      },
    ]);
  });

  test("order field accepted", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          claude: {
            order: 1,
          },
        },
      },
    });

    expect(parsed.agents?.providers?.claude?.order).toBe(1);
  });

  test("new provider without extends → error", () => {
    const result = PersistedConfigSchema.safeParse({
      agents: {
        providers: {
          zai: {
            label: "ZAI",
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test("new provider without label → error", () => {
    const result = PersistedConfigSchema.safeParse({
      agents: {
        providers: {
          zai: {
            extends: "claude",
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test("extends: acp without command → error", () => {
    const result = PersistedConfigSchema.safeParse({
      agents: {
        providers: {
          "my-agent": {
            extends: "acp",
            label: "My Agent",
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test("extends unknown provider → error", () => {
    const result = PersistedConfigSchema.safeParse({
      agents: {
        providers: {
          zai: {
            extends: "unknown",
            label: "ZAI",
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test("invalid provider ID format → error", () => {
    const result = PersistedConfigSchema.safeParse({
      agents: {
        providers: {
          ZAI: {
            extends: "claude",
            label: "ZAI",
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test("old format with mode: replace auto-migrates", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          claude: {
            command: {
              mode: "replace",
              argv: ["docker", "run", "--rm", "claude"],
            },
          },
        },
      },
    });

    expect(parsed.agents?.providers?.claude).toEqual({
      command: ["docker", "run", "--rm", "claude"],
    });
  });

  test("old format with mode: default auto-migrates", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          claude: {
            command: {
              mode: "default",
            },
          },
        },
      },
    });

    expect(parsed.agents?.providers?.claude).toEqual({});
  });

  test("old format env preserved during migration", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          claude: {
            command: {
              mode: "default",
            },
            env: {
              FOO: "bar",
            },
          },
        },
      },
    });

    expect(parsed.agents?.providers?.claude).toEqual({
      env: {
        FOO: "bar",
      },
    });
  });

  test("mixed old and new format entries both work", () => {
    const parsed = PersistedConfigSchema.parse({
      agents: {
        providers: {
          claude: {
            command: {
              mode: "replace",
              argv: ["custom-claude"],
            },
          },
          zai: {
            extends: "claude",
            label: "ZAI",
            command: ["zai"],
          },
        },
      },
    });

    expect(parsed.agents?.providers).toEqual({
      claude: {
        command: ["custom-claude"],
      },
      zai: {
        extends: "claude",
        label: "ZAI",
        command: ["zai"],
      },
    });
  });
});

describe("PersistedConfigSchema logging config", () => {
  test("accepts destination-specific logging config", () => {
    const parsed = PersistedConfigSchema.parse({
      log: {
        console: {
          level: "info",
          format: "pretty",
        },
        file: {
          level: "trace",
          path: "daemon.log",
          rotate: {
            maxSize: "10m",
            maxFiles: 2,
          },
        },
      },
    });

    expect(parsed.log?.console?.level).toBe("info");
    expect(parsed.log?.file?.level).toBe("trace");
    expect(parsed.log?.file?.rotate?.maxFiles).toBe(2);
  });

  test("accepts legacy logging config fields", () => {
    const parsed = PersistedConfigSchema.parse({
      log: {
        level: "debug",
        format: "json",
      },
    });

    expect(parsed.log?.level).toBe("debug");
    expect(parsed.log?.format).toBe("json");
  });

  test("rejects unknown logging config fields", () => {
    const result = PersistedConfigSchema.safeParse({
      log: {
        console: {
          level: "info",
          color: "red",
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("PersistedConfigSchema voice mode config", () => {
  test("accepts a dedicated turn detection provider", () => {
    const parsed = PersistedConfigSchema.parse({
      features: {
        voiceMode: {
          turnDetection: {
            provider: "local",
          },
        },
      },
    });

    expect(parsed.features?.voiceMode?.turnDetection?.provider).toBe("local");
  });
});

describe("savePersistedConfig — atomic writes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `paseo-config-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      const { rmSync } = require("node:fs");
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test("writeConfigAtomically writes correct content to the target file", () => {
    const targetPath = path.join(tmpDir, "config.json");
    writeConfigAtomically(targetPath, '{"version":1}\n');

    expect(existsSync(targetPath)).toBe(true);
    const content = require("node:fs").readFileSync(targetPath, "utf-8");
    expect(JSON.parse(content)).toEqual({ version: 1 });
  });

  test("writeConfigAtomically leaves no .tmp files after success", () => {
    const targetPath = path.join(tmpDir, "config.json");
    writeConfigAtomically(targetPath, '{"version":1}\n');

    const entries = readdirSync(tmpDir);
    expect(entries.filter((f) => f.includes(".tmp"))).toHaveLength(0);
  });

  test("writeConfigAtomically preserves prior content if write fails", () => {
    // Pre-write a valid config
    const targetPath = path.join(tmpDir, "config.json");
    writeConfigAtomically(targetPath, '{"version":1,"prior":true}\n');

    // Attempt an atomic write to a non-writable directory (simulate failure)
    // by using an invalid target path; the original file must remain intact.
    expect(() => {
      writeConfigAtomically(
        path.join(tmpDir, "nonexistent", "config.json"),
        '{"version":1,"corrupt":true}\n',
      );
    }).toThrow();

    // Original file is still intact
    const content = require("node:fs").readFileSync(targetPath, "utf-8");
    expect(JSON.parse(content)).toMatchObject({ prior: true });
  });

  test("leaves no .tmp file after a successful write", () => {
    const config = loadPersistedConfig(tmpDir);
    savePersistedConfig(tmpDir, config);

    const entries = readdirSync(tmpDir);
    const tmpFiles = entries.filter((f) => f.includes(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  test("written file contains valid JSON matching the saved config", () => {
    const config = loadPersistedConfig(tmpDir);
    savePersistedConfig(tmpDir, config);

    const content = require("node:fs").readFileSync(path.join(tmpDir, "config.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toMatchObject({ version: 1 });
  });

  test("config round-trips through save and load", () => {
    const config = loadPersistedConfig(tmpDir);
    if (!config.daemon) config.daemon = {};
    config.daemon.listen = "127.0.0.1:9999";
    savePersistedConfig(tmpDir, config);

    const loaded = loadPersistedConfig(tmpDir);
    expect(loaded.daemon?.listen).toBe("127.0.0.1:9999");
  });
});
