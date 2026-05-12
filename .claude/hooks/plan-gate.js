#!/usr/bin/env node
/**
 * H1 - plan-gate
 *
 * Event:   PreToolUse
 * Matcher: Write|Edit|MultiEdit
 *
 * Enforces "plan approved before code". Blocks Write/Edit outside typical
 * project-docs territory unless a docs/<slug>/APPROVED marker exists somewhere
 * at or above the cwd.
 *
 * ALLOWLIST (never gated):
 *   - docs/**                          (project docs / spec phase)
 *   - CLAUDE.md                        (project memory)
 *   - .claude/**                       (Claude Code config / skills / hooks / commands)
 *   - .github/**  .husky/**            (CI / pre-commit hooks)
 *   - top-level *.md                   (README, CHANGELOG, design docs)
 *
 * Everything else requires docs/<slug>/APPROVED somewhere in the cwd hierarchy.
 *
 * Fail-open: on any unexpected error, exit 0 (never brick the session).
 */

const fs = require("node:fs");
const path = require("node:path");

const BACKSLASH_RE = new RegExp("\\\\", "g");

function readStdinSync() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function extractFilePath(input) {
  try {
    const p = JSON.parse(input || "{}");
    return (
      p.tool_input?.file_path ||
      p.tool_input?.path ||
      p.tool_input?.filePath ||
      ""
    );
  } catch {
    return "";
  }
}

function isAllowlisted(filePath) {
  const n = filePath.replace(BACKSLASH_RE, "/");

  if (n.indexOf("/docs/") !== -1) return true;
  if (n.endsWith("/CLAUDE.md") || n === "CLAUDE.md") return true;
  if (n.indexOf("/.claude/") !== -1) return true;
  if (n.indexOf("/.github/") !== -1) return true;
  if (n.indexOf("/.husky/") !== -1) return true;

  // Top-level .md files (README, CHANGELOG, design docs) — NOT inside src/apps/lib/etc
  const fname = n.split("/").pop() || "";
  const sourceDirs = new RegExp("/(src|apps|lib|libs|packages|server|client)/");
  if (/\.md$/i.test(fname) && !sourceDirs.test(n)) return true;

  return false;
}

function hasApprovedMarker(startDir) {
  let cur = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    try {
      const docs = path.join(cur, "docs");
      if (fs.existsSync(docs) && fs.statSync(docs).isDirectory()) {
        const slugs = fs.readdirSync(docs, { withFileTypes: true });
        for (const s of slugs) {
          if (!s.isDirectory()) continue;
          if (fs.existsSync(path.join(docs, s.name, "APPROVED"))) return true;
        }
      }
    } catch { /* ignore */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

function main() {
  const stdin = readStdinSync();
  const filePath = extractFilePath(stdin);
  if (!filePath) process.exit(0);

  if (isAllowlisted(filePath)) process.exit(0);

  for (const root of [process.cwd(), path.dirname(filePath)]) {
    if (hasApprovedMarker(root)) process.exit(0);
  }

  process.stderr.write(
    "[plan-gate] No docs/<slug>/APPROVED marker found. " +
    "Write your spec to docs/<slug>/PRD.md + docs/<slug>/plan.md, " +
    "then `touch docs/<slug>/APPROVED` to unlock code edits.\n"
  );
  process.exit(2);
}

try { main(); } catch (err) {
  process.stderr.write(`[plan-gate] soft fail: ${err.message}\n`);
  process.exit(0);
}
