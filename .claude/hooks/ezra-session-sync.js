#!/usr/bin/env node
'use strict';

/**
 * EZRA Session Sync Hook
 * Runs on Claude Code session start to push current project state to the dashboard.
 * Reads from .ezra/ state and POSTs to the configured dashboard URL.
 * Zero external dependencies.
 */

const MAX_STDIN = 1024 * 1024;

let _log;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    input += d;
    if (input.length > MAX_STDIN) process.exit(0);
  });
  process.stdin.on('end', async () => {
    try {
      const data = JSON.parse(input);
      const projectDir = data.project_dir || data.projectDir || process.cwd();
      const dashData = require('./ezra-dashboard-data');
      const result = await dashData.syncToDashboard(projectDir, 'session_start');

      if (result.synced) {
        process.stderr.write('EZRA [SYNC]: Dashboard synced successfully\n');

        // After successful push, try to pull settings back from dashboard
        try {
          const pullMod = require('./ezra-settings-pull');
          const pullConfig = pullMod.pullSettings(projectDir);
          if (pullConfig.success && pullConfig.url) {
            process.stderr.write('EZRA [SYNC]: Settings pull available at ' + pullConfig.url + '\n');
          }
        } catch (pullErr) {
          // Settings pull is optional — don't block session start
        }
      } else {
        // Silent — don't block session start if sync isn't configured
        if (result.reason && !result.reason.includes('not configured')) {
          process.stderr.write('EZRA [SYNC]: ' + result.reason + '\n');
        }
      }

      _log(projectDir, 'ezra-session-sync', 'info', 'Session sync: ' + (result.synced ? 'OK' : result.reason));
      process.stdout.write(JSON.stringify(result));
    } catch (e) {
      process.stderr.write('EZRA [SYNC]: ' + e.message + '\n');
      process.stdout.write(JSON.stringify({ synced: false, reason: e.message }));
    }
    process.exit(0);
  });
}

module.exports = {};
