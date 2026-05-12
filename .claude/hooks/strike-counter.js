#!/usr/bin/env node
/**
 * strike-counter — Phase 2 T2.2
 *
 * Event:   PostToolUse
 * Matcher: Bash
 *
 * Watches Bash invocations for test/lint/type-check commands. Counts
 * consecutive failures per "target" (command first 60 chars). On the
 * 3rd consecutive fail of the same target, emits a `decision:"block"`
 * JSON to halt Claude and instruct it to:
 *   - git stash / reset to last green
 *   - write FAILURE.md to docs/<slug>/ (escalate)
 *   - stop attempting the same approach
 *
 * Resets the counter on a successful run of the same target.
 *
 * State file: ~/.claude/_logs/state-<session>.json  (shared with stuck-detector)
 *
 * Watched command patterns (regex match on tool_input.command):
 *   - npm test, npm run test*, npx vitest, npx jest
 *   - pnpm test, yarn test, bun test
 *   - npx tsc, mypy, pyright
 *   - npx eslint, biome lint, ruff check
 *   - pytest, cargo test, go test
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const LOG_DIR = path.join(HOME, '.claude', '_logs');
const MAX_STDIN = 1024 * 1024;
const STRIKE_LIMIT = 3;

const WATCHED = [
  // npm-family: covers npm/pnpm/yarn/bun + run/exec patterns
  /\bnpm\s+(test|run\s+test|t)\b/i,
  /\bpnpm\s+(test|run\s+test|exec\s+(?:tsc|jest|vitest|eslint|biome|c8)|t)\b/i,
  /\byarn\s+(test|exec\s+(?:tsc|jest|vitest|eslint|biome))\b/i,
  /\bbun\s+(test|x\s+(?:tsc|jest|vitest|eslint|biome))\b/i,
  // npx-family: explicit
  /\bnpx\s+(vitest|jest|tsc|eslint|biome|c8|prettier|playwright)\b/i,
  // bare tools (R-2: project-local via node_modules/.bin or system)
  /(^|[\s\/\\])tsc(\s|$)/i,
  /(^|[\s\/\\])eslint(\s|$)/i,
  /(^|[\s\/\\])vitest(\s|$)/i,
  /(^|[\s\/\\])jest(\s|$)/i,
  /(^|[\s\/\\])biome\s+(lint|ci|check)/i,
  // Python
  /\bpytest\b/i,
  /\bmypy\b/i,
  /\bpyright\b/i,
  /\bruff\s+check\b/i,
  // Other ecosystems
  /\bcargo\s+(test|check|clippy)\b/i,
  /\bgo\s+(test|vet)\b/i,
];

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

function isWatched(cmd) {
  return WATCHED.some(re => re.test(cmd));
}

function targetKey(cmd) {
  return cmd.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Strip secret-shaped tokens from a string before logging.
 * Patterns: 32+-char alphanumeric (likely keys), AWS keys, JWT, GitHub PATs,
 * Anthropic keys, OpenAI keys, generic Bearer headers.
 */
function redact(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\b(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/g, '[REDACTED-JWT]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED-AWS-KEY]')
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, '[REDACTED-GH-PAT]')
    .replace(/\bsk-[A-Za-z0-9_\-]{40,}\b/g, '[REDACTED-LLM-KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{20,}/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, m => m.length >= 40 ? '[REDACTED-HEX]' : m)
    .replace(/(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, m => m.split(/[:=]/)[0] + '=[REDACTED]');
}

function statePath(sessionId) {
  return path.join(LOG_DIR, `state-${(sessionId || 'default').replace(/[^a-z0-9-]/gi, '_')}.json`);
}

function loadState(sp) {
  try { return JSON.parse(fs.readFileSync(sp, 'utf8')); } catch { return { strikes: {}, edits: {} }; }
}

// QAL-002: atomic write — tmp file + rename. NTFS rename is atomic; concurrent
// writers won't corrupt mid-flight. Reader sees old or new, never partial.
function saveState(sp, st) {
  try {
    fs.mkdirSync(path.dirname(sp), { recursive: true });
    const tmp = sp + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 2), 'utf8');
    fs.renameSync(tmp, sp);
  } catch (err) {
    _log('strike-counter', 'save-failed', { error: err.message });
  }
}

// QAL-005: be conservative about inferring failure from `r.error`.
// Bash often emits stderr text (npm deprecation warnings, git hints) which lands
// in r.error as a non-empty string while exit_code is 0. Treating that as a strike
// causes spurious blocks. Only count as fail when explicit signal exists.
function exitCodeFromEvent(event) {
  const r = event.tool_response || event.tool_result || {};
  if (typeof r.exit_code === 'number') return r.exit_code;
  if (typeof r.exitCode === 'number') return r.exitCode;
  if (r.success === false) return 1;
  if (r.is_error === true) return 1;
  // Only treat r.error as failure if no explicit success/exit signal was provided.
  if (r.error && r.success !== true && typeof r.exit_code === 'undefined' && typeof r.exitCode === 'undefined') return 1;
  return 0;
}

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
}

function main() {
  const raw = readStdinSync();
  let event = {};
  try { event = JSON.parse(raw); } catch {}

  const cmd = event.tool_input?.command || event.tool_input?.cmd || '';
  if (!cmd || !isWatched(cmd)) return;

  const session = event.session_id || 'default';
  const sp = statePath(session);
  const state = loadState(sp);
  if (!state.strikes) state.strikes = {};

  const key = targetKey(cmd);
  const exitCode = exitCodeFromEvent(event);
  const entry = state.strikes[key] || { count: 0, first_ts: null, last_cmd: redact(cmd) };

  if (exitCode === 0) {
    // Success — reset strikes for this target AND mark test_pass_ts
    // so stuck-detector knows the current approach is producing progress.
    if (entry.count > 0) {
      delete state.strikes[key];
      _log('strike-counter', 'reset', { key });
    }
    state.test_pass_ts = new Date().toISOString();
    saveState(sp, state);
    return;
  }

  // Failure
  entry.count += 1;
  entry.first_ts = entry.first_ts || new Date().toISOString();
  entry.last_cmd = redact(cmd);
  state.strikes[key] = entry;
  saveState(sp, state);
  _log('strike-counter', 'fail', { key, count: entry.count });

  if (entry.count >= STRIKE_LIMIT) {
    const reason =
      `[strike-counter] ${entry.count} consecutive failures on \`${key}\`. ` +
      `STOP retrying same approach. Required next steps: ` +
      `(1) summarize what was tried in docs/<slug>/FAILURE.md ` +
      `(2) git stash OR reset to last green commit (with explicit user OK) ` +
      `(3) escalate or pick a different angle. ` +
      `Bypass: delete ${path.relative(HOME, sp)} or reset entry manually.`;
    emitBlock(reason);
  }
}

try { main(); } catch (err) {
  _log('strike-counter', 'error', { error: err.message });
}
process.exit(0);
