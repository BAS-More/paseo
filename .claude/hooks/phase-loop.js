#!/usr/bin/env node
/**
 * H2 — phase-loop
 *
 * Event: Stop
 *
 * Enforces the 100% gate at the end of a phase. Fires on Stop (the correct
 * primitive — it can prevent-stop and force Claude to iterate).
 *
 * Activation signal: a `.phase-done` marker file at cwd. Claude creates it
 * at the end of a phase; this hook runs the gate; if all green, removes the
 * marker and allows stop; if red, exits 2 with stderr listing what to fix.
 *
 * If no `.phase-done` marker is present, this hook does nothing — normal
 * stop flow proceeds.
 *
 * Gate (all must pass):
 *   1. npm test               (unit + integration via turbo / chosen runner)
 *   2. npx tsc --noEmit       (typecheck clean)
 *   3. npx c8 check-coverage  (coverage ≥ 98% on new code — per phase-gate.json)
 *   4. gitleaks protect       (no new secrets in staged changes)
 *   5. semgrep ci             (no new security findings)
 *
 * Reads optional `.phase-gate.json` in cwd for per-repo overrides
 * (disable checks, adjust thresholds, custom commands).
 *
 * Each check runs with a hard timeout so a hung process doesn't brick Stop.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const CWD = process.cwd();
const MARKER = path.join(CWD, ".phase-done");
const CONFIG_FILE = path.join(CWD, ".phase-gate.json");

const DEFAULT_CONFIG = {
  enabled: true,
  checks: {
    tests: { enabled: true, cmd: "npm test --silent", timeoutMs: 300000 },
    typecheck: { enabled: true, cmd: "npx tsc --noEmit", timeoutMs: 120000 },
    coverage: {
      enabled: true,
      cmd: "npx c8 check-coverage --lines=98 --functions=98 --branches=98",
      timeoutMs: 60000,
    },
    gitleaks: {
      enabled: true,
      cmd: "gitleaks protect --staged --no-banner",
      timeoutMs: 30000,
    },
    semgrep: {
      enabled: true,
      cmd: "semgrep ci --config auto",
      timeoutMs: 180000,
    },
  },
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const user = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return { ...DEFAULT_CONFIG, ...user, checks: { ...DEFAULT_CONFIG.checks, ...(user.checks || {}) } };
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_CONFIG;
}

function runCheck(name, spec) {
  if (!spec?.enabled) return { name, ok: true, skipped: true };
  try {
    execSync(spec.cmd, {
      cwd: CWD,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: spec.timeoutMs,
    });
    return { name, ok: true };
  } catch (err) {
    return {
      name,
      ok: false,
      reason: err.signal === "SIGTERM" ? "timeout" : "failed",
      stderr: (err.stderr?.toString() || "").slice(0, 500),
      stdout: (err.stdout?.toString() || "").slice(0, 500),
    };
  }
}

function main() {
  // No phase-done marker → nothing to gate, allow stop
  if (!fs.existsSync(MARKER)) process.exit(0);

  const cfg = loadConfig();
  if (!cfg.enabled) {
    // Gate disabled for this repo; remove marker and allow stop
    try { fs.unlinkSync(MARKER); } catch { /* ignore */ }
    process.exit(0);
  }

  const results = Object.entries(cfg.checks).map(([name, spec]) =>
    runCheck(name, spec)
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    // All green — advance
    try { fs.unlinkSync(MARKER); } catch { /* ignore */ }
    process.stdout.write(
      `[phase-loop] ✓ all ${results.length} checks green. Phase complete.\n`
    );
    process.exit(0);
  }

  // Something red — prevent stop, tell Claude what to fix
  const lines = ["[phase-loop] Phase NOT complete. Fix the following before the next Stop:"];
  for (const r of failed) {
    lines.push(`  ✗ ${r.name} — ${r.reason}`);
    if (r.stderr) lines.push(`    ${r.stderr.split("\n")[0]}`);
  }
  lines.push("Keep iterating; remove .phase-done once Claude has self-repaired.");
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}

try {
  main();
} catch (err) {
  // Fail-open: never block stop on a bug in this hook
  process.stderr.write(`[phase-loop] soft fail: ${err.message}\n`);
  process.exit(0);
}
