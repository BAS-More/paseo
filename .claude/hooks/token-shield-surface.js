#!/usr/bin/env node
/**
 * UserPromptSubmit hook — surface Token Shield drift marker every prompt
 * until repaired. Mirrors critic-surface.js pattern.
 *
 * Marker written by token-shield-validator.js SessionStart when validation
 * detects drift. This hook keeps it visible to Claude every turn so the user
 * sees a persistent warning, not just a one-shot SessionStart message.
 *
 * Fail-open on any error.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MARKER = path.join(os.homedir(), '.claude', 'state', 'token-shield-drift.json');

try {
  if (!fs.existsSync(MARKER)) process.exit(0);

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(MARKER, 'utf8'));
  } catch {
    // Malformed → delete + exit silent
    try { fs.unlinkSync(MARKER); } catch {}
    process.exit(0);
  }

  if (!Array.isArray(marker.failures) || !marker.failures.length) {
    try { fs.unlinkSync(MARKER); } catch {}
    process.exit(0);
  }

  // Surface as additionalContext so Claude sees it every prompt
  const out = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[token-shield-drift] ${marker.failures.length} issue(s) since ${marker.ts}: ${marker.failures.join('; ')}. Repair: ${marker.repair_cmd || 'node C:/Dev/token-shield/bin/install.js'}`,
    },
  };
  console.log(JSON.stringify(out));
} catch {
  // fail-open
}
process.exit(0);
