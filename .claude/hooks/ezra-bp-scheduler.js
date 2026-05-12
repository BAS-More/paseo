#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-integrations module (v7.0.0)
// Original preserved as ezra-bp-scheduler.js.orig
const mod = require('./ezra-integrations');

module.exports = {
  getSchedulerState: mod.getSchedulerState,
  saveSchedulerState: mod.saveSchedulerState,
  isDue: mod.isDue,
  runScheduledFetch: mod.runScheduledFetch,
  getPendingEntries: mod.getPendingEntries,
  approveEntry: mod.approveEntry,
  rejectEntry: mod.rejectEntry,
  FREQUENCIES: mod.FREQUENCIES
};

// Stdin hook protocol passthrough
if (require.main === module) {
  const MAX_STDIN = 1024 * 1024;
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; if (input.length > MAX_STDIN) process.exit(0); });
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      if (mod._handleSubModule) mod._handleSubModule('bp-scheduler', event);
      else if (mod._handleAs) mod._handleAs('bp-scheduler', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
