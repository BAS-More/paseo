#!/usr/bin/env node
'use strict';

/**
 * EZRA Version Tracking Hook
 * 
 * PostToolUse hook for Write/Edit/MultiEdit operations.
 * When a file inside .ezra/ is modified, automatically logs
 * a changelog entry and bumps the patch version.
 * 
 * This ensures NO state change goes untracked.
 * 
 * Install: Add to settings.json under hooks.PostToolUse:
 * {
 *   "matcher": "Write|Edit|MultiEdit",
 *   "hooks": [{
 *     "type": "command",
 *     "command": "node <path>/ezra-version-hook.js",
 *     "timeout": 3
 *   }]
 * }
 */

const fs = require('fs');
const path = require('path');

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

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
      process.exit(0);
      return;
    }

    const cwd = event.cwd || process.cwd();
    const ezraDir = path.join(cwd, '.ezra');
    const relativePath = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, '/');
    
    // Only track changes to .ezra/ files
    if (!relativePath.startsWith('.ezra/')) {
      process.exit(0);
      return;
    }

    // Don't track changes to the version system itself (infinite loop prevention)
    if (relativePath.startsWith('.ezra/versions/')) {
      process.exit(0);
      return;
    }

    // Don't track drift counter (high frequency, low value)
    if (relativePath.includes('.drift-counter.json')) {
      process.exit(0);
      return;
    }

    const versionsDir = path.join(ezraDir, 'versions');
    if (!fs.existsSync(versionsDir)) {
      fs.mkdirSync(versionsDir, { recursive: true });
    }

    // Determine change type from path
    let changeType = 'GOVERNANCE';
    let action = 'UPDATED';
    let target = relativePath;

    if (relativePath.startsWith('.ezra/decisions/')) {
      changeType = 'DECISION';
      action = 'CREATED'; // Decisions are typically created, not updated
    } else if (relativePath.startsWith('.ezra/docs/proposals/')) {
      changeType = 'PROPOSAL';
      action = 'CREATED';
    } else if (relativePath.startsWith('.ezra/docs/')) {
      changeType = 'DOCUMENT';
      if (relativePath.includes('registry.yaml')) {
        changeType = 'GOVERNANCE';
      }
    } else if (relativePath.startsWith('.ezra/scans/')) {
      changeType = 'SCAN';
      action = 'CREATED';
    } else if (relativePath.startsWith('.ezra/plans/')) {
      changeType = 'PLAN';
    } else if (relativePath === '.ezra/knowledge.yaml') {
      changeType = 'KNOWLEDGE';
    } else if (relativePath === '.ezra/governance.yaml') {
      changeType = 'GOVERNANCE';
    }

    // Read current version
    const currentPath = path.join(versionsDir, 'current.yaml');
    let version = '1.0.0';
    let totalChanges = 0;

    if (fs.existsSync(currentPath)) {
      const content = fs.readFileSync(currentPath, 'utf8');
      const vMatch = content.match(/version:\s*"?([0-9.]+)"?/);
      const cMatch = content.match(/total_changes:\s*(\d+)/);
      if (vMatch) version = vMatch[1];
      if (cMatch) totalChanges = parseInt(cMatch[1]);
    }

    // Bump patch version
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    const newVersion = parts.join('.');
    totalChanges++;

    // Generate changelog entry
    const now = new Date().toISOString();
    const changeId = `CHG-${String(totalChanges).padStart(4, '0')}`;
    
    const entry = [
      `  - id: ${changeId}`,
      `    timestamp: "${now}"`,
      `    version_before: "${version}"`,
      `    version_after: "${newVersion}"`,
      `    type: ${changeType}`,
      `    action: ${action}`,
      `    target: "${target}"`,
      `    summary: "${changeType} ${action.toLowerCase()}: ${path.basename(filePath)}"`,
      `    triggered_by: auto`,
      ''
    ].join('\n');

    // Append to changelog (with rotation — keep last 1000 entries)
    const changelogPath = path.join(versionsDir, 'changelog.yaml');
    if (!fs.existsSync(changelogPath)) {
      fs.writeFileSync(changelogPath, `# EZRA Changelog — APPEND ONLY\nlog:\n${entry}`);
    } else {
      const existing = fs.readFileSync(changelogPath, 'utf8');
      const entryCount = (existing.match(/  - id: CHG-/g) || []).length;
      if (entryCount > 1000) {
        const lines = existing.split('\n');
        const headerEnd = lines.findIndex(l => l.startsWith('  - id: CHG-'));
        const entryStarts = [];
        lines.forEach((l, i) => { if (l.startsWith('  - id: CHG-')) entryStarts.push(i); });
        const keepFrom = entryStarts[entryStarts.length - 500] || headerEnd;
        const rotated = lines.slice(0, headerEnd).concat(lines.slice(keepFrom)).join('\n');
        fs.writeFileSync(changelogPath, rotated + entry);
      } else {
        fs.appendFileSync(changelogPath, entry);
      }
    }

    // Update current.yaml (minimal — just version and total_changes)
    const currentContent = [
      `version: "${newVersion}"`,
      `updated: "${now}"`,
      `total_changes: ${totalChanges}`,
    ].join('\n');

    // Preserve other fields if they exist
    if (fs.existsSync(currentPath)) {
      const existing = fs.readFileSync(currentPath, 'utf8');
      const lines = existing.split('\n');
      const updated = lines.map(line => {
        if (line.startsWith('version:')) return `version: "${newVersion}"`;
        if (line.startsWith('updated:')) return `updated: "${now}"`;
        if (line.startsWith('total_changes:')) return `total_changes: ${totalChanges}`;
        return line;
      });
      fs.writeFileSync(currentPath, updated.join('\n'));
    } else {
      fs.writeFileSync(currentPath, [
        `version: "${newVersion}"`,
        `created: "${now}"`,
        `updated: "${now}"`,
        `total_changes: ${totalChanges}`,
        '',
        'counts:',
        '  decisions: 0',
        '  documents: 0',
        '  scans: 0',
        '  plans: 0',
        '  risks: 0',
        '  proposals: 0',
        '',
        'integrity:',
        '  last_health_check: "never"',
        '  health_score: null',
        '  governance_compliant: unknown',
      ].join('\n'));
    }

    process.exit(0);

  } catch (err) {
    // Never block work due to hook errors
    const msg = _fmt('VERSION_001', { detail: err.message });
    process.stderr.write(msg + "\n");
    _log(process.cwd(), 'ezra-version-hook', 'warn', msg);
    process.exit(0);
  }
});

module.exports = { MAX_STDIN };
