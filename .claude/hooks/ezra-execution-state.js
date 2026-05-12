#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-config module (v7.0.0)
// Original preserved as ezra-execution-state.js.orig
const mod = require('./ezra-config');

module.exports = {
  RUN_DIR: mod.RUN_DIR,
  CURRENT_RUN_FILE: mod.CURRENT_RUN_FILE,
  STATUSES: mod.STATUSES,
  createRun: mod.createRun,
  loadRun: mod.loadRun,
  saveRun: mod.saveRun,
  advanceTask: mod.advanceTask,
  advancePhase: mod.advancePhase,
  checkpoint: mod.checkpoint,
  abortRun: mod.abortRun,
  pauseRun: mod.pauseRun,
  resumeRun: mod.resumeRun,
  completeRun: mod.completeRun,
  recordTaskComplete: mod.recordTaskComplete,
  recordTaskFailed: mod.recordTaskFailed
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
      if (mod._handleSubModule) mod._handleSubModule('execution-state', event);
      else if (mod._handleAs) mod._handleAs('execution-state', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
