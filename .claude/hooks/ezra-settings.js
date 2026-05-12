#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-config module (v7.0.0)
// Original preserved as ezra-settings.js.orig
const mod = require('./ezra-config');

module.exports = {
  loadSettings: mod.loadSettings,
  getStandards: mod.getStandards,
  getSecurity: mod.getSecurity,
  getOversight: mod.getOversight,
  getBestPractices: mod.getBestPractices,
  getLicensing: mod.getLicensing,
  getPlanning: mod.getPlanning,
  getMemory: mod.getMemory,
  getWorkflows: mod.getWorkflows,
  getSelfLearning: mod.getSelfLearning,
  getProjectManager: mod.getProjectManager,
  getAgents: mod.getAgents,
  getDashboard: mod.getDashboard,
  getCloudSync: mod.getCloudSync,
  getLibrary: mod.getLibrary,
  getNotifications: mod.getNotifications,
  getExecution: mod.getExecution,
  getQuiz2Build: mod.getQuiz2Build,
  getCompliance: mod.getCompliance,
  getGithub: mod.getGithub,
  getDeploy: mod.getDeploy,
  getTesting: mod.getTesting,
  getUiux: mod.getUiux,
  parseYamlSimple: mod.parseYamlSimple,
  parseValue: mod.parseValue,
  deepMerge: mod.deepMerge,
  DEFAULTS: mod.DEFAULTS,
  getDefault: mod.getDefault,
  loadGlobalDefaults: mod.loadGlobalDefaults,
  _invalidateCache: mod._invalidateCache
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
      if (mod._handleSubModule) mod._handleSubModule('settings', event);
      else if (mod._handleAs) mod._handleAs('settings', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
