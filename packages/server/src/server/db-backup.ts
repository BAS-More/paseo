import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

import type { Logger } from "pino";

const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_BACKUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BACKUPS_DIR_NAME = "backups";
const MANIFEST_FILENAME = "manifest.json";
const MANIFEST_VERSION = 1;

const EXCLUDE_DIRS = new Set(["logs", BACKUPS_DIR_NAME]);

export interface BackupConfig {
  paseoHome: string;
  intervalMs?: number;
  maxAgeMs?: number;
}

export interface BackupManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  files: BackupManifestEntry[];
}

export interface BackupResult {
  path: string;
  timestamp: string;
  sizeBytes: number;
}

/**
 * Create a point-in-time backup of PASEO_HOME state data.
 *
 * H-04 (atomic): writes to `<dest>.tmp/`, then `rename` to `<dest>` once
 * everything is on disk. A process crash mid-write leaves only the .tmp
 * directory; the published path is always complete.
 *
 * H-02 (manifest): records a SHA-256 per file in `manifest.json` so restore
 * can detect tampering or partial copies.
 */
export function createBackup(
  paseoHome: string,
  options?: { logger?: Logger; now?: Date },
): BackupResult {
  const now = options?.now ?? new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  if (!existsSync(paseoHome)) {
    throw new Error(`PASEO_HOME does not exist: ${paseoHome}`);
  }

  const backupsDir = join(paseoHome, BACKUPS_DIR_NAME);
  const finalPath = join(backupsDir, `backup-${timestamp}`);
  const tempPath = `${finalPath}.tmp`;

  if (existsSync(tempPath)) {
    rmSync(tempPath, { recursive: true, force: true });
  }
  mkdirSync(tempPath, { recursive: true });

  const entries = readdirSync(paseoHome, { withFileTypes: true });
  let totalSize = 0;

  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const src = join(paseoHome, entry.name);
    const dest = join(tempPath, entry.name);
    try {
      cpSync(src, dest, { recursive: true });
      totalSize += getDirSize(dest);
    } catch (err) {
      options?.logger?.warn({ err, path: src }, "Skipped file during backup");
    }
  }

  const manifest: BackupManifest = {
    version: MANIFEST_VERSION,
    createdAt: now.toISOString(),
    files: hashTree(tempPath),
  };
  writeFileSync(join(tempPath, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2));

  // Atomic publish: rename tmp -> final. On crash before this point, the tmp
  // directory is the only artifact and is excluded from listBackups().
  if (existsSync(finalPath)) {
    rmSync(finalPath, { recursive: true, force: true });
  }
  renameSync(tempPath, finalPath);

  options?.logger?.info(
    {
      backupPath: finalPath,
      sizeBytes: totalSize,
      fileCount: manifest.files.length,
      timestamp: now.toISOString(),
    },
    "Backup created",
  );

  return { path: finalPath, timestamp: now.toISOString(), sizeBytes: totalSize };
}

/**
 * Restore from a backup by copying its contents back to PASEO_HOME.
 *
 * H-02: verifies every file in the backup matches its manifest SHA-256
 * before copying. Throws on mismatch. Old backups without a manifest are
 * accepted with a warning (backward compat).
 */
export function restoreBackup(
  backupPath: string,
  paseoHome: string,
  options?: { logger?: Logger },
): void {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }

  const manifestPath = join(backupPath, MANIFEST_FILENAME);
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
    verifyManifest(backupPath, manifest);
  } else {
    options?.logger?.warn(
      { backupPath },
      "Backup has no manifest.json — skipping integrity check (legacy format)",
    );
  }

  const entries = readdirSync(backupPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === MANIFEST_FILENAME) continue;
    const src = join(backupPath, entry.name);
    const dest = join(paseoHome, entry.name);
    cpSync(src, dest, { recursive: true, force: true });
  }

  options?.logger?.info({ backupPath, paseoHome }, "Backup restored");
}

export function pruneBackups(
  paseoHome: string,
  options?: { maxAgeMs?: number; now?: Date; logger?: Logger },
): number {
  const maxAge = options?.maxAgeMs ?? MAX_BACKUP_AGE_MS;
  const now = options?.now ?? new Date();
  const backupsDir = join(paseoHome, BACKUPS_DIR_NAME);
  if (!existsSync(backupsDir)) return 0;

  const entries = readdirSync(backupsDir, { withFileTypes: true });
  let pruned = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
    const entryPath = join(backupsDir, entry.name);
    try {
      const stat = statSync(entryPath);
      if (now.getTime() - stat.mtimeMs > maxAge) {
        rmSync(entryPath, { recursive: true, force: true });
        pruned++;
        options?.logger?.info({ path: entryPath }, "Pruned old backup");
      }
    } catch {
      // Skip unreadable entries
    }
  }
  return pruned;
}

export function listBackups(paseoHome: string): Array<{ name: string; path: string; mtime: Date }> {
  const backupsDir = join(paseoHome, BACKUPS_DIR_NAME);
  if (!existsSync(backupsDir)) return [];

  return readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("backup-") && !e.name.endsWith(".tmp"))
    .map((e) => {
      const p = join(backupsDir, e.name);
      return { name: e.name, path: p, mtime: statSync(p).mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export function startScheduledBackups(config: BackupConfig & { logger: Logger }): () => void {
  const interval = config.intervalMs ?? BACKUP_INTERVAL_MS;
  const run = () => {
    try {
      createBackup(config.paseoHome, { logger: config.logger });
      pruneBackups(config.paseoHome, {
        maxAgeMs: config.maxAgeMs,
        logger: config.logger,
      });
    } catch (err) {
      config.logger.error({ err }, "Scheduled backup failed");
    }
  };

  const timer = setInterval(run, interval);
  config.logger.info({ intervalHours: interval / 3_600_000 }, "Scheduled backup started");
  return () => clearInterval(timer);
}

function hashTree(root: string): BackupManifestEntry[] {
  const entries: BackupManifestEntry[] = [];
  const walk = (dir: string) => {
    for (const child of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, child.name);
      if (child.isDirectory()) {
        walk(full);
      } else if (child.isFile()) {
        const buf = readFileSync(full);
        const sha256 = createHash("sha256").update(buf).digest("hex");
        const relPath = relative(root, full).split(sep).join("/");
        entries.push({ path: relPath, size: buf.length, sha256 });
      }
    }
  };
  walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function verifyManifest(backupPath: string, manifest: BackupManifest): void {
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(
      `Backup manifest version ${manifest.version} is not supported (expected ${MANIFEST_VERSION})`,
    );
  }
  for (const entry of manifest.files) {
    const file = join(backupPath, ...entry.path.split("/"));
    if (!existsSync(file)) {
      throw new Error(`Backup file missing: ${entry.path}`);
    }
    const buf = readFileSync(file);
    if (buf.length !== entry.size) {
      throw new Error(`Backup file ${entry.path} size mismatch (corrupted backup)`);
    }
    const sha256 = createHash("sha256").update(buf).digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(`Backup file ${entry.path} sha256 mismatch (corrupted backup)`);
    }
  }
}

function getDirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  const stat = statSync(dir);
  if (!stat.isDirectory()) return stat.size;

  let size = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    size += entry.isDirectory() ? getDirSize(p) : statSync(p).size;
  }
  return size;
}
