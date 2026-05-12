#!/usr/bin/env node
/**
 * stuck-detector — Phase 2 T2.4
 *
 * Event:   PostToolUse
 * Matcher: Write|Edit|MultiEdit
 *
 * Tracks per-session edit count per file. After EDIT_LIMIT edits to the
 * SAME file without an intervening successful test pass, emits
 * `decision:"block"` JSON instructing Claude to step back, summarize
 * approaches, and either escalate or change angle.
 *
 * Reset signal: strike-counter clears strikes[*] on test pass; we share
 * the state file. When this hook runs, if state.test_pass_ts is newer
 * than the last edit recorded for this file, we reset that file's
 * counter (interpreting test-pass as "current approach is producing
 * progress, not stuck loop").
 *
 * State file: ~/.claude/_logs/state-<session>.json  (shared)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const LOG_DIR = path.join(HOME, '.claude', '_logs');
const MAX_STDIN = 1024 * 1024;
const EDIT_LIMIT = 5;

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

function extractFilePath(event) {
  return event.tool_input?.file_path || event.tool_input?.path || event.tool_input?.filePath || '';
}

function statePath(sessionId) {
  return path.join(LOG_DIR, `state-${(sessionId || 'default').replace(/[^a-z0-9-]/gi, '_')}.json`);
}

function loadState(sp) {
  try { return JSON.parse(fs.readFileSync(sp, 'utf8')); } catch { return { strikes: {}, edits: {} }; }
}

// QAL-002: atomic write — tmp file + rename. NTFS rename is atomic.
function saveState(sp, st) {
  try {
    fs.mkdirSync(path.dirname(sp), { recursive: true });
    const tmp = sp + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 2), 'utf8');
    fs.renameSync(tmp, sp);
  } catch (err) {
    _log('stuck-detector', 'save-failed', { error: err.message });
  }
}

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
}

function main() {
  const raw = readStdinSync();
  let event = {};
  try { event = JSON.parse(raw); } catch {}

  const filePath = extractFilePath(event);
  if (!filePath) return;
  const session = event.session_id || 'default';
  const sp = statePath(session);
  const state = loadState(sp);
  if (!state.edits) state.edits = {};

  const now = Date.now();
  const entry = state.edits[filePath] || { count: 0, first_ts: now, last_ts: now };

  // Reset signal: any successful test seen since last edit on this file?
  const testPassTs = state.test_pass_ts ? Date.parse(state.test_pass_ts) : 0;
  if (testPassTs && testPassTs > entry.last_ts) {
    entry.count = 0;
    entry.first_ts = now;
  }

  entry.count += 1;
  entry.last_ts = now;
  state.edits[filePath] = entry;
  saveState(sp, state);
  _log('stuck-detector', 'edit', { file: filePath, count: entry.count });

  if (entry.count >= EDIT_LIMIT) {
    const reason =
      `[stuck-detector] ${entry.count} edits to \`${path.basename(filePath)}\` ` +
      `since last test pass. Likely stuck-loop. Required: ` +
      `(1) STOP editing this file ` +
      `(2) summarize attempts so far in docs/<slug>/FAILURE.md ` +
      `(3) re-read requirements + acceptance criteria ` +
      `(4) pick a different angle OR escalate to user. ` +
      `Counter resets when strike-counter sees a test pass. Bypass: edit ${path.relative(HOME, sp)} manually.`;
    emitBlock(reason);
  }
}

try { main(); } catch (err) {
  _log('stuck-detector', 'error', { error: err.message });
}
process.exit(0);
