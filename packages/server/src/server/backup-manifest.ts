import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const MANIFEST_FILENAME = "MANIFEST.sha256.json";

/**
 * Compute a SHA-256 manifest of all files in a backup directory.
 * Keys use forward-slash paths relative to backupDir.
 * The manifest file itself is included with its own hash (written last).
 */
export function createBackupManifest(backupDir: string): Record<string, string> {
  const entries = collectFiles(backupDir, backupDir).filter((f) => f !== MANIFEST_FILENAME);

  const manifest: Record<string, string> = {};
  for (const relPath of entries) {
    const absPath = join(backupDir, relPath);
    manifest[relPath] = hashFile(absPath);
  }

  // Write manifest without its own hash first, then hash it and update
  const manifestPath = join(backupDir, MANIFEST_FILENAME);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  manifest[MANIFEST_FILENAME] = hashFile(manifestPath);

  // Re-write with the manifest's own hash included
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return manifest;
}

/**
 * Verify a backup directory against its MANIFEST.sha256.json.
 * Returns { valid, errors } — errors is empty when valid.
 *
 * Checks for:
 * - Missing manifest file
 * - Files present in manifest but missing from disk
 * - Files on disk not recorded in manifest (extra files)
 * - Files whose SHA-256 does not match the recorded hash
 */
export function verifyBackupManifest(backupDir: string): { valid: boolean; errors: string[] } {
  const manifestPath = join(backupDir, MANIFEST_FILENAME);

  let manifest: Record<string, string>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
  } catch {
    return { valid: false, errors: [`Manifest file not found or unreadable: ${manifestPath}`] };
  }

  const errors: string[] = [];

  // Collect all current files on disk (excluding the manifest itself)
  const diskFiles = new Set(
    collectFiles(backupDir, backupDir).filter((f) => f !== MANIFEST_FILENAME),
  );
  const manifestFiles = new Set(Object.keys(manifest).filter((k) => k !== MANIFEST_FILENAME));

  // Check files in manifest but missing on disk
  for (const relPath of manifestFiles) {
    if (!diskFiles.has(relPath)) {
      errors.push(`Missing file: ${relPath}`);
    }
  }

  // Check files on disk but not in manifest
  for (const relPath of diskFiles) {
    if (!manifestFiles.has(relPath)) {
      errors.push(`Extra file not in manifest: ${relPath}`);
    }
  }

  // Check hash integrity for files present in both
  for (const relPath of manifestFiles) {
    if (!diskFiles.has(relPath)) continue; // already reported as missing

    const absPath = join(backupDir, relPath);
    const actual = hashFile(absPath);
    const expected = manifest[relPath];

    if (actual !== expected) {
      errors.push(`Hash mismatch for ${relPath}: expected ${expected}, got ${actual}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Recursively collect all file paths relative to rootDir, using forward slashes. */
function collectFiles(dir: string, rootDir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(abs, rootDir));
    } else if (entry.isFile()) {
      const rel = relative(rootDir, abs).replace(/\\/g, "/");
      results.push(rel);
    }
  }
  return results;
}
