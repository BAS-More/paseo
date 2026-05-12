#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-devops module (v7.0.0)
// Original preserved as ezra-workflow-executor.js.orig
const mod = require('./ezra-devops');

module.exports = {
  handleRequest: mod.handleRequest,
  executeNode: mod.executeNode,
  executeTrigger: mod.executeTrigger,
  executeAction: mod.executeAction,
  executeGate: mod.executeGate,
  executeCondition: mod.executeCondition,
  executeNotify: mod.executeNotify,
  isValidProjectDir: mod.isValidProjectDir
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
      if (mod._handleSubModule) mod._handleSubModule('workflow-executor', event);
      else if (mod._handleAs) mod._handleAs('workflow-executor', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
