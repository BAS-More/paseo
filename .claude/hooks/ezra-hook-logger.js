#!/usr/bin/env node

'use strict';

/**
 * EZRA Shared Hook Logger
 *
 * Provides structured logging for all EZRA hooks.
 * Writes JSON-line entries to .ezra/logs/hooks.log with auto-rotation.
 *
 * Usage (from other hooks):
 *   const { logHookEvent, readHookLog } = require('./ezra-hook-logger');
 *   logHookEvent(cwd, 'ezra-guard', 'error', 'Protected path violation on src/auth', 'Run /ezra:decide to authorize');
 *
 * Zero dependencies — uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_LOG_SIZE = 1024 * 1024; // 1 MB — triggers rotation

/**
 * Write a structured log entry to .ezra/logs/hooks.log
 * @param {string} cwd - Project root (where .ezra/ lives)
 * @param {string} hook - Hook name (e.g. 'ezra-guard')
 * @param {string} level - 'info' | 'warn' | 'error'
 * @param {string} msg - Human-readable message
 * @param {string} [action] - Suggested user action (e.g. 'Run /ezra:decide')
 */
function logHookEvent(cwd, hook, level, msg, action) {
  try {
    const logsDir = path.join(cwd, '.ezra', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logPath = path.join(logsDir, 'hooks.log');

    // Rotate if over threshold
    if (fs.existsSync(logPath)) {
      try {
        const stats = fs.statSync(logPath);
        if (stats.size > MAX_LOG_SIZE) {
          const rotated = logPath + '.1';
          try { fs.unlinkSync(rotated); } catch { /* no previous rotation file */ }
          fs.renameSync(logPath, rotated);
        }
      } catch { /* stat/rotate failure — continue writing */ }
    }

    const entry = {
      ts: new Date().toISOString(),
      hook: hook,
      level: level,
      msg: msg,
    };
    if (action) {
      entry.action = action;
    }

    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Logging must never block hook execution
  }
}

/**
 * Read recent hook log entries
 * @param {string} cwd - Project root
 * @param {number} [limit=50] - Max entries to return (most recent first)
 * @returns {Array<Object>} Parsed log entries
 */
function readHookLog(cwd, limit) {
  const effectiveLimit = limit || 50;
  const logPath = path.join(cwd, '.ezra', 'logs', 'hooks.log');
  if (!fs.existsSync(logPath)) return [];
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = [];
    const start = Math.max(0, lines.length - effectiveLimit);
    for (let i = start; i < lines.length; i++) {
      try {
        entries.push(JSON.parse(lines[i]));
      } catch { /* skip malformed lines */ }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Centralized hook telemetry — writes to ~/.claude/_logs/hooks.jsonl.
 *
 * Three-arg signature for the post-2026-04-28 hook cohort (reflect-detect,
 * reflect-drain, drift-check, am-i-done-gate, strike-counter, stuck-detector,
 * lint-edited, test-first-lock, session-timing, mcp-usage-counter, etc.).
 * Distinct from logHookEvent above which writes per-project under .ezra/logs/.
 *
 * Use this for hooks that don't have a project-scoped cwd (SessionStart hooks,
 * UserPromptSubmit hooks where cwd is not the EZRA-governed project).
 *
 * Auto-rotation at MAX_LOG_SIZE.
 *
 * @param {string} hook - Hook name (e.g. 'reflect-detect')
 * @param {string} event - Event key (e.g. 'queued', 'block', 'error')
 * @param {Object} [data] - Optional structured payload (no secrets)
 */
function log(hook, event, data) {
  try {
    const home = os.homedir();
    const logsDir = path.join(home, '.claude', '_logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'hooks.jsonl');

    if (fs.existsSync(logPath)) {
      try {
        const stats = fs.statSync(logPath);
        if (stats.size > MAX_LOG_SIZE) {
          const rotated = logPath + '.1';
          try { fs.unlinkSync(rotated); } catch { /* no prev */ }
          fs.renameSync(logPath, rotated);
        }
      } catch { /* continue */ }
    }

    const entry = {
      ts: new Date().toISOString(),
      hook: hook,
      event: event,
    };
    if (data && typeof data === 'object') entry.data = data;
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // never block hook
  }
}

module.exports = { logHookEvent, readHookLog, log, MAX_LOG_SIZE };
