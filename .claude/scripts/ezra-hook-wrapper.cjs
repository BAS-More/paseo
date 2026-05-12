#!/usr/bin/env node
/**
 * ezra-hook-wrapper.cjs
 * Wraps any EZRA hook with env-skip and bypass logic.
 *
 * Usage: node ezra-hook-wrapper.cjs <hook-script-path>
 *
 * Skip conditions (hook exits 0 without running):
 *   1. EZRA_HOOKS_OFF=1 environment variable
 *   2. stdin JSON contains "permission_mode": "bypassPermissions"
 *
 * Otherwise, pipes stdin through to the target hook and forwards its exit code.
 */
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const hookPath = process.argv[2];
if (!hookPath) {
  process.stderr.write("[ezra-hook-wrapper] No hook path provided\n");
  process.exit(1);
}

// Skip condition 1: environment variable
if (process.env.EZRA_HOOKS_OFF === "1") {
  process.exit(0);
}

// Read stdin, check for bypass, then forward to hook
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  // Skip condition 2: bypassPermissions in JSON
  try {
    const parsed = JSON.parse(input);
    if (parsed.permission_mode === "bypassPermissions") {
      process.exit(0);
    }
  } catch {
    // Not valid JSON — that's fine, forward as-is
  }

  // Forward to the actual hook
  const resolved = path.resolve(hookPath);
  const child = spawn("node", [resolved], {
    stdio: ["pipe", "inherit", "inherit"],
    env: process.env,
  });

  child.stdin.write(input);
  child.stdin.end();

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });

  child.on("error", (err) => {
    process.stderr.write(`[ezra-hook-wrapper] Failed to spawn hook: ${err.message}\n`);
    process.exit(1);
  });
});
