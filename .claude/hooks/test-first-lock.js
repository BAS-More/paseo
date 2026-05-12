#!/usr/bin/env node
/**
 * test-first-lock — Phase 1 T1.4
 *
 * Event:   PreToolUse
 * Matcher: Write|Edit|MultiEdit
 *
 * Enforces TDD discipline at harness level: rejects modification of a
 * non-test file unless a test file has changed in the working tree since
 * `main` (or `master`). Forces RED before GREEN.
 *
 * ALLOWLIST (never gated): same as plan-gate.js + .specs/ + _templates/
 *   - docs/**, .claude/**, .github/**, .husky/**, .specs/**, _templates/**
 *   - top-level *.md
 *   - test files themselves: *.test.*, *.spec.*, tests/**, __tests__/**
 *   - paths outside a git repo (no enforcement when there's no git context)
 *
 * BYPASS:
 *   - Prompt contains literal token `[skip-test-first]` → exit 0
 *   - File `~/.claude/.test-first-disabled` exists → exit 0
 *
 * Fail-open on any error (exit 0). Never brick the session.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BACKSLASH_RE = /\\/g;

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function extractFilePath(input) {
  try {
    const p = JSON.parse(input || '{}');
    return p.tool_input?.file_path || p.tool_input?.path || p.tool_input?.filePath || '';
  } catch { return ''; }
}

function extractPromptText(input) {
  try {
    const p = JSON.parse(input || '{}');
    return JSON.stringify(p.tool_input || {}) + ' ' + (p.user_prompt || '');
  } catch { return ''; }
}

function isAllowlisted(filePath) {
  const n = filePath.replace(BACKSLASH_RE, '/');
  if (n.includes('/docs/')) return true;
  if (n.includes('/.claude/')) return true;
  if (n.includes('/.github/')) return true;
  if (n.includes('/.husky/')) return true;
  if (n.includes('/.specs/')) return true;
  if (n.includes('/_templates/')) return true;
  // top-level .md outside source dirs
  const fname = n.split('/').pop() || '';
  const sourceDirs = /\/(src|apps|lib|libs|packages|server|client)\//;
  if (/\.md$/i.test(fname) && !sourceDirs.test(n)) return true;
  return false;
}

function isTestFile(filePath) {
  const n = filePath.replace(BACKSLASH_RE, '/');
  if (/\.(test|spec)\.[a-z]+$/i.test(n)) return true;
  if (/\/tests?\//i.test(n)) return true;
  if (/\/__tests__\//.test(n)) return true;
  return false;
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
  for (const b of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', b], { cwd: gitRoot, stdio: 'pipe' });
      return b;
    } catch { /* try next */ }
  }
  // QAL-004 fallback: read upstream HEAD → strip origin/ prefix (covers develop/trunk/custom)
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: gitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const stripped = ref.replace(/^origin\//, '');
    if (stripped) return stripped;
  } catch { /* fall through */ }
  return null;
}

// QAL-004: limit git diff to test-shaped paths via pathspec.
// Keeps the call O(test-files-changed), not O(repo). On big mono-repos this
// drops latency from seconds to ~100ms. Pathspec ":(glob)" enables glob matching.
const TEST_PATHSPECS = [
  ':(glob)**/*.test.*', ':(glob)**/*.spec.*',
  ':(glob)**/tests/**', ':(glob)**/test/**',
  ':(glob)**/__tests__/**',
];
const GIT_TIMEOUT_MS = 4000;

function gitDiffNamesAny(gitRoot, args) {
  try {
    return execFileSync('git', args.concat(['--', ...TEST_PATHSPECS]), {
      cwd: gitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
  } catch { return ''; }
}

function hasTestChangeSinceBase(gitRoot, base) {
  try {
    // Cheap-first: working-tree diffs are usually empty unless something pending.
    if (gitDiffNamesAny(gitRoot, ['diff', '--name-only', '--diff-filter=ACMR'])) return true;
    if (gitDiffNamesAny(gitRoot, ['diff', '--name-only', '--cached', '--diff-filter=ACMR'])) return true;
    // Branch-vs-base last (most expensive on long histories).
    if (gitDiffNamesAny(gitRoot, ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`])) return true;
    return false;
  } catch { return true; /* fail-open if git misbehaves */ }
}

function bypassRequested(promptText) {
  if (typeof promptText === 'string' && promptText.includes('[skip-test-first]')) return true;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && fs.existsSync(path.join(home, '.claude', '.test-first-disabled'))) return true;
  return false;
}

function main() {
  const stdin = readStdinSync();
  const filePath = extractFilePath(stdin);
  if (!filePath) process.exit(0);
  if (isAllowlisted(filePath)) process.exit(0);
  if (isTestFile(filePath)) process.exit(0);
  if (bypassRequested(extractPromptText(stdin))) {
    _log('test-first-lock', 'bypass', { filePath });
    process.exit(0);
  }
  const gitRoot = findGitRoot(path.dirname(filePath));
  if (!gitRoot) process.exit(0);
  const base = getBaseBranch(gitRoot);
  if (!base) process.exit(0);
  if (hasTestChangeSinceBase(gitRoot, base)) process.exit(0);

  process.stderr.write(
    '[test-first-lock] No test file changed since `' + base + '`. ' +
    'Write or modify a failing test FIRST (RED→GREEN). ' +
    'Bypass: include `[skip-test-first]` in prompt OR `touch ~/.claude/.test-first-disabled`.\n'
  );
  _log('test-first-lock', 'block', { filePath });
  process.exit(2);
}

try { main(); } catch (err) {
  process.stderr.write('[test-first-lock] soft fail: ' + err.message + '\n');
  process.exit(0);
}
