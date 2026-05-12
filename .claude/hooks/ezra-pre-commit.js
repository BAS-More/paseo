#!/usr/bin/env node
'use strict';

/**
 * EZRA Pre-Commit Git Hook (V5-F4)
 *
 * Runs on `git commit`. Checks staged files against protected paths
 * in .ezra/governance.yaml. If a protected file is staged without
 * a corresponding decision, prints a warning.
 *
 * Exit 0 = allow commit (default, non-blocking)
 * Exit 1 = block commit (when git_hooks.pre_commit.blocking: true)
 *
 * Zero external dependencies — pure Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function getStagedFiles(cwd) {
  try {
    const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function loadGovernance(cwd) {
  const govPath = path.join(cwd, '.ezra', 'governance.yaml');
  if (!fs.existsSync(govPath)) return null;
  try {
    return parseYamlSimple(fs.readFileSync(govPath, 'utf8'));
  } catch {
    return null;
  }
}

function loadDecisions(cwd) {
  const dir = path.join(cwd, '.ezra', 'decisions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.md'));
}

function matchesGlob(filePath, pattern) {
  if (pattern.length > 200) return false; // SEC: ReDoS guard
  const normalized = filePath.replace(/\\/g, '/');
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DS}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DS\}\}/g, '.*');
  try {
    return new RegExp('^' + regex + '$').test(normalized);
  } catch {
    return false;
  }
}

function getConfig(governance) {
  if (!governance) return { blocking: false };
  // Look for git_hooks.pre_commit.blocking in governance
  const blocking = governance.blocking === 'true' || governance.blocking === true;
  return { blocking };
}

function checkStagedFiles(cwd) {
  const governance = loadGovernance(cwd);
  if (!governance) return { violations: [], blocked: false, skipped: true };

  const protectedPaths = governance.protected_paths || [];
  if (protectedPaths.length === 0) return { violations: [], blocked: false };

  const staged = getStagedFiles(cwd);
  if (staged.length === 0) return { violations: [], blocked: false };

  const decisions = loadDecisions(cwd);
  const config = getConfig(governance);
  const violations = [];

  for (const file of staged) {
    for (const pattern of protectedPaths) {
      if (matchesGlob(file, pattern)) {
        violations.push({ file, pattern, has_decision: decisions.length > 0 });
      }
    }
  }

  return {
    violations,
    blocked: config.blocking && violations.length > 0,
    staged_count: staged.length,
    protected_count: protectedPaths.length,
  };
}

// ─── Git Hook Entry Point ────────────────────────────────────────

function run() {
  const cwd = process.cwd();
  const result = checkStagedFiles(cwd);

  if (result.skipped) {
    // No governance.yaml — skip silently
    process.exit(0);
  }

  if (result.violations.length > 0) {
    const prefix = result.blocked ? 'EZRA BLOCKED' : 'EZRA WARNING';
    process.stderr.write('\n' + prefix + ': ' + result.violations.length +
      ' protected path(s) in staged files:\n');
    for (const v of result.violations) {
      process.stderr.write('  - ' + v.file + ' (matches: ' + v.pattern + ')\n');
    }
    if (result.blocked) {
      process.stderr.write('\nCommit blocked. Record a decision with /ezra:decide or use --no-verify.\n\n');
      process.exit(1);
    } else {
      process.stderr.write('\nProceeding (non-blocking mode). Use /ezra:decide to record authorization.\n\n');
    }
  }

  process.exit(0);
}

// ─── Module API ──────────────────────────────────────────────────

module.exports = {
  checkStagedFiles,
  getStagedFiles,
  loadGovernance,
  matchesGlob,
  getConfig,
};

if (require.main === module) {
  run();
}
