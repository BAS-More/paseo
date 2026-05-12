#!/usr/bin/env node

/**
 * EZRA AVI-OS Integration Bridge — PostToolUse hook
 *
 * Syncs EZRA decisions and scan findings to avios-context MCP by writing
 * JSON instruction files to .ezra/.avios-sync/pending/. A companion slash
 * command (/ezra:sync) reads the pending queue and calls MCP tools.
 *
 * Trigger: fires on Write/Edit operations to .ezra/decisions/ and .ezra/scans/
 * Protocol: reads stdin JSON { tool_name, tool_input, cwd }, writes JSON to stdout.
 * Non-blocking: always exits 0.
 * Zero dependencies: pure Node.js (fs, path, crypto).
 *
 * Install: Add to .claude/settings.json under hooks.PostToolUse
 */

'use strict';

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// Category mapping: EZRA category -> avios-context category
const CATEGORY_MAP = {
  ARCHITECTURE: 'AD',
  DATABASE: 'DD',
  SECURITY: 'SC',
  API: 'AD',
  TESTING: 'TC',
  INFRASTRUCTURE: 'AD',
  DEPENDENCY: 'TC',
  CONVENTION: 'TC'
};

/**
 * Simple YAML parser for flat and shallow-nested key: value pairs.
 * Handles lists (- item) under a parent key. Does not handle deep nesting.
 */
function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let currentKey = null;
  let currentList = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kvMatch = trimmed.match(/^([\w._-]+):\s*(.*)$/);
    if (kvMatch) {
      if (/^(__proto__|constructor|prototype)$/.test(kvMatch[1])) continue;
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val) {
        result[currentKey] = val;
        currentList = null;
      } else {
        result[currentKey] = [];
        currentList = currentKey;
      }
    } else if (trimmed.startsWith('- ') && currentList) {
      result[currentList].push(trimmed.slice(2).trim());
    }
  }
  return result;
}

/**
 * Read governance.yaml and extract project_id and avios integration config.
 * Returns null if integration is disabled or governance is missing.
 */
function readGovernance(cwd) {
  const govPath = path.join(cwd, '.ezra', 'governance.yaml');
  if (!fs.existsSync(govPath)) return null;

  let gov;
  try {
    gov = parseYaml(fs.readFileSync(govPath, 'utf8'));
  } catch {
    return null;
  }

  // Check avios_integration.enabled — in flat parse it appears as avios_integration or enabled
  // Look for the raw text pattern since our simple parser doesn't handle nested keys
  const rawText = fs.readFileSync(govPath, 'utf8');
  const enabledMatch = rawText.match(/avios_integration[\s\S]*?enabled:\s*(true|false)/);
  if (!enabledMatch || enabledMatch[1] !== 'true') return null;

  const projectId = gov.project_id || gov.name || path.basename(cwd);
  return { projectId, governance: gov };
}

/**
 * Ensure the pending sync directory exists and return its path.
 */
function ensurePendingDir(cwd) {
  const pendingDir = path.join(cwd, '.ezra', '.avios-sync', 'pending');
  fs.mkdirSync(pendingDir, { recursive: true });
  return pendingDir;
}

/**
 * Write a sync instruction file to the pending directory.
 */
function writePendingItem(pendingDir, item) {
  const id = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}_${id}.json`;
  const filePath = path.join(pendingDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf8');
  return filename;
}

/**
 * Process a decision file: parse YAML, map category, write pending sync item.
 */
function processDecisionFile(filePath, cwd, projectId) {
  if (!fs.existsSync(filePath)) return null;

  let decision;
  try {
    decision = parseYaml(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }

  const ezraCategory = (decision.category || 'ARCHITECTURE').toUpperCase();
  const aviosCategory = CATEGORY_MAP[ezraCategory] || 'AD';

  const pendingDir = ensurePendingDir(cwd);
  const item = {
    action: 'add_decision',
    project_id: projectId,
    category: aviosCategory,
    decision: decision.title || decision.decision || decision.name || path.basename(filePath, path.extname(filePath)),
    rationale: decision.rationale || decision.reason || decision.description || '',
    status: 'LOCKED',
    source_file: path.relative(cwd, filePath),
    synced_at: new Date().toISOString()
  };

  const filename = writePendingItem(pendingDir, item);
  return { type: 'decision', filename, category: aviosCategory };
}

/**
 * Process a scan result file: parse for CRITICAL/HIGH findings, write pending sync items.
 */
function processScanFile(filePath, cwd, projectId) {
  if (!fs.existsSync(filePath)) return [];

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const pendingDir = ensurePendingDir(cwd);
  const results = [];

  // Parse scan findings — look for severity indicators in the content
  // Support both structured YAML and freeform text patterns
  const findingBlocks = content.split(/---+|\n(?=finding|issue|vulnerability)/i);

  for (const block of findingBlocks) {
    const severityMatch = block.match(/severity:\s*(CRITICAL|HIGH)/i);
    if (!severityMatch) {
      // Also check for severity in list format
      if (!/CRITICAL|HIGH/i.test(block)) continue;
    }

    const severity = severityMatch
      ? severityMatch[1].toUpperCase()
      : (block.match(/CRITICAL/i) ? 'CRITICAL' : 'HIGH');

    const categoryMatch = block.match(/category:\s*(\w+)/i);
    const descMatch = block.match(/(?:description|title|message|finding):\s*(.+)/i);
    const impactMatch = block.match(/impact:\s*(.+)/i);

    const ezraCategory = categoryMatch ? categoryMatch[1].toUpperCase() : 'SECURITY';
    const aviosCategory = CATEGORY_MAP[ezraCategory] || 'SC';

    const item = {
      action: 'add_risk',
      project_id: projectId,
      category: aviosCategory,
      description: descMatch
        ? descMatch[1].trim()
        : `${severity} finding from EZRA scan`,
      impact: severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      status: 'OPEN',
      source_file: path.relative(cwd, filePath),
      synced_at: new Date().toISOString()
    };

    const filename = writePendingItem(pendingDir, item);
    results.push({ type: 'risk', filename, severity });
  }

  return results;
}

// --- Main: read stdin and process ---

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > MAX_STDIN) { process.exit(0); }
});
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || '';
    const filePath = event.tool_input?.file_path || event.tool_input?.path || '';

    // Only trigger on Write/Edit operations
    if (!['Write', 'Edit'].includes(toolName)) {
      process.exit(0);
      return;
    }

    if (!filePath) {
      process.exit(0);
      return;
    }

    const cwd = event.cwd || process.cwd();
    const relativePath = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, '/');

    // Only trigger for .ezra/decisions/ and .ezra/scans/
    const isDecision = relativePath.startsWith('.ezra/decisions/');
    const isScan = relativePath.startsWith('.ezra/scans/');

    if (!isDecision && !isScan) {
      process.exit(0);
      return;
    }

    // Check governance for avios integration enabled
    const gov = readGovernance(cwd);
    if (!gov) {
      process.exit(0);
      return;
    }

    const absolutePath = path.resolve(cwd, filePath);
    let syncResult;

    if (isDecision) {
      const result = processDecisionFile(absolutePath, cwd, gov.projectId);
      if (result) {
        syncResult = {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            message: `EZRA→AVI-OS: Decision queued for sync (${result.category}). Run /ezra:sync to push.`
          }
        };
      }
    } else if (isScan) {
      const results = processScanFile(absolutePath, cwd, gov.projectId);
      if (results.length > 0) {
        const critical = results.filter(r => r.severity === 'CRITICAL').length;
        const high = results.filter(r => r.severity === 'HIGH').length;
        syncResult = {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            message: `EZRA→AVI-OS: ${results.length} risk(s) queued (${critical} critical, ${high} high). Run /ezra:sync to push.`
          }
        };
      }
    }

    if (syncResult) {
      process.stdout.write(JSON.stringify(syncResult));
    }

    process.exit(0);
  } catch (err) {
    // Non-blocking: log error to stderr, always exit 0
    const msg = _fmt('AVIOS_001', { detail: err.message });
    process.stderr.write(msg + "\n");
    _log(process.cwd(), 'ezra-avios-bridge', 'warn', msg);
    process.exit(0);
  }
});
