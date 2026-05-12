#!/usr/bin/env node
// run-steward.js -- stub invocation path for the steward agent.
// Writes a marker file; the next Claude Code session picks it up.
// Zero npm deps. See docs/run-steward-stub/requirements.md.

'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const HOME          = os.homedir();
const STATE_DIR     = path.join(HOME, '.claude', 'state');
const MARKER        = path.join(STATE_DIR, 'steward-run-requested.json');
const LOGGER_PATH   = path.join(HOME, '.claude', 'hooks', 'ezra-hook-logger.js');
const PRUNE_MS      = 7 * 24 * 60 * 60 * 1000;
const MARKER_GLOB_RE = /^steward-run-requested.*\.json$/;

function tryLoadLogger() {
  try { return require(LOGGER_PATH); }
  catch (e) {
    console.error('[run-steward] logger load skipped:', e.message);
    return null;
  }
}

// Logger signature: log(hook, event, data) — see hooks/ezra-hook-logger.js .log()
function safeLog(logger, hook, event, data) {
  if (!logger || typeof logger.log !== 'function') return;
  try { logger.log(hook, event, data); }
  catch (e) { console.error('[run-steward] logger.log failed:', e.message); }
}

function pruneStaleMarkers(now) {
  let entries;
  try { entries = fs.readdirSync(STATE_DIR); }
  catch (e) { return; } // dir absent => nothing to prune
  // SEC-003: harden against STATE_DIR being a symlink/junction by verifying
  // resolved path stays under the resolved STATE_DIR before unlink.
  const stateRoot = path.resolve(STATE_DIR) + path.sep;
  for (const name of entries) {
    if (!MARKER_GLOB_RE.test(name)) continue;
    const full = path.join(STATE_DIR, name);
    if (!path.resolve(full).startsWith(stateRoot)) continue;
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs > PRUNE_MS) fs.unlinkSync(full);
    } catch (e) {
      console.error(`[run-steward] prune skip ${name}: ${e.message}`);
    }
  }
}

function main() {
  const now = Date.now();
  const ts  = new Date(now).toISOString();
  const logger = tryLoadLogger();

  fs.mkdirSync(STATE_DIR, { recursive: true });

  // SEC-002: hash hostname so machine identity isn't plaintext in synced state dir.
  const hostHash = crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 8);
  const marker = {
    requestedAt: ts,
    source: 'run-steward.js',
    hostHash,
    pid: process.pid,
  };
  fs.writeFileSync(MARKER, JSON.stringify(marker, null, 2) + '\n', 'utf8');

  safeLog(logger, 'run-steward', 'steward.run-requested', { ts, hostHash, pid: marker.pid });

  // Task-Scheduler-friendly stdout line (AC-4)
  process.stdout.write(`steward run requested at ${ts}\n`);

  pruneStaleMarkers(now);
}

try { main(); process.exit(0); }
catch (err) {
  console.error('[run-steward] fatal:', (err && err.stack) || err);
  process.exit(1);
}
