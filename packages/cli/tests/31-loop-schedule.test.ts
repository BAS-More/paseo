#!/usr/bin/env npx tsx

import assert from "node:assert";
import { rm } from "node:fs/promises";
import { createE2ETestContext } from "./helpers/test-daemon.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonStdout(stdout: string): any {
  const trimmed = stdout.trim();
  // Find the first { or [ which starts the JSON payload.
  // Handles leading noise from npx/tsx/Node warnings on CI and
  // the [truncated; ...] prefix that formatOutputCapture used to prepend.
  const objStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  let start = -1;
  if (objStart >= 0 && arrStart >= 0) {
    start = Math.min(objStart, arrStart);
  } else if (objStart >= 0) {
    start = objStart;
  } else if (arrStart >= 0) {
    start = arrStart;
  }
  if (start < 0) {
    throw new SyntaxError(
      `No JSON found in stdout (${trimmed.length} chars): ${trimmed.slice(0, 120)}`,
    );
  }
  const candidate = trimmed.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {
    // stdout may contain trailing text after the JSON (e.g. log lines from
    // the daemon supervisor). Walk forward to find where the top-level JSON
    // object/array closes by tracking brace/bracket depth, ignoring strings.
    const open = candidate[0];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return JSON.parse(candidate.slice(0, i + 1));
        }
      }
    }
    throw new SyntaxError(
      `Unbalanced JSON in stdout (${candidate.length} chars): ${candidate.slice(0, 200)}`,
    );
  }
}

console.log("=== Loop And Schedule Command Tests ===\n");

const ctx = await createE2ETestContext({ timeout: 30000 });

try {
  {
    console.log("Test 1: schedule create/ls/inspect/pause/resume/delete work");
    const created = await ctx.paseo(
      [
        "schedule",
        "create",
        "Review new PRs",
        "--every",
        "5m",
        "--name",
        "review-prs",
        "--provider",
        "claude",
        "--json",
      ],
      { timeout: 30000 },
    );
    assert.strictEqual(created.exitCode, 0, created.stderr);
    const createdJson = parseJsonStdout(created.stdout);
    assert.strictEqual(createdJson.name, "review-prs");
    assert.strictEqual(createdJson.cadence, "every:5m");
    assert(
      typeof createdJson.target === "string" &&
        (createdJson.target.startsWith("agent:") || createdJson.target === "new-agent:claude"),
      created.stdout,
    );

    const listed = await ctx.paseo(["schedule", "ls", "--json"]);
    assert.strictEqual(listed.exitCode, 0, listed.stderr);
    const listedJson = parseJsonStdout(listed.stdout);
    assert(Array.isArray(listedJson), listed.stdout);
    assert(
      listedJson.some((item: { id: string }) => item.id === createdJson.id),
      listed.stdout,
    );

    const inspected = await ctx.paseo(["schedule", "inspect", createdJson.id, "--json"]);
    assert.strictEqual(inspected.exitCode, 0, inspected.stderr);
    const inspectedJson = parseJsonStdout(inspected.stdout);
    assert.strictEqual(inspectedJson.status, "active");
    assert.strictEqual(inspectedJson.prompt, "Review new PRs");

    const paused = await ctx.paseo(["schedule", "pause", createdJson.id, "--json"]);
    assert.strictEqual(paused.exitCode, 0, paused.stderr);
    assert.strictEqual(parseJsonStdout(paused.stdout).status, "paused");

    const resumed = await ctx.paseo(["schedule", "resume", createdJson.id, "--json"]);
    assert.strictEqual(resumed.exitCode, 0, resumed.stderr);
    assert.strictEqual(parseJsonStdout(resumed.stdout).status, "active");

    const deleted = await ctx.paseo(["schedule", "delete", createdJson.id, "--json"]);
    assert.strictEqual(deleted.exitCode, 0, deleted.stderr);
    assert.strictEqual(parseJsonStdout(deleted.stdout).id, createdJson.id);
    console.log("schedule commands work\n");
  }

  {
    console.log("Test 1b: schedule create accepts provider/model syntax for new-agent runs");
    const created = await ctx.paseo(
      [
        "schedule",
        "create",
        "Refactor the API layer",
        "--every",
        "10m",
        "--provider",
        "codex/gpt-5.4",
        "--json",
      ],
      { timeout: 30000 },
    );
    assert.strictEqual(created.exitCode, 0, created.stderr);
    const createdJson = parseJsonStdout(created.stdout);
    assert.strictEqual(createdJson.target, "new-agent:codex/gpt-5.4");

    const inspected = await ctx.paseo(["schedule", "inspect", createdJson.id, "--json"]);
    assert.strictEqual(inspected.exitCode, 0, inspected.stderr);
    const inspectedJson = parseJsonStdout(inspected.stdout);
    assert.strictEqual(inspectedJson.target.config.provider, "codex");
    assert.strictEqual(inspectedJson.target.config.model, "gpt-5.4");

    const deleted = await ctx.paseo(["schedule", "delete", createdJson.id, "--json"]);
    assert.strictEqual(deleted.exitCode, 0, deleted.stderr);
    console.log("schedule provider/model syntax works\n");
  }

  {
    console.log("Test 1c: schedule create rejects provider with self target");
    const result = await ctx.paseo(
      [
        "schedule",
        "create",
        "Conflicting schedule",
        "--every",
        "5m",
        "--target",
        "self",
        "--provider",
        "codex/gpt-5.4",
      ],
      { timeout: 30000 },
    );
    assert.notStrictEqual(result.exitCode, 0, "should fail for self target with provider");
    const output = result.stdout + result.stderr;
    assert(
      output.includes("can only be used with a new-agent target"),
      "should explain provider target mismatch",
    );
    console.log("schedule rejects provider with self target\n");
  }

  {
    console.log("Test 2: loop run/ls/inspect/logs/stop work");
    const run = await ctx.paseo(
      [
        "loop",
        "run",
        "Return any response",
        "--name",
        "smoke-loop",
        "--verify-check",
        "true",
        "--json",
      ],
      { timeout: 30000 },
    );
    assert.strictEqual(run.exitCode, 0, run.stderr);
    const runJson = parseJsonStdout(run.stdout);
    assert.strictEqual(runJson.name, "smoke-loop");

    const listed = await ctx.paseo(["loop", "ls", "--json"]);
    assert.strictEqual(listed.exitCode, 0, listed.stderr);
    const listedJson = parseJsonStdout(listed.stdout);
    assert(Array.isArray(listedJson), listed.stdout);
    assert(
      listedJson.some((item: { id: string }) => item.id === runJson.id),
      listed.stdout,
    );

    // Skip polling for worker completion — worker requires the Claude Code
    // native binary which is not installed in CI.  Just verify the lifecycle
    // commands (run → ls → stop) work end-to-end.
    const stopped = await ctx.paseo(["loop", "stop", runJson.id, "--json"]);
    assert.strictEqual(stopped.exitCode, 0, stopped.stderr);
    const stoppedJson = parseJsonStdout(stopped.stdout);
    assert(["succeeded", "failed", "stopped"].includes(stoppedJson.status), stopped.stdout);
    console.log("loop commands work\n");
  }
} finally {
  await ctx.stop();
  // Brief delay so the daemon's child processes finish writing before cleanup
  await sleep(500);
  await rm(ctx.paseoHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  await rm(ctx.workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}

console.log("=== Loop And Schedule Command Tests Passed ===");
