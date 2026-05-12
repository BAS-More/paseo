#!/usr/bin/env node
/**
 * H3 — typecheck-edited
 *
 * Event:   PostToolUse
 * Matcher: Write|Edit
 *
 * On edit/write of a TypeScript file, run `tsc --noEmit` against the nearest
 * tsconfig.json and echo the result to stdout. PostToolUse can't block, but
 * its stdout feeds into Claude's next turn — so type errors land in front of
 * Claude immediately, not at commit time.
 *
 * Anti-zombie design:
 * - Direct node+tsc spawn (no npx/cmd.exe chain — 1 child, not 3)
 * - PID lock file — kills previous tsc before starting new one
 * - 15s timeout (was 45s)
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("node:os");

const TS_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);
const LOCK_FILE = path.join(os.tmpdir(), "typecheck-edited.lock");

function readStdinSync() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function extractFilePath(input) {
  try {
    const parsed = JSON.parse(input || "{}");
    return (
      parsed.tool_input?.file_path ||
      parsed.tool_input?.path ||
      parsed.tool_input?.filePath ||
      ""
    );
  } catch {
    return "";
  }
}

function findTsconfig(startFile) {
  let dir = path.dirname(path.resolve(startFile));
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveTscBin(startFile) {
  let dir = path.dirname(path.resolve(startFile));
  for (let i = 0; i < 15; i++) {
    const candidate = path.join(dir, "node_modules", "typescript", "bin", "tsc");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function killPreviousRun() {
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10);
    if (pid > 0 && pid !== process.pid) {
      process.kill(pid, 0); // test if alive
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // no lock, stale lock, or already dead — all fine
  }
}

function writeLock(pid) {
  try { fs.writeFileSync(LOCK_FILE, String(pid)); } catch {}
}

function clearLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function main() {
  const filePath = extractFilePath(readStdinSync());
  if (!filePath) process.exit(0);

  const ext = path.extname(filePath);
  if (!TS_EXT.has(ext)) process.exit(0);

  killPreviousRun();
  writeLock(process.pid);

  const tsconfig = findTsconfig(filePath);
  const tscBin = resolveTscBin(filePath);

  let args;
  let cmd;

  if (tscBin) {
    cmd = process.execPath;
    args = tsconfig
      ? [tscBin, "--noEmit", "--project", tsconfig]
      : [tscBin, "--noEmit", filePath];
  } else {
    cmd = process.platform === "win32" ? "tsc.cmd" : "tsc";
    args = tsconfig
      ? ["--noEmit", "--project", tsconfig]
      : ["--noEmit", filePath];
  }

  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
    cwd: process.cwd(),
    windowsHide: true,
    shell: false,
  });

  clearLock();

  if (result.status === 0) {
    process.stdout.write(`[typecheck-edited] ✓ ${path.basename(filePath)} clean.\n`);
  } else {
    const out = (result.stdout?.toString() || result.stderr?.toString() || "").slice(0, 2000);
    process.stdout.write(
      `[typecheck-edited] ✗ tsc found errors after editing ${path.basename(filePath)}:\n${out}\n`
    );
  }
  process.exit(0);
}

try {
  main();
} catch (err) {
  clearLock();
  process.stderr.write(`[typecheck-edited] soft fail: ${err.message}\n`);
  process.exit(0);
}
