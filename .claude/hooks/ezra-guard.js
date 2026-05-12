#!/usr/bin/env node
'use strict';

/**
 * EZRA Guard Hook — PreToolUse hook for Write/Edit operations
 * 
 * Checks if the file being modified matches a protected path pattern
 * defined in .ezra/governance.yaml. If matched and no decision record
 * authorises the change, the hook provides a warning (non-blocking).
 * 
 * To make it blocking (deny writes to protected paths), change
 * permissionDecision from "allow" to "deny" in the output.
 * 
 * Install: Add to .claude/settings.json under hooks.PreToolUse
 */

const fs = require('fs');
const path = require('path');

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// YAML parser — simple built-in, zero dependencies
function parseYaml(text) {
  // Parse YAML-like key: value pairs (top-level only)
  const result = {};
  const lines = text.split('\n');
  let currentKey = null;
  let currentList = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Only treat unindented lines as top-level keys
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent === 0) {
      const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
      if (kvMatch) {
        if (/^(__proto__|constructor|prototype)$/.test(kvMatch[1])) continue;
        currentKey = kvMatch[1];
        const val = kvMatch[2].trim();
        if (val) { result[currentKey] = val; currentList = null; }
        else { result[currentKey] = []; currentList = currentKey; }
      }
    } else if (trimmed.startsWith('- ') && currentList) {
      result[currentList].push(trimmed.slice(2).trim());
    }
    // Indented sub-keys (e.g. reason: under a list item) are skipped — not top-level
  }
  return result;
}

const MAX_STDIN = 1024 * 1024; // 1 MB stdin limit
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > MAX_STDIN) { process.exit(0); }
});
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
    
    if (!filePath) {
      process.exit(0); // No file path, allow
      return;
    }

    // Find .ezra/governance.yaml relative to cwd
    const cwd = event.cwd || process.cwd();

    // Path traversal guard — resolved path must stay within cwd
    // SEC-003: Use realpathSync for existing files to prevent symlink bypass
    let resolved = path.resolve(cwd, filePath);
    try {
      if (fs.existsSync(resolved)) {
        resolved = fs.realpathSync(resolved);
      }
    } catch { /* If realpathSync fails, fall back to resolve */ }
    const cwdResolved = path.resolve(cwd);
    let cwdReal = cwdResolved;
    try { cwdReal = fs.realpathSync(cwdResolved); } catch { /* fallback */ }
    // Case-insensitive comparison on Windows to prevent drive-letter casing bypass
    const norm = process.platform === 'win32' ? s => s.toLowerCase() : s => s;
    if (!norm(resolved).startsWith(norm(cwdReal) + path.sep) && norm(resolved) !== norm(cwdReal)) {
      const msg = _fmt('GUARD_002', { path: filePath });
      process.stderr.write(msg + "\n");
      _log(cwd, 'ezra-guard', 'error', msg);
      process.exit(0);
      return;
    }
    const govPath = path.join(cwd, '.ezra', 'governance.yaml');
    
    if (!fs.existsSync(govPath)) {
      process.exit(0); // EZRA not initialized, allow
      return;
    }

    // Parse governance file (with FACT cache support)
    let governance;
    const govCacheKey = `governance:${govPath}`;
    let govContent;
    // Check FACT in-memory cache first (avoids filesystem read on every hook)
    if (global.__factGovernanceCache && global.__factGovernanceCache.key === govCacheKey) {
      const cached = global.__factGovernanceCache;
      const age = Date.now() - cached.timestamp;
      if (age < 60000) { // 1 minute TTL for governance cache
        governance = cached.parsed;
        govContent = cached.raw;
      }
    }
    if (!governance) {
      govContent = fs.readFileSync(govPath, 'utf8');
    }
    if (!governance) {
    try {
      // Try YAML parse
      governance = parseYaml(govContent);
      // Store in FACT cache for subsequent hook invocations
      global.__factGovernanceCache = {
        key: govCacheKey,
        raw: govContent,
        parsed: governance,
        timestamp: Date.now(),
      };
    } catch {
      // Fallback: try as JSON
      try {
        governance = JSON.parse(govContent);
      } catch (parseErr) {
        const msg = _fmt('GUARD_003', { reason: 'Invalid YAML/JSON syntax' });
        process.stderr.write(msg + "\n");
        _log(cwd, 'ezra-guard', 'warn', msg, 'Run /ezra:health to diagnose.');
        process.exit(0); // Can't parse, allow
        return;
      }
    }
    } // end if (!governance) — FACT cache miss path

    // Schema validation — warn on missing required keys or unknown top-level keys
    const KNOWN_KEYS = ['protected_paths', 'allowed_patterns', 'auto_approve', 'version', 'project', 'settings', 'name', 'language', 'standards', 'strict_types', 'no_any', 'project_phase', 'reason'];
    if (governance && typeof governance === 'object') {
      if (!governance.protected_paths) {
        const msg = _fmt('GUARD_004', { key: 'protected_paths' });
        process.stderr.write(msg + "\n");
        _log(cwd, 'ezra-guard', 'warn', msg, 'Run /ezra:init to regenerate governance.yaml.');
      }
      const unknownKeys = Object.keys(governance).filter(k => !KNOWN_KEYS.includes(k));
      if (unknownKeys.length > 0) {
        const msg = 'EZRA [GUARD]: Unknown governance.yaml keys: ' + unknownKeys.join(', ') + '. These will be ignored.';
        process.stderr.write(msg + "\n");
        _log(cwd, 'ezra-guard', 'info', msg);
      }
    }

    const protectedPaths = governance?.protected_paths || [];
    
    // Check if file matches any protected pattern
    const relativePath = path.relative(cwd, path.resolve(cwd, filePath));
    
    for (const pp of protectedPaths) {
      // Handle both object {pattern, reason} and string formats
      let pattern, reason;
      if (typeof pp === 'string') {
        const m = pp.match(/^pattern:\s*(.+)/);
        pattern = m ? m[1].trim() : pp;
        reason = '';
      } else {
        pattern = pp.pattern || '';
        reason = pp.reason || '';
      }
      if (matchGlob(relativePath, pattern)) {
        // File matches protected path — check for decision record
        const decisionsDir = path.join(cwd, '.ezra', 'decisions');
        const hasDecision = checkDecisionExists(decisionsDir, relativePath);
        
        if (!hasDecision) {
          // Protected path without decision — warn (change to "deny" for blocking)
          const guardMsg = _fmt('GUARD_001', { path: relativePath });
          process.stderr.write(guardMsg + "\n");
          _log(cwd, 'ezra-guard', 'warn', guardMsg, 'Run /ezra:decide to authorize.');
          const output = {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              // Change "allow" to "deny" to block protected path writes
              permissionDecision: 'allow',
              permissionDecisionReason: `EZRA: Protected path "${pattern}" — ${reason || 'no reason specified'}. Run /ezra:decide to record a decision authorising this change.`
            }
          };
          process.stdout.write(JSON.stringify(output));
          return;
        }
      }
    }
    
    // No protected path matched or decision exists — allow
    process.exit(0);
    
  } catch (err) {
    // Hook errors should not block work
    process.stderr.write(`EZRA hook error: ${err.message}\n`);
    process.exit(0);
  }
});

/**
 * Simple glob matching supporting * and ** patterns
 */
function matchGlob(filePath, pattern) {
  if (!pattern) return false;
  // SEC-006: Reject overly complex glob patterns to prevent ReDoS
  if (pattern.length > 200) return false;
  // Convert glob to regex
  const normalized = filePath.replace(/\\/g, '/');
  let regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DOUBLESTAR\}\}/g, '.*?');
  
  try {
    return new RegExp(`^${regex}$`).test(normalized) || 
           new RegExp(regex).test(normalized);
  } catch {
    return false;
  }
}

/**
 * Check if any decision file references the given file path
 */
function checkDecisionExists(decisionsDir, filePath) {
  if (!fs.existsSync(decisionsDir)) return false;
  
  const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(decisionsDir, file), 'utf8');
      // Check if this decision references the file AND is active
      if (content.includes(filePath) && /status:\s*ACTIVE/i.test(content)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  
  return false;
}
