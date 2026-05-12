#!/usr/bin/env node
'use strict';
/**
 * hooks/ezra-tier-gate.js — PreToolUse hook for license tier gating
 * Blocks Pro/Team features on Core tier. Core features ALWAYS pass.
 * ZERO external dependencies.
 */
const path = require('path');

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// Feature-to-command mapping for gating
const GATED_COMMANDS = {
  'ezra:cost':       'cost_tracking',
  'ezra:agents':     'multi_agent',
  'ezra:portfolio':  'portfolio',
  'ezra:handoff':    'handoff',
  'ezra:cloud-sync': 'cloud_sync',
  'ezra:research':   'research_agent',
  'ezra:compliance': 'compliance_profiles',
  'ezra:memory':     'memory_system',
  'ezra:plan':       'planning_engine',
  'ezra:advisor':    'advisor',
  'ezra:dash':       'dashboard',
  'ezra:pm':         'project_manager',
  'ezra:learn':      'self_learning',
};

// Core commands — NEVER gated
const CORE_COMMANDS = [
  'ezra:init', 'ezra:scan', 'ezra:guard', 'ezra:reconcile',
  'ezra:decide', 'ezra:review', 'ezra:status', 'ezra:help',
  'ezra:doc', 'ezra:doc-check', 'ezra:doc-sync', 'ezra:doc-approve',
  'ezra:version', 'ezra:health', 'ezra:settings', 'ezra:oversight',
  'ezra:process', 'ezra:workflow', 'ezra:progress', 'ezra:library',
  'ezra:license', 'ezra:install',
];

/**
 * Check if a command should be gated.
 * Returns null if allowed, or a denial object if blocked.
 * Now internally triggers refreshLicense if cache is expired.
 */
function checkGate(commandName, projectDir) {
  // Core commands always pass
  if (CORE_COMMANDS.includes(commandName)) return null;

  const feature = GATED_COMMANDS[commandName];
  if (!feature) return null; // Unknown commands pass through

  // Lazy-load license module to avoid circular deps
  let license;
  try {
    license = require(path.join(__dirname, 'ezra-license.js'));
  } catch (_) {
    return null; // If license module not available, allow
  }

  // Check current license — if cache expired, trigger refresh
  const currentLicense = license.checkLicense(projectDir);
  if (currentLicense.reason === 'cache_expired' || currentLicense.reason === 'no_cache') {
    // Trigger async refresh (non-blocking for gate check)
    try {
      const refreshResult = license.refreshLicense(projectDir);
      if (refreshResult && typeof refreshResult.then === 'function') {
        refreshResult.catch(() => {});
      }
    } catch (_) {
      // Refresh failed — proceed with current check
    }
  }

  const result = license.isFeatureAvailable(projectDir, feature);
  if (result.available) return null;

  return {
    blocked: true,
    command: commandName,
    feature,
    requiredTier: result.requiredTier,
    currentTier: result.currentTier || 'core',
    message: result.upgrade || 'Requires EZRA ' + (result.requiredTier || 'Pro') + '. Upgrade at ezra.dev/pricing',
  };
}

/**
 * PreToolUse hook handler (reads JSON from stdin).
 */
function handleHook(event) {
  if (!event || !event.tool_name) return {};

  const commandName = event.tool_name;
  const projectDir = event.project_dir || process.cwd();

  const gate = checkGate(commandName, projectDir);
  if (gate) {
    return {
      permissionDecision: 'deny',
      reason: gate.message,
    };
  }

  return {};
}

// ─── Exports ────────────────────────────────────────────────────

module.exports = {
  GATED_COMMANDS,
  CORE_COMMANDS,
  checkGate,
  handleHook,
};

// ─── CLI mode ───────────────────────────────────────────────────
if (require.main === module) {
  const MAX_STDIN = 1024 * 1024; // 1 MB stdin limit
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => {
    input += c;
    if (input.length > MAX_STDIN) { process.exit(0); }
  });
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      const result = handleHook(event);
      process.stdout.write(JSON.stringify(result));
    } catch (_) {
      const msg = _fmt('TIER_001', { detail: 'Hook protocol error' });
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-tier-gate', 'warn', msg);
      process.stdout.write('{}');
    }
    process.exit(0);
  });
}
