#!/usr/bin/env node
/**
 * reflect-detect — Phase 4 T4.5a
 *
 * Event:   UserPromptSubmit
 * Matcher: (none)
 *
 * Lightweight regex detector for user correction phrases. When the user
 * pushes back ("not quite", "actually", "should be", etc.), append a
 * queue entry to ~/.claude/state/reflect-queue.jsonl for later promotion
 * by the Stop-hook drainer.
 *
 * NEVER blocks. Pure observation. Fail-open on any error.
 *
 * Bypass: env CLAUDE_REFLECT_DISABLE=1 → exit 0 immediately.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, '.claude', 'state');
const QUEUE_FILE = path.join(STATE_DIR, 'reflect-queue.jsonl');
const MAX_STDIN = 1024 * 1024;
const MAX_MSG_PREVIEW = 2000;

// Ordered: longer/more-specific first to avoid double-counting.
const CORRECTION_PHRASES = [
  "i told you", "stop doing", "next time", "you should",
  "should be", "should not", "shouldn't ", "instead of",
  "rather than", "not quite", "actually,", "actually ",
  "wrong", "incorrect", "no, ", "don't ",
  "do not ", "that's not", "that is not", "that's wrong",
  "you got it wrong", "off track", "missed",
];

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

function detectCorrection(msg) {
  if (!msg || typeof msg !== 'string') return null;
  const lower = msg.toLowerCase();
  for (const phrase of CORRECTION_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

function appendQueue(entry) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(QUEUE_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    _log('reflect-detect', 'append-failed', { error: err.message });
  }
}

function main() {
  if (process.env.CLAUDE_REFLECT_DISABLE === '1') return;

  const raw = readStdinSync();
  let event = {};
  try { event = JSON.parse(raw); } catch { return; }

  const userMsg = event.user_message || event.prompt || event.message || '';
  if (!userMsg) return;

  const phrase = detectCorrection(userMsg);
  if (!phrase) return;

  appendQueue({
    ts: new Date().toISOString(),
    session_id: event.session_id || null,
    cwd: event.cwd || process.cwd(),
    phrase,
    user_msg: userMsg.slice(0, MAX_MSG_PREVIEW),
  });
  _log('reflect-detect', 'queued', { phrase });
}

try { main(); } catch (err) {
  _log('reflect-detect', 'error', { error: err.message });
}
process.exit(0);
