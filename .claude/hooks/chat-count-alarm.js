#!/usr/bin/env node
// chat-count-alarm.js — SessionStart hook
// Counts .jsonl chats in .claude/projects, diffs vs last known count.
// Alerts via stderr (visible in session boot) if drop detected.
// Writes /_last-chat-count.json for next-run comparison.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const STATE_FILE = path.join(CLAUDE_DIR, '_last-chat-count.json');
const LOG_FILE = path.join(CLAUDE_DIR, '_logs', 'chat-count-alarm.log');
const DROP_THRESHOLD = 3; // alert if chat count drops by >=3

function log(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); }
  catch (_) { /* ignore */ }
}

function countJsonlRecursive(dir) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) count += countJsonlRecursive(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) count++;
    }
  } catch (_) { /* ignore */ }
  return count;
}

function countRootJsonl(dir) {
  let count = 0;
  try {
    const projects = fs.readdirSync(dir, { withFileTypes: true });
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const projDir = path.join(dir, p.name);
      try {
        const files = fs.readdirSync(projDir);
        count += files.filter((f) => f.endsWith('.jsonl')).length;
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
  return count;
}

function loadLast() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (_) { return null; }
}

function saveLast(data) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2)); }
  catch (_) { /* ignore */ }
}

function main() {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) { process.exit(0); }

    const rootCount = countRootJsonl(PROJECTS_DIR);
    const totalCount = countJsonlRecursive(PROJECTS_DIR);
    const now = new Date().toISOString();
    const last = loadLast();

    if (last && typeof last.rootCount === 'number') {
      const drop = last.rootCount - rootCount;
      if (drop >= DROP_THRESHOLD) {
        const msg = `[chat-count-alarm] WARNING: root chat count dropped by ${drop} (was ${last.rootCount} at ${last.timestamp}, now ${rootCount})`;
        process.stderr.write(msg + '\n');
        log(`DROP ${drop}: ${last.rootCount} -> ${rootCount}`);
      } else {
        log(`OK: root=${rootCount} (was ${last.rootCount}), total=${totalCount}`);
      }
    } else {
      log(`INIT: root=${rootCount}, total=${totalCount}`);
    }

    saveLast({ rootCount, totalCount, timestamp: now });
    process.exit(0);
  } catch (err) {
    log(`HOOK_ERROR: ${err.message}`);
    process.exit(0); // fail-open
  }
}

main();
