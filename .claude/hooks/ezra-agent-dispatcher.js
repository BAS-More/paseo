#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-agents-module module (v7.0.0)
// Original preserved as ezra-agent-dispatcher.js.orig
const mod = require('./ezra-agents-module');

module.exports = {
  SPECIALIST_ROLES: mod.SPECIALIST_ROLES,
  DIRECT_ROLES: mod.DIRECT_ROLES,
  getDispatchStrategy: mod.getDispatchStrategy,
  buildTaskPrompt: mod.buildTaskPrompt,
  dispatchTask: mod.dispatchTask,
  validateTaskResult: mod.validateTaskResult
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
      if (mod._handleSubModule) mod._handleSubModule('agent-dispatcher', event);
      else if (mod._handleAs) mod._handleAs('agent-dispatcher', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
