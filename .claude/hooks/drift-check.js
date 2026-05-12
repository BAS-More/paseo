#!/usr/bin/env node
/**
 * drift-check — Layer 2 of drift protection
 *
 * Event:   SessionStart
 * Matcher: (none)
 *
 * Compares current ~/.claude state to the latest blessed baseline manifest.
 * Surfaces a 1-5 line drift summary in SessionStart additionalContext.
 * NEVER blocks. Pure observation; user decides what to do.
 *
 * Reads: ~/.claude/baselines/blessed-<id>/manifest.json (latest matching prefix)
 * Behavior:
 *   - If no baseline → exit silently (no protection set up yet)
 *   - If baseline + hashes match → silent
 *   - If drift detected → emit summary + log full diff to ~/.claude/_logs/drift/<date>.json
 *
 * Bypass: env CLAUDE_DRIFT_DISABLE=1 → no-op.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const HOME = os.homedir();
const BASELINES_DIR = path.join(HOME, '.claude', 'baselines');
const LOG_DIR = path.join(HOME, '.claude', '_logs', 'drift');
const MAX_STDIN = 1024 * 1024;
const MAX_SUMMARY_LINES = 5;

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

function findLatestBaseline() {
  if (!fs.existsSync(BASELINES_DIR)) return null;
  try {
    const dirs = fs.readdirSync(BASELINES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('blessed-'))
      .map(d => d.name)
      .sort()
      .reverse();
    for (const name of dirs) {
      const m = path.join(BASELINES_DIR, name, 'manifest.json');
      if (fs.existsSync(m)) return { name, manifestPath: m };
    }
  } catch { /* ignore */ }
  return null;
}

function sha256File(absPath) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex'); }
  catch { return null; }
}

function compareHashes(baselineHashes) {
  const drift = { modified: [], removed: [], added: [] };
  // Modified or removed
  for (const [relPath, expectedHash] of Object.entries(baselineHashes)) {
    const abs = path.join(HOME, '.claude', relPath);
    if (!fs.existsSync(abs)) {
      drift.removed.push(relPath);
      continue;
    }
    const actual = sha256File(abs);
    if (actual && actual !== expectedHash) drift.modified.push(relPath);
  }
  // Added — scan known watched dirs.
  // Filter must match baseline-snapshot filters exactly to avoid false positives.
  // QAL-003: extended to scripts/ + baselines/ to detect post-baseline tampering.
  const watchedFilters = {
    hooks:    f => /\.(js|cjs|ps1|sh)$/.test(f),
    agents:   f => f.endsWith('.md'),
    rules:    f => f.endsWith('.md'),
    scripts:  f => /\.(js|cjs|ps1|sh|bat|cmd)$/i.test(f),
  };
  for (const [d, filter] of Object.entries(watchedFilters)) {
    const dir = path.join(HOME, '.claude', d);
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!filter(entry.name)) continue;
        const rel = `${d}/${entry.name}`;
        if (!(rel in baselineHashes)) drift.added.push(rel);
      }
    } catch { /* ignore */ }
  }
  return drift;
}

function emitSummary(baselineName, drift) {
  const total = drift.modified.length + drift.removed.length + drift.added.length;
  if (total === 0) return; // silent on clean

  const lines = [`[drift-check] ${total} change(s) vs baseline ${baselineName}:`];
  if (drift.modified.length) lines.push(`  modified (${drift.modified.length}): ${drift.modified.slice(0, 3).join(', ')}${drift.modified.length > 3 ? ' ...' : ''}`);
  if (drift.removed.length)  lines.push(`  removed  (${drift.removed.length}): ${drift.removed.slice(0, 3).join(', ')}${drift.removed.length > 3 ? ' ...' : ''}`);
  if (drift.added.length)    lines.push(`  added    (${drift.added.length}): ${drift.added.slice(0, 3).join(', ')}${drift.added.length > 3 ? ' ...' : ''}`);
  lines.push(`  full diff: ~/.claude/_logs/drift/${new Date().toISOString().slice(0, 10)}.json`);
  console.log(lines.slice(0, MAX_SUMMARY_LINES + 1).join('\n'));
}

function logFullDiff(baselineName, drift) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const fname = path.join(LOG_DIR, new Date().toISOString().slice(0, 10) + '.json');
    fs.writeFileSync(fname, JSON.stringify({
      ts: new Date().toISOString(),
      baseline: baselineName,
      drift,
    }, null, 2));
  } catch (err) {
    _log('drift-check', 'log-failed', { error: err.message });
  }
}

function main() {
  if (process.env.CLAUDE_DRIFT_DISABLE === '1') return;
  readStdinSync(); // drain

  const baseline = findLatestBaseline();
  if (!baseline) return;

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(baseline.manifestPath, 'utf8')); }
  catch { return; }

  if (!manifest.hashes || typeof manifest.hashes !== 'object') return;

  const drift = compareHashes(manifest.hashes);
  if (drift.modified.length + drift.removed.length + drift.added.length === 0) return;

  emitSummary(baseline.name, drift);
  logFullDiff(baseline.name, drift);
  _log('drift-check', 'detected', {
    baseline: baseline.name,
    modified: drift.modified.length,
    removed: drift.removed.length,
    added: drift.added.length,
  });
}

try { main(); } catch (err) {
  _log('drift-check', 'error', { error: err.message });
}
process.exit(0);
