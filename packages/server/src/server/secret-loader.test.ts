import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSecret, loadSecrets } from "./secret-loader.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function createSecretsDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "paseo-secrets-"));
  return tempDir;
}

describe("loadSecret", () => {
  it("reads from Docker secrets file", () => {
    const dir = createSecretsDir();
    writeFileSync(join(dir, "ANTHROPIC_API_KEY"), "sk-ant-secret\n");

    const value = loadSecret("ANTHROPIC_API_KEY", { secretsDir: dir, env: {} });
    expect(value).toBe("sk-ant-secret");
  });

  it("trims whitespace from secret file", () => {
    const dir = createSecretsDir();
    writeFileSync(join(dir, "TOKEN"), "  my-token  \n");

    const value = loadSecret("TOKEN", { secretsDir: dir, env: {} });
    expect(value).toBe("my-token");
  });

  it("falls back to env var when file missing", () => {
    const dir = createSecretsDir();
    const value = loadSecret("OPENAI_API_KEY", {
      secretsDir: dir,
      env: { OPENAI_API_KEY: "sk-env-value" },
    });
    expect(value).toBe("sk-env-value");
  });

  it("prefers Docker secret over env var", () => {
    const dir = createSecretsDir();
    writeFileSync(join(dir, "MY_SECRET"), "from-file");

    const value = loadSecret("MY_SECRET", {
      secretsDir: dir,
      env: { MY_SECRET: "from-env" },
    });
    expect(value).toBe("from-file");
  });

  it("returns undefined when neither exists", () => {
    const dir = createSecretsDir();
    const value = loadSecret("NONEXISTENT", { secretsDir: dir, env: {} });
    expect(value).toBeUndefined();
  });

  it("handles unreadable secret file gracefully", () => {
    const dir = createSecretsDir();
    const subdir = join(dir, "BAD_SECRET");
    mkdirSync(subdir);

    const value = loadSecret("BAD_SECRET", {
      secretsDir: dir,
      env: { BAD_SECRET: "fallback" },
    });
    expect(value).toBe("fallback");
  });
});

describe("loadSecrets", () => {
  it("loads multiple secrets", () => {
    const dir = createSecretsDir();
    writeFileSync(join(dir, "A"), "val-a");
    writeFileSync(join(dir, "B"), "val-b");

    const result = loadSecrets(["A", "B", "C"], { secretsDir: dir, env: { C: "val-c" } });
    expect(result).toEqual({ A: "val-a", B: "val-b", C: "val-c" });
  });

  it("omits missing secrets", () => {
    const dir = createSecretsDir();
    const result = loadSecrets(["MISSING"], { secretsDir: dir, env: {} });
    expect(result).toEqual({});
  });
});
