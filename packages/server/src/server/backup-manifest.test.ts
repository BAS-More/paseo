import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createBackupManifest, verifyBackupManifest } from "./backup-manifest.js";

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "paseo-manifest-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("createBackupManifest", () => {
  it("returns a record of filename -> sha256 hex strings", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "agents.json"), '{"agents":[]}');
    writeFileSync(join(dir, "config.json"), '{"version":1}');

    const manifest = createBackupManifest(dir);

    expect(typeof manifest).toBe("object");
    expect(manifest["agents.json"]).toBeDefined();
    expect(typeof manifest["agents.json"]).toBe("string");
    expect(manifest["agents.json"]).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest["config.json"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces correct SHA-256 hashes matching file content", () => {
    const dir = makeTempDir();
    const content = "hello world";
    writeFileSync(join(dir, "data.json"), content);

    const manifest = createBackupManifest(dir);

    const expected = createHash("sha256")
      .update(readFileSync(join(dir, "data.json")))
      .digest("hex");

    expect(manifest["data.json"]).toBe(expected);
  });

  it("saves MANIFEST.sha256.json to disk", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "agents.json"), "data");

    createBackupManifest(dir);

    const manifestPath = join(dir, "MANIFEST.sha256.json");
    expect(existsSync(manifestPath)).toBe(true);

    const saved = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
    expect(saved["agents.json"]).toBeDefined();
  });

  it("includes the manifest file itself in the manifest", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "agents.json"), "data");

    const manifest = createBackupManifest(dir);

    expect(manifest["MANIFEST.sha256.json"]).toBeDefined();
  });

  it("handles empty backup directory (only manifest)", () => {
    const dir = makeTempDir();
    const manifest = createBackupManifest(dir);

    // Only the manifest itself
    expect(Object.keys(manifest)).toContain("MANIFEST.sha256.json");
  });

  it("recurses into subdirectories using forward-slash paths", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "subdir"));
    writeFileSync(join(dir, "subdir", "nested.json"), "nested data");

    const manifest = createBackupManifest(dir);

    expect(manifest["subdir/nested.json"]).toBeDefined();
    expect(manifest["subdir/nested.json"]).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("verifyBackupManifest", () => {
  it("returns valid=true for an unmodified backup", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "agents.json"), '{"agents":[]}');
    writeFileSync(join(dir, "config.json"), '{"version":1}');

    createBackupManifest(dir);

    const result = verifyBackupManifest(dir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects a tampered file (hash mismatch)", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "agents.json"), '{"agents":[]}');

    createBackupManifest(dir);

    // Tamper after manifest creation
    writeFileSync(join(dir, "agents.json"), '{"agents":["injected"]}');

    const result = verifyBackupManifest(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("agents.json"))).toBe(true);
  });

  it("detects a missing file listed in manifest", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "agents.json"), '{"agents":[]}');
    writeFileSync(join(dir, "config.json"), '{"version":1}');

    createBackupManifest(dir);

    // Remove a file after manifest creation
    rmSync(join(dir, "config.json"));

    const result = verifyBackupManifest(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("config.json"))).toBe(true);
  });

  it("detects an extra file not recorded in manifest", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "agents.json"), '{"agents":[]}');

    createBackupManifest(dir);

    // Add extra file after manifest creation
    writeFileSync(join(dir, "extra.json"), "extra");

    const result = verifyBackupManifest(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("extra.json"))).toBe(true);
  });

  it("returns error when no manifest file exists", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "agents.json"), "data");

    const result = verifyBackupManifest(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("manifest"))).toBe(true);
  });
});
