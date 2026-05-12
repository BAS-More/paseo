#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

/**
 * EZRA Progress Tracking Hook (PostToolUse)
 *
 * Automatically tracks agent progress by monitoring file changes.
 * On every Nth change (configurable), runs milestone checks and
 * stall detection.
 *
 * Non-blocking — provides monitoring only, never denies actions.
 * Always outputs: { hookSpecificOutput: { hookEventName: 'PostToolUse', permissionDecision: 'allow' } }
 * Always exits 0.
 *
 * Install: Add to settings.json under hooks.PostToolUse:
 * {
 *   "matcher": "Write|Edit|MultiEdit",
 *   "hooks": [{
 *     "type": "command",
 *     "command": "node <path>/ezra-progress-hook.js",
 *     "timeout": 5
 *   }]
 * }
 */

const fs = require('fs');
const path = require('path');

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// ─── Load PM module ──────────────────────────────────────────────

let pmModule;
try {
  pmModule = require(path.join(__dirname, 'ezra-pm.js'));
} catch {
  pmModule = null;
}

let settingsModule;
try {
  settingsModule = require(path.join(__dirname, 'ezra-settings.js'));
} catch {
  settingsModule = null;
}

// ─── Helpers ─────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseCheckInterval(interval) {
  if (typeof interval === 'number') return interval;
  const str = String(interval);
  const m = str.match(/every_(\d+)_tasks/);
  return m ? parseInt(m[1], 10) : 5;
}

function getActivityCount(activityPath) {
  if (!fs.existsSync(activityPath)) return 0;
  try {
    const content = fs.readFileSync(activityPath, 'utf8');
    return content.split('\n').filter(l => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

function logActivity(activityPath, filePath, tool) {
  ensureDir(path.dirname(activityPath));
  const entry = `${new Date().toISOString()} | ${tool || 'unknown'} | ${filePath}\n`;
  fs.appendFileSync(activityPath, entry, 'utf8');
}

// ─── Hook Output ─────────────────────────────────────────────────

function hookOutput(extra) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      permissionDecision: 'allow',
    },
  };
  if (extra) {
    output.hookSpecificOutput.progress = extra;
  }
  return output;
}

// ─── Main Hook Logic ─────────────────────────────────────────────

function processEvent(event) {
  const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
  const tool = event.tool_name || 'unknown';
  const cwd = event.cwd || process.cwd();
  const ezraDir = path.join(cwd, '.ezra');

  // Quick exit if EZRA not initialized
  if (!fs.existsSync(ezraDir)) {
    return hookOutput();
  }

  // Skip if no file path
  if (!filePath) {
    return hookOutput();
  }

  // Log activity
  const activityPath = path.join(ezraDir, 'progress', 'activity.log');
  logActivity(activityPath, filePath, tool);

  // Determine check interval
  let checkInterval = 5;
  if (settingsModule) {
    try {
      const pmSettings = settingsModule.getProjectManager(cwd);
      checkInterval = parseCheckInterval(pmSettings.check_interval);
    } catch { /* use default */ }
  }

  // Count activities and check if we should run periodic checks
  const count = getActivityCount(activityPath);
  const extra = { tracked: true, file: filePath, activity_count: count };

  if (count % checkInterval === 0 && pmModule) {
    // Run periodic checks
    try {
      const milestoneResult = pmModule.checkMilestones(cwd);
      const stallResult = pmModule.detectStalls(cwd);

      extra.periodic_check = true;
      extra.milestones = milestoneResult.summary;

      if (stallResult.stalled) {
        extra.stall_warning = stallResult.message;
        // Log to stderr for visibility (non-blocking)
        process.stderr.write(`[EZRA PM] ${stallResult.message}\n`);
      }

      // Check if any milestone was just completed
      if (milestoneResult.milestones) {
        for (const ms of milestoneResult.milestones) {
          if (ms.overall) {
            // Log milestone completion
            const msLogPath = path.join(ezraDir, 'progress', 'milestones.yaml');
            try {
              let content = '';
              if (fs.existsSync(msLogPath)) {
                content = fs.readFileSync(msLogPath, 'utf8');
              }
              if (!content.includes(`completed: true`) || !content.includes(ms.name)) {
                // Milestone newly completed — noted in activity log
                logActivity(activityPath, `MILESTONE_COMPLETED: ${ms.name}`, 'ezra-pm');
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch {
      // Non-blocking — ignore errors in periodic checks
    }
  }

  return hookOutput(extra);
}

// ─── Exports ─────────────────────────────────────────────────────

module.exports = {
  processEvent,
  hookOutput,
  parseCheckInterval,
  getActivityCount,
  logActivity,
};

// ─── Hook Protocol (stdin → stdout → exit 0) ─────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > MAX_STDIN) { process.exit(0); }
});
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      const result = processEvent(event);
      process.stdout.write(JSON.stringify(result));
    } catch {
      const msg = _fmt('PROGRESS_001', { detail: 'Hook protocol error' });
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-progress-hook', 'warn', msg);
      process.stdout.write(JSON.stringify(hookOutput()));
    }
    process.exit(0);
  });
}
