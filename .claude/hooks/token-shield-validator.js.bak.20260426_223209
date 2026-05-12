#!/usr/bin/env node

/**
 * Token Shield Validator — Cross-platform session management hook
 *
 * Unified Node.js hook that replaces context-guardian.ps1 + session-autoload.ps1 +
 * validate-token-shield.js. Ships with EZRA and deploys to ~/.claude/hooks/ on install.
 *
 * Handles two hook stages:
 *   - SessionStart: Announces available handoff files, runs validation
 *   - Stop: Checks transcript size, generates auto-handoff when over threshold
 *
 * Install: EZRA auto-deploys via bin/cli.js. Add to settings.json:
 *   SessionStart: { "type": "command", "command": "node ~/.claude/hooks/token-shield-validator.js", "timeout": 5 }
 *   Stop:         { "type": "command", "command": "node ~/.claude/hooks/token-shield-validator.js", "timeout": 5 }
 *
 * Protocol: Reads JSON from stdin, outputs JSON/text to stdout, exits 0.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_STDIN = 1024 * 1024;
const THRESHOLD_KB = 2048; // ~300K tokens
const HANDOFF_MAX_AGE_HOURS = 24;

// ─── Hook logger (optional, fail-open) ──────────────────────────

let _log;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }

// ─── Stdin reader (Claude Code hook protocol) ───────────────────

let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  stdinData += chunk;
  if (stdinData.length > MAX_STDIN) process.exit(0);
});
process.stdin.on('end', () => {
  let event = {};
  try { event = JSON.parse(stdinData); } catch (_) {}
  run(event);
});

// ─── Main ───────────────────────────────────────────────────────

function run(event) {
  try {
    const hookEvent = event.event || detectEvent(event);

    if (hookEvent === 'Stop') {
      handleStop(event);
    } else {
      // SessionStart or unknown — run autoload + validation
      handleSessionStart(event);
    }
  } catch (err) {
    _log('token-shield', 'error', { error: err.message });
    process.exit(0); // fail-open
  }
}

/**
 * Detect hook stage from event shape (Claude Code doesn't always set event.event)
 */
function detectEvent(event) {
  if (event.transcript_path || event.stop_hook_active) return 'Stop';
  return 'SessionStart';
}

// ─── SessionStart: Announce handoffs + validate ─────────────────

function handleSessionStart(event) {
  const cwd = event.cwd || process.cwd();
  const lines = [];

  // 1. Find and announce recent handoffs
  const memDir = findProjectMemory(cwd);
  if (memDir) {
    const handoff = findRecentHandoff(memDir);
    if (handoff) {
      const ageH = ((Date.now() - handoff.mtime) / 3600000).toFixed(1);
      const sizeKB = (handoff.size / 1024).toFixed(1);
      lines.push(`[Token Shield] Handoff available from ${ageH}h ago: ${handoff.path} (${sizeKB}KB)`);
    }
  }

  // 2. Quick validation
  const checks = runValidation();
  if (checks.failures.length > 0) {
    lines.push(`[Token Shield] ${checks.failures.length} issue(s): ${checks.failures.join('; ')}`);
  }

  if (lines.length > 0) {
    console.log(lines.join('\n'));
  }

  _log('token-shield', 'session-start', { cwd, handoffFound: !!lines.length });
  process.exit(0);
}

// ─── Stop: Check transcript size, generate handoff ──────────────

function handleStop(event) {
  const transcriptPath = event.transcript_path;
  const sessionId = event.session_id || 'unknown';
  const cwd = event.cwd || process.cwd();

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    process.exit(0);
  }

  const stat = fs.statSync(transcriptPath);
  const sizeKB = Math.round(stat.size / 1024);

  if (sizeKB < THRESHOLD_KB) {
    process.exit(0);
  }

  // Generate handoff
  const memDir = findProjectMemory(cwd) || createProjectMemory(cwd);
  const handoffPath = path.join(memDir, 'session_handoff_auto.md');
  const estTokens = Math.round(sizeKB * 150);
  const pct = Math.min(100, Math.round((sizeKB / 4096) * 100));

  const handoff = `---
name: Auto-generated session handoff
description: Token Shield auto-handoff when transcript reached ${sizeKB}KB (~${estTokens}K tokens)
type: project
generated: ${new Date().toISOString()}
session_id: ${sessionId}
transcript_size_kb: ${sizeKB}
working_directory: ${cwd}
---

# Session Handoff (Auto-Generated)

**Generated:** ${new Date().toISOString()}
**Session:** ${sessionId}
**Transcript size:** ${sizeKB}KB (~${estTokens}K tokens)
**Working directory:** ${cwd}

## How to Use
Start a new Claude Code session and say:
\`Read the auto-generated handoff at ${handoffPath} then continue where the previous session left off.\`

## Key Locations
- Plans: ~/.claude/plans/
- Memory: ${memDir}
- Scripts: ~/.claude/scripts/
- Hooks: ~/.claude/hooks/
`;

  try {
    fs.writeFileSync(handoffPath, handoff, 'utf8');
  } catch (_) {
    // fail-open
  }

  const result = JSON.stringify({
    result: 'warn',
    message: `[Token Shield] Transcript at ${sizeKB}KB (~${pct}% of comfortable limit). Handoff saved. Consider starting a fresh session.`
  });

  console.log(result);
  _log('token-shield', 'stop-handoff', { sizeKB, sessionId, handoffPath });
  process.exit(0);
}

// ─── Validation checks ─────────────────────────────────────────

function runValidation() {
  const failures = [];
  const home = os.homedir();

  // Check Context Mode MCP configured
  const mcpPath = path.join(home, '.claude', '.mcp.json');
  if (fs.existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      if (!mcp.mcpServers || !mcp.mcpServers['context-mode']) {
        failures.push('Context Mode MCP not in .mcp.json');
      }
    } catch (_) {
      failures.push('.mcp.json invalid JSON');
    }
  }

  // Check settings.json valid JSON (no BOM)
  const settingsPath = path.join(home, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) {
        failures.push('settings.json has BOM character');
      }
      JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (_) {
      failures.push('settings.json invalid JSON');
    }
  }

  return { failures };
}

// ─── Project memory directory helpers ───────────────────────────

function findProjectMemory(cwd) {
  const projectsBase = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsBase)) return null;

  const cwdNorm = cwd.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

  try {
    const dirs = fs.readdirSync(projectsBase, { withFileTypes: true })
      .filter(d => d.isDirectory());

    // Score all candidates, pick the most specific match (highest matchScore)
    let bestMatch = null;
    let bestScore = 0;

    for (const dir of dirs) {
      const slugParts = dir.name.toLowerCase().split('-').filter(p => p.length >= 2);
      let matchScore = 0;
      for (const part of slugParts) {
        if (cwdNorm.includes(part)) matchScore++;
      }
      if (slugParts.length > 0 && matchScore >= slugParts.length / 2) {
        const candidate = path.join(projectsBase, dir.name, 'memory');
        if (fs.existsSync(candidate) && matchScore > bestScore) {
          bestScore = matchScore;
          bestMatch = candidate;
        }
      }
    }

    return bestMatch;
  } catch (_) {}

  return null;
}

function createProjectMemory(cwd) {
  const slug = cwd.replace(/[:\\/]/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
  try { fs.mkdirSync(memDir, { recursive: true }); } catch (_) {}
  return memDir;
}

function findRecentHandoff(memDir) {
  const cutoff = Date.now() - (HANDOFF_MAX_AGE_HOURS * 3600000);

  try {
    const files = fs.readdirSync(memDir)
      .filter(f => f.startsWith('session_handoff'))
      .map(f => {
        const full = path.join(memDir, f);
        const stat = fs.statSync(full);
        return { path: full, mtime: stat.mtimeMs, size: stat.size };
      })
      .filter(f => f.mtime > cutoff)
      .sort((a, b) => b.mtime - a.mtime);

    return files[0] || null;
  } catch (_) {
    return null;
  }
}
