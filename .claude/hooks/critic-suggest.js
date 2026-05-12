#!/usr/bin/env node
/**
 * critic-suggest — Phase 3 T3.2
 *
 * Event:   Stop
 * Matcher: (none)
 *
 * On session stop, check git diff size vs main/master. If diff > 100 LOC,
 * write a marker file `~/.claude/state/critic-needed.json`. Companion hook
 * `critic-surface.js` (UserPromptSubmit) reads + surfaces the marker as
 * additionalContext on the NEXT user prompt, suggesting they run the critic
 * agent before merging.
 *
 * Why deferred-suggestion not inline-block: invoking the critic agent inline
 * from a hook would require spawning a new Claude session ($, latency). The
 * marker pattern lets the user decide when to spend that token budget.
 *
 * Bypass: env CLAUDE_CRITIC_DISABLE=1 → no-op.
 *         stop_hook_active === true → no-op (recursion guard).
 *         file ~/.claude/.critic-disabled exists → no-op.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, '.claude', 'state');
const MARKER_FILE = path.join(STATE_DIR, 'critic-needed.json');
const SAFE_ROOTS = [path.resolve(HOME), 'C:\\Dev', 'C:/Dev'].map(p => p.toLowerCase().replace(/\\/g, '/'));
const DIFF_THRESHOLD = 100;
const MAX_STDIN = 1024 * 1024;

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

function isUnderSafeRoot(p) {
  const norm = path.resolve(p).toLowerCase().replace(/\\/g, '/');
  return SAFE_ROOTS.some(r => norm.startsWith(r));
}

function findGitRoot(start) {
  let cur = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function getBaseBranch(gitRoot) {
  // Try main / master first (covers ~95% of repos)
  for (const b of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', b], { cwd: gitRoot, stdio: 'pipe' });
      return b;
    } catch { /* try next */ }
  }
  // QAL-004 fallback: read upstream HEAD ref → strip origin/ prefix
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: gitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    // ref looks like "origin/develop" → return "develop"
    const stripped = ref.replace(/^origin\//, '');
    if (stripped) return stripped;
  } catch { /* fall through */ }
  // Last resort: log so operator can diagnose
  _log('critic-suggest', 'no-base-branch', { gitRoot });
  return null;
}

/**
 * Returns { insertions, deletions, filesChanged } or null if no diff / git fails.
 */
function diffShortstat(gitRoot, base) {
  try {
    const out = execFileSync('git', ['diff', '--shortstat', `${base}...HEAD`], {
      cwd: gitRoot, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!out) return { insertions: 0, deletions: 0, filesChanged: 0 };
    // " 5 files changed, 123 insertions(+), 45 deletions(-)"
    const filesM = out.match(/(\d+)\s+files?\s+changed/);
    const insM   = out.match(/(\d+)\s+insertions?/);
    const delM   = out.match(/(\d+)\s+deletions?/);
    return {
      filesChanged: filesM ? +filesM[1] : 0,
      insertions:   insM   ? +insM[1]   : 0,
      deletions:    delM   ? +delM[1]   : 0,
    };
  } catch { return null; }
}

function writeMarker(payload) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = MARKER_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, MARKER_FILE);
  } catch (err) {
    _log('critic-suggest', 'write-failed', { error: err.message });
  }
}

function clearMarker() {
  try { if (fs.existsSync(MARKER_FILE)) fs.unlinkSync(MARKER_FILE); } catch {}
}

function main() {
  if (process.env.CLAUDE_CRITIC_DISABLE === '1') return;
  if (fs.existsSync(path.join(HOME, '.claude', '.critic-disabled'))) return;

  const raw = readStdinSync();
  let event = {};
  try { event = JSON.parse(raw); } catch {}

  if (event.stop_hook_active === true) return;

  const cwd = event.cwd || process.cwd();
  if (!isUnderSafeRoot(cwd)) return;

  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) return;
  const base = getBaseBranch(gitRoot);
  if (!base) return;

  const stat = diffShortstat(gitRoot, base);
  if (!stat) return;

  const total = stat.insertions + stat.deletions;
  if (total < DIFF_THRESHOLD) {
    // diff fits — no critic needed. Clear any stale marker.
    clearMarker();
    return;
  }

  writeMarker({
    ts: new Date().toISOString(),
    repo: gitRoot,
    base,
    files_changed: stat.filesChanged,
    insertions: stat.insertions,
    deletions: stat.deletions,
    total,
    threshold: DIFF_THRESHOLD,
    suggestion: `Run \`ezra-reviewer\` or \`critic\` agent on this diff before merging.`,
  });
  _log('critic-suggest', 'marker-written', { repo: gitRoot, total });
}

try { main(); } catch (err) {
  _log('critic-suggest', 'error', { error: err.message });
}
process.exit(0);
