#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-agents-module module (v7.0.0)
// Original preserved as ezra-achievement-engine.js.orig
const mod = require('./ezra-agents-module');

module.exports = {
  BUILT_IN_ACHIEVEMENTS: mod.BUILT_IN_ACHIEVEMENTS,
  evaluate: mod.evaluate,
  listAchievements: mod.listAchievements,
  collectMetrics: mod.collectMetrics,
  checkAchievement: mod.checkAchievement,
  loadEarned: mod.loadEarned,
  saveEarned: mod.saveEarned
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
      if (mod._handleSubModule) mod._handleSubModule('achievement-engine', event);
      else if (mod._handleAs) mod._handleAs('achievement-engine', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
