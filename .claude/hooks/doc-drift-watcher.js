#!/usr/bin/env node
/**
 * H7 — doc-drift-watcher
 *
 * Event:   PostToolUse
 * Matcher: Write|Edit|MultiEdit
 *
 * After a source-code edit, surfaces a gentle nudge to run /ezra:doc-sync
 * if the repo has a docs/<slug>/ directory (i.e. an active /spec project).
 *
 * Philosophy:
 *   - Cheap: just pattern checks, never invokes ezra itself. ~5ms.
 *   - Non-blocking: PostToolUse can't block anyway; just emits to stdout.
 *   - Never noisy: skip test/config/CI files so routine edits don't bark.
 *   - Fail-open: any error → exit 0, no output.
 *
 * The stdout text feeds into Claude's next turn, so it sees:
 *   "[doc-drift-watcher] source edited — consider /ezra:doc-sync to check
 *   docs/<slug>/ for drift"
 * and can act if the change was architecturally significant.
 */

const fs = require("node:fs");
const path = require("node:path");

const SOURCE_DIR_RE = /\/(src|apps|lib|libs|packages|server|client|services|handlers|controllers|models|routes)\//i;
const IGNORE_EXT = new Set([".md", ".json", ".yml", ".yaml", ".toml", ".lock", ".snap"]);
const IGNORE_NAME_RE = /(\.test|\.spec|\.stories|\.config|\.d)\.(ts|tsx|js|jsx|mts|cts)$/i;

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

function isSourceEdit(filePath) {
  const n = filePath.replace(/\\/g, "/");
  if (!SOURCE_DIR_RE.test(n)) return false;
  const ext = path.extname(n).toLowerCase();
  if (IGNORE_EXT.has(ext)) return false;
  const base = path.basename(n);
  if (IGNORE_NAME_RE.test(base)) return false;
  return true;
}

function findNearestDocsSlug(startDir) {
  let cur = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    try {
      const docs = path.join(cur, "docs");
      if (fs.existsSync(docs) && fs.statSync(docs).isDirectory()) {
        const entries = fs.readdirSync(docs, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const slugDir = path.join(docs, e.name);
          const hasSpec = ["requirements.md", "design.md", "tasks.md", "PRD.md", "plan.md"]
            .some(f => fs.existsSync(path.join(slugDir, f)));
          if (hasSpec) return { slug: e.name, path: slugDir };
        }
      }
    } catch { /* keep walking */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function main() {
  const input = readStdinSync();
  const filePath = extractFilePath(input);
  if (!filePath) process.exit(0);
  if (!isSourceEdit(filePath)) process.exit(0);

  const docs = findNearestDocsSlug(process.cwd()) || findNearestDocsSlug(path.dirname(filePath));
  if (!docs) process.exit(0);  // no spec project → nothing to drift against

  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/") || path.basename(filePath);
  process.stdout.write(
    `[doc-drift-watcher] Source edited: ${rel}. ` +
    `Active spec project: \`${docs.slug}\`. ` +
    `If this change is architecturally significant, run /ezra:doc-sync to check docs/${docs.slug}/ for drift.\n`
  );
  process.exit(0);
}

try { main(); } catch (err) {
  // Fail-open
  process.exit(0);
}
