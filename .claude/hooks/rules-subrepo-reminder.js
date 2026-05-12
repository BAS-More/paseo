#!/usr/bin/env node
/**
 * rules-subrepo-reminder
 *
 * Event: PostToolUse (matcher: Write|Edit|MultiEdit)
 *
 * ~/.claude/rules/ is a SEPARATE git repo (BAS-More/claude-advisor-rules).
 * ~/.claude/ itself is also a git repo (BAS-More/claude-global-config).
 * Edits to files inside ~/.claude/rules/ must be committed to the rules
 * repo, NOT the global-config repo — easy to forget.
 *
 * This hook watches for Write/Edit/MultiEdit on paths under ~/.claude/rules/
 * and emits a systemMessage reminder when that repo has uncommitted changes.
 *
 * Fail-open: any error → exit 0, no nag.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const RULES_DIR = path.join(os.homedir(), ".claude", "rules");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function extractPath(input) {
  try {
    const j = JSON.parse(input || "{}");
    return (
      j?.tool_input?.file_path ||
      j?.tool_response?.filePath ||
      j?.tool_input?.path ||
      null
    );
  } catch {
    return null;
  }
}

function isUnder(target, parent) {
  try {
    const rel = path.relative(parent, target);
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

function rulesRepoDirty() {
  try {
    const out = execSync("git status --porcelain", {
      cwd: RULES_DIR,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).toString().trim();
    return out.length > 0 ? out.split("\n").length : 0;
  } catch {
    return 0;
  }
}

function rulesRepoBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: RULES_DIR,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).toString().trim();
  } catch {
    return null;
  }
}

function main() {
  const input = readStdin();
  const filePath = extractPath(input);
  if (!filePath) { process.exit(0); return; }
  if (!isUnder(filePath, RULES_DIR)) { process.exit(0); return; }

  const dirty = rulesRepoDirty();
  if (dirty === 0) { process.exit(0); return; }

  const branch = rulesRepoBranch() || "(unknown)";
  const msg =
    `[rules-subrepo] You just edited a file under ~/.claude/rules/ ` +
    `(branch: ${branch}, ${dirty} uncommitted change${dirty === 1 ? "" : "s"}). ` +
    `That directory is a SEPARATE repo (BAS-More/claude-advisor-rules). ` +
    `Commit/push from ~/.claude/rules/ specifically — a commit in ~/.claude/ ` +
    `will NOT capture it.`;

  process.stdout.write(JSON.stringify({ systemMessage: msg }) + "\n");
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
