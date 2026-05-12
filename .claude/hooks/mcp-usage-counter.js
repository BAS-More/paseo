#!/usr/bin/env node
/**
 * mcp-usage-counter — Phase 0 P3b
 *
 * Event:   PreToolUse
 * Matcher: mcp__.*
 *
 * Appends one line per MCP tool invocation to
 * ~/.claude/_logs/mcp-usage.jsonl. Zero blocking, zero slowdown — just
 * an audit tap so steward can flag MCPs unused 30+ days.
 *
 * Output line shape: {ts, tool, server, session_id?, cwd?}
 * Where `tool` is the full mcp__<server>__<tool> name and `server` is
 * the parsed server segment.
 *
 * Fail-open. Never blocks tool execution.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const LOG_DIR = path.join(HOME, '.claude', '_logs');
const LOG_FILE = path.join(LOG_DIR, 'mcp-usage.jsonl');
const MAX_STDIN = 1024 * 1024;

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

function parseToolName(event) {
  return event.tool_name || event.tool || event.name || '';
}

function parseServer(toolName) {
  // mcp__<server>__<tool> — server can contain dashes
  const m = /^mcp__([^_].*?)__/.exec(toolName);
  return m ? m[1] : 'unknown';
}

const LOG_ROTATE_AT = 10 * 1024 * 1024; // 10 MB

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const sz = fs.statSync(LOG_FILE).size;
    if (sz < LOG_ROTATE_AT) return;
    fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch { /* fail-open */ }
}

// SEC-004: reduce cwd to project basename so we don't leak full path tree.
function sanitizeCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return null;
  return path.basename(cwd) || null;
}

function appendJsonl(obj) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n', 'utf8');
  } catch (err) {
    _log('mcp-usage-counter', 'append-failed', { error: err.message });
  }
}

function main() {
  const raw = readStdinSync();
  let event = {};
  try { event = JSON.parse(raw); } catch {}
  const toolName = parseToolName(event);
  if (!toolName.startsWith('mcp__')) return; // safety net; matcher should already filter
  appendJsonl({
    ts: new Date().toISOString(),
    tool: toolName,
    server: parseServer(toolName),
    session_id: event.session_id || null,
    project: sanitizeCwd(event.cwd || process.cwd()),
  });
}

try { main(); } catch (err) {
  _log('mcp-usage-counter', 'error', { error: err.message });
}
process.exit(0);
