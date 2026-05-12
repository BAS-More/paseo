#!/usr/bin/env node
/**
 * session-timing — Phase 0 P3a
 *
 * Event:   SessionStart + Stop
 * Matcher: (none)
 *
 * Logs timing markers to ~/.claude/_logs/session-timing.jsonl. Used by
 * steward agent to compute SessionStart latency p50/p95 and session
 * durations. Single-tap design: no existing hooks modified.
 *
 * On SessionStart: writes a `start` marker to a temp marker file +
 * appends `{ts, evt:"session-start", session_id, source}` to jsonl.
 *
 * On Stop: reads the marker file, computes elapsed, appends
 * `{ts, evt:"session-stop", session_id, elapsed_ms, transcript_kb?}`,
 * deletes the marker.
 *
 * Fail-open. Never blocks session boot or stop.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const LOG_DIR = path.join(HOME, '.claude', '_logs');
const LOG_FILE = path.join(LOG_DIR, 'session-timing.jsonl');
const MARKER_DIR = path.join(LOG_DIR, '.markers');
const MAX_STDIN = 1024 * 1024;

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function ensureDirs() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
  try { fs.mkdirSync(MARKER_DIR, { recursive: true }); } catch {}
}

function appendJsonl(obj) {
  try {
    ensureDirs();
    fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n', 'utf8');
  } catch (err) {
    _log('session-timing', 'append-failed', { error: err.message });
  }
}

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

// QAL-007: rely on event.event if present; fall back to stop_hook_active marker only.
// Don't infer from transcript_path (Anthropic may add it to SessionStart later).
function detectEvent(event) {
  if (event.stop_hook_active === true) return 'Stop';
  return 'SessionStart';
}

function handleStart(event) {
  const ts = Date.now();
  const sid = event.session_id || 'unknown';
  const source = event.source || event.hook_event_source || 'unknown';
  ensureDirs();
  try {
    fs.writeFileSync(path.join(MARKER_DIR, `start-${sid}.json`), JSON.stringify({ ts }), 'utf8');
  } catch {}
  appendJsonl({ ts: new Date(ts).toISOString(), evt: 'session-start', session_id: sid, source });
}

function handleStop(event) {
  const ts = Date.now();
  const sid = event.session_id || 'unknown';
  let elapsed_ms = null;
  const marker = path.join(MARKER_DIR, `start-${sid}.json`);
  try {
    if (fs.existsSync(marker)) {
      const m = JSON.parse(fs.readFileSync(marker, 'utf8'));
      elapsed_ms = ts - m.ts;
      try { fs.unlinkSync(marker); } catch {}
    }
  } catch {}
  // SEC-005: validate transcript_path stays under HOME before stat.
  let transcript_kb = null;
  try {
    const tp = event.transcript_path;
    if (tp && typeof tp === 'string') {
      const resolved = path.resolve(tp).toLowerCase();
      const homeNorm = path.resolve(HOME).toLowerCase();
      if (resolved.startsWith(homeNorm) && fs.existsSync(tp)) {
        transcript_kb = Math.round(fs.statSync(tp).size / 1024);
      }
    }
  } catch {}
  appendJsonl({
    ts: new Date(ts).toISOString(),
    evt: 'session-stop',
    session_id: sid,
    elapsed_ms,
    transcript_kb,
  });
}

function main() {
  let raw = readStdinSync();
  let event = {};
  try { event = JSON.parse(raw); } catch {}
  const which = event.event || detectEvent(event);
  if (which === 'Stop') handleStop(event);
  else handleStart(event);
}

try { main(); } catch (err) {
  _log('session-timing', 'error', { error: err.message });
}
process.exit(0);
