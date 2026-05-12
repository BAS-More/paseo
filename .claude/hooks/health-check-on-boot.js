#!/usr/bin/env node
/**
 * health-check-on-boot
 *
 * Event: SessionStart
 *
 * Reads ~/.claude/_logs/health-snapshot.json (written by health-runner.ps1)
 * and surfaces aggregate health to Claude on session start.
 *
 *   green   - silent
 *   amber   - "[health] amber: <names>." to stderr
 *   red     - "[health] RED: <names>. Try: pwsh -File \"$HOME\\.claude\\scripts\\mcp-repair.ps1\""
 *   missing - hint to run health-runner.ps1 once
 *   stale   - hint that the scheduled task may be stalled (>90 min)
 *
 * Always exits 0 - never blocks a session.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const STALE_MIN = 90;

function emit(line) {
  process.stderr.write(`[health] ${line}\n`);
}

function main() {
  const snapPath = path.join(os.homedir(), ".claude", "_logs", "health-snapshot.json");

  if (!fs.existsSync(snapPath)) {
    emit("no snapshot yet. Run once: pwsh -File \"$HOME\\.claude\\scripts\\health-runner.ps1\"");
    return;
  }

  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  } catch (e) {
    emit(`snapshot unreadable: ${e.message}`);
    return;
  }

  const checks = Array.isArray(snap.checks) ? snap.checks : [];
  const failed = checks.filter((c) => c && c.status === "FAIL").map((c) => c.name);
  const warned = checks.filter((c) => c && c.status === "WARN").map((c) => c.name);

  if (snap.aggregate === "red") {
    const names = failed.length ? failed.join(", ") : "(unknown)";
    emit(`RED: ${names}. Try: pwsh -File "$HOME\\.claude\\scripts\\mcp-repair.ps1"`);
  } else if (snap.aggregate === "amber") {
    const names = warned.length ? warned.join(", ") : "(unknown)";
    emit(`amber: ${names}.`);
  }
  // green = silent

  // Stale snapshot warning
  const epoch = Number(snap.generated_epoch);
  if (Number.isFinite(epoch) && epoch > 0) {
    const ageMin = (Date.now() / 1000 - epoch) / 60;
    if (ageMin > STALE_MIN) {
      emit(
        `snapshot is ${Math.round(ageMin)} min old - BAS-Health-Runner task may be stalled. ` +
          `Check: schtasks /query /tn BAS-Health-Runner`
      );
    }
  }
}

try {
  main();
} catch (e) {
  // Soft-fail: never block a session.
  process.stderr.write(`[health] hook soft-fail: ${e.message}\n`);
}
process.exit(0);
