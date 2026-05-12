#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-planning module (v7.0.0)
// Original preserved as ezra-phase-suggester.js.orig
const mod = require('./ezra-planning');

module.exports = {
  groupIntoPhases: mod.groupIntoPhases,
  splitIfOverLimit: mod.splitIfOverLimit,
  calculatePhaseComplexity: mod.calculatePhaseComplexity,
  validatePhaseOrdering: mod.validatePhaseOrdering,
  getPhaseName: mod.getPhaseName,
  MAX_HIGH_COMPLEXITY_PER_PHASE: mod.MAX_HIGH_COMPLEXITY_PER_PHASE,
  MAX_TASKS_PER_PHASE: mod.MAX_TASKS_PER_PHASE
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
      if (mod._handleSubModule) mod._handleSubModule('phase-suggester', event);
      else if (mod._handleAs) mod._handleAs('phase-suggester', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
