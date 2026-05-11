import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cpSync } from "node:fs";
import type { Logger } from "pino";

const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_BACKUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BACKUPS_DIR_NAME = "backups";

/** Directories to exclude from backup (logs and backups themselves). */
const EXCLUDE_DIRS = new Set(["logs", BACKUPS_DIR_NAME]);

export interface BackupConfig {
  paseoHome: string;
  intervalMs?: number;
  maxAgeMs?: number;
}

export interface BackupResult {
  path: string;
  timestamp: string;
  sizeBytes: number;
}

/**
 * Create a point-in-time backup of PASEO_HOME state data.
 * Copies all data directories (agents, projects, config) excluding logs and
 * previous backups.
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
  const backupPath = join(backupsDir, `backup-${timestamp}`);

  mkdirSync(backupPath, { recursive: true });

  const entries = readdirSync(paseoHome, { withFileTypes: true });
  let totalSize = 0;

  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;

    const src = join(paseoHome, entry.name);
    const dest = join(backupPath, entry.name);

    try {
      cpSync(src, dest, { recursive: true });
      totalSize += getDirSize(dest);
    } catch (err) {
      options?.logger?.warn({ err, path: src }, "Skipped file during backup");
    }
  }

  options?.logger?.info(
    { backupPath, sizeBytes: totalSize, timestamp: now.toISOString() },
    "Backup created",
  );

  return { path: backupPath, timestamp: now.toISOString(), sizeBytes: totalSize };
}

/**
 * Restore from a backup by copying its contents back to PASEO_HOME.
 * Does NOT delete existing data — merges/overwrites.
 */
export function restoreBackup(
  backupPath: string,
  paseoHome: string,
  options?: { logger?: Logger },
): void {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }

  const entries = readdirSync(backupPath, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(backupPath, entry.name);
    const dest = join(paseoHome, entry.name);
    cpSync(src, dest, { recursive: true, force: true });
  }

  options?.logger?.info({ backupPath, paseoHome }, "Backup restored");
}

/**
 * Remove backups older than maxAgeMs.
 */
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

/**
 * List existing backups sorted newest-first.
 */
export function listBackups(paseoHome: string): Array<{ name: string; path: string; mtime: Date }> {
  const backupsDir = join(paseoHome, BACKUPS_DIR_NAME);
  if (!existsSync(backupsDir)) return [];

  return readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("backup-"))
    .map((e) => {
      const p = join(backupsDir, e.name);
      return { name: e.name, path: p, mtime: statSync(p).mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/**
 * Start scheduled backups. Returns a cleanup function.
 */
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
