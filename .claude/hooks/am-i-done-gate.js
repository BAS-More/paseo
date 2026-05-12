#!/usr/bin/env node
/**
 * am-i-done-gate — Phase 2 T2.3
 *
 * Event:   Stop
 * Matcher: (none)
 *
 * Refuses session termination when an active spec has incomplete tasks.
 * Implements the deterministic subset of the `am-i-done` skill that can
 * run without an LLM. Surfaces the first open task and asks Claude to
 * tick it or document failure before stopping.
 *
 * BLOCKS when ALL of:
 *   - cwd hierarchy contains docs/<slug>/APPROVED         (spec is live)
 *   - same docs/<slug>/tasks.md has any `- [ ]` line     (open task)
 *   - same docs/<slug>/FAILURE.md does NOT exist          (not escalated)
 *   - stop_hook_active is NOT true                        (no recursion)
 *   - sentinel ~/.claude/.allow-stop does NOT exist       (no global bypass)
 *
 * On block: prints JSON {decision:"block", reason:"..."} to stdout per
 * Claude Code Stop hook spec. Otherwise exits 0 silently.
 *
 * Fail-open. Never errors out a session.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const ALLOW_STOP_SENTINEL = path.join(HOME, '.claude', '.allow-stop');
const MAX_STDIN = 1024 * 1024;
const MAX_TASKS_LINES = 5000;

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

// SEC-002: only walk paths under HOME or known dev roots.
const SAFE_ROOTS = [
  path.resolve(HOME),
  'C:\\Dev',
  'C:/Dev',
].map(p => p.toLowerCase().replace(/\\/g, '/'));

function isUnderSafeRoot(p) {
  const norm = path.resolve(p).toLowerCase().replace(/\\/g, '/');
  return SAFE_ROOTS.some(r => norm.startsWith(r));
}

// R-3: aggregate ALL approved slugs in cwd hierarchy, not just first.
// If multiple sibling slugs are APPROVED + tasks-open, surface combined count.
function findApprovedSlugs(startDir) {
  const start = path.resolve(startDir || process.cwd());
  if (!isUnderSafeRoot(start)) {
    _log('am-i-done-gate', 'unsafe-cwd', { startDir });
    return [];
  }
  const found = [];
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      const docs = path.join(cur, 'docs');
      if (fs.existsSync(docs) && fs.statSync(docs).isDirectory()) {
        const slugs = fs.readdirSync(docs, { withFileTypes: true });
        for (const s of slugs) {
          if (!s.isDirectory()) continue;
          const slugDir = path.join(docs, s.name);
          if (fs.existsSync(path.join(slugDir, 'APPROVED'))) {
            found.push(slugDir);
          }
        }
      }
    } catch { /* ignore */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return found;
}

// Back-compat: legacy single-slug callsite
function findApprovedSlug(startDir) {
  const all = findApprovedSlugs(startDir);
  return all[0] || null;
}

function parseTasks(slugDir) {
  const tasksPath = path.join(slugDir, 'tasks.md');
  if (!fs.existsSync(tasksPath)) return null;
  let content;
  try { content = fs.readFileSync(tasksPath, 'utf8'); } catch { return null; }
  const lines = content.split('\n').slice(0, MAX_TASKS_LINES);
  const open = [];
  const done = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*-\s*\[ \]/.test(line)) open.push({ line: i + 1, text: line.trim() });
    else if (/^\s*-\s*\[x\]/i.test(line)) done.push(i + 1);
  }
  return { tasksPath, open, done };
}

function failurePresent(slugDir) {
  return fs.existsSync(path.join(slugDir, 'FAILURE.md'));
}

function emitBlock(reason) {
  const out = JSON.stringify({ decision: 'block', reason });
  process.stdout.write(out + '\n');
}

function main() {
  const raw = readStdinSync();
  let event = {};
  try { event = JSON.parse(raw); } catch {}

  // Recursion guard — Anthropic Stop hook spec
  if (event.stop_hook_active === true) return;

  // Global bypass sentinel
  if (fs.existsSync(ALLOW_STOP_SENTINEL)) {
    _log('am-i-done-gate', 'bypass-sentinel', {});
    return;
  }

  const cwd = event.cwd || process.cwd();
  const slugDirs = findApprovedSlugs(cwd);
  if (slugDirs.length === 0) return; // no approved spec → nothing to gate

  // R-3: aggregate across all approved slugs.
  let totalOpen = 0;
  let firstSlug = null;
  let firstTask = null;
  let firstTasksPath = null;
  for (const slugDir of slugDirs) {
    if (failurePresent(slugDir)) continue; // escalated, skip this slug
    const tasks = parseTasks(slugDir);
    if (!tasks || tasks.open.length === 0) continue;
    totalOpen += tasks.open.length;
    if (!firstTask) {
      firstSlug = slugDir;
      firstTask = tasks.open[0];
      firstTasksPath = tasks.tasksPath;
    }
  }
  if (totalOpen === 0) return; // every approved slug either done or escalated

  const slugCount = slugDirs.length;
  const reason =
    `[am-i-done-gate] ${totalOpen} task(s) still open across ${slugCount} approved slug(s). ` +
    `First: ${path.relative(HOME, firstTasksPath)} line ${firstTask.line} — ${firstTask.text.slice(0, 120)}. ` +
    `Tick it OR write ${path.relative(HOME, firstSlug)}/FAILURE.md to escalate. ` +
    `Global bypass: touch ~/.claude/.allow-stop`;
  emitBlock(reason);
  _log('am-i-done-gate', 'blocked', { slug_count: slugCount, total_open: totalOpen });
}

try { main(); } catch (err) {
  _log('am-i-done-gate', 'error', { error: err.message });
}
process.exit(0);
