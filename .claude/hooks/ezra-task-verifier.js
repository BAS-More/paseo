#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-planning module (v7.0.0)
// Original preserved as ezra-task-verifier.js.orig
const mod = require('./ezra-planning');

module.exports = {
  VERIFICATION_LEVELS: mod.VERIFICATION_LEVELS,
  checkFileTargetsExist: mod.checkFileTargetsExist,
  checkAcceptanceCriteria: mod.checkAcceptanceCriteria,
  runLintCheck: mod.runLintCheck,
  verifyTask: mod.verifyTask
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
      if (mod._handleSubModule) mod._handleSubModule('task-verifier', event);
      else if (mod._handleAs) mod._handleAs('task-verifier', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
