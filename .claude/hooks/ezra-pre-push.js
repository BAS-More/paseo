#!/usr/bin/env node
'use strict';

/**
 * EZRA Pre-Push Git Hook (V5-F4)
 *
 * Runs on `git push`. Checks whether a recent EZRA scan exists
 * (within the configured window, default 24 hours).
 * If no recent scan, warns the user.
 *
 * Exit 0 = allow push (always, unless require_recent_scan is blocking)
 * Exit 1 = block push (when git_hooks.pre_push.blocking: true)
 *
 * Zero external dependencies — pure Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────

const DEFAULT_SCAN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── YAML Helpers ────────────────────────────────────────────────

function parseYamlSimple(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let currentKey = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = (line.match(/^(\s*)/)[1] || '').length;
    if (indent === 0) {
      const m = trimmed.match(/^(\w[\w._-]*):\s*(.*)?$/);
      if (!m) continue;
      if (/^(__proto__|constructor|prototype)$/.test(m[1])) continue;
      const val = (m[2] || '').trim();
      if (val === '') { currentKey = m[1]; result[currentKey] = []; }
      else { currentKey = null; result[m[1]] = val; }
    } else if (trimmed.startsWith('- ') && currentKey) {
      result[currentKey].push(trimmed.slice(2).trim());
    }
  }
  return result;
}

// ─── Core Logic ──────────────────────────────────────────────────

function loadGovernance(cwd) {
  const govPath = path.join(cwd, '.ezra', 'governance.yaml');
  if (!fs.existsSync(govPath)) return null;
  try {
    return parseYamlSimple(fs.readFileSync(govPath, 'utf8'));
  } catch {
    return null;
  }
}

function findLatestScan(cwd) {
  const scanDir = path.join(cwd, '.ezra', 'scans');
  if (!fs.existsSync(scanDir)) return null;

  let latestTime = 0;
  let latestFile = null;

  try {
    const files = fs.readdirSync(scanDir);
    for (const f of files) {
      if (!f.endsWith('.yaml') && !f.endsWith('.json')) continue;
      const fp = path.join(scanDir, f);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtimeMs > latestTime) {
          latestTime = stat.mtimeMs;
          latestFile = f;
        }
      } catch { /* skip unreadable files */ }
    }
  } catch {
    return null;
  }

  if (!latestFile) return null;
  return { file: latestFile, mtimeMs: latestTime };
}

function getPrePushConfig(governance) {
  if (!governance) return { blocking: false, maxAgeMs: DEFAULT_SCAN_MAX_AGE_MS };
  const blocking = governance.blocking === 'true' || governance.blocking === true;
  let maxAgeMs = DEFAULT_SCAN_MAX_AGE_MS;
  if (governance.scan_max_age_hours) {
    const hours = parseFloat(governance.scan_max_age_hours);
    if (!isNaN(hours) && hours > 0) maxAgeMs = hours * 60 * 60 * 1000;
  }
  return { blocking, maxAgeMs };
}

function checkScanRecency(cwd, nowMs) {
  const governance = loadGovernance(cwd);
  if (!governance) return { stale: false, skipped: true };

  const config = getPrePushConfig(governance);
  const latest = findLatestScan(cwd);
  const now = nowMs || Date.now();

  if (!latest) {
    return {
      stale: true,
      blocked: config.blocking,
      reason: 'no_scan_found',
      scan_dir: path.join(cwd, '.ezra', 'scans'),
    };
  }

  const ageMs = now - latest.mtimeMs;
  if (ageMs > config.maxAgeMs) {
    const ageHours = Math.round(ageMs / (60 * 60 * 1000) * 10) / 10;
    return {
      stale: true,
      blocked: config.blocking,
      reason: 'scan_too_old',
      latest_scan: latest.file,
      age_hours: ageHours,
      max_age_hours: config.maxAgeMs / (60 * 60 * 1000),
    };
  }

  return {
    stale: false,
    latest_scan: latest.file,
    age_ms: ageMs,
  };
}

// ─── Git Hook Entry Point ────────────────────────────────────────

function run() {
  const cwd = process.cwd();
  const result = checkScanRecency(cwd);

  if (result.skipped) {
    process.exit(0);
  }

  if (result.stale) {
    const prefix = result.blocked ? 'EZRA BLOCKED' : 'EZRA WARNING';
    if (result.reason === 'no_scan_found') {
      process.stderr.write('\n' + prefix + ': No EZRA scan found in ' + result.scan_dir + '\n');
      process.stderr.write('Run /ezra:scan before pushing.\n\n');
    } else {
      process.stderr.write('\n' + prefix + ': Latest scan (' + result.latest_scan +
        ') is ' + result.age_hours + 'h old (max: ' + result.max_age_hours + 'h)\n');
      process.stderr.write('Run /ezra:scan to refresh.\n\n');
    }
    if (result.blocked) {
      process.exit(1);
    }
  }

  process.exit(0);
}

// ─── Module API ──────────────────────────────────────────────────

module.exports = {
  checkScanRecency,
  findLatestScan,
  loadGovernance,
  getPrePushConfig,
  DEFAULT_SCAN_MAX_AGE_MS,
};

if (require.main === module) {
  run();
}
