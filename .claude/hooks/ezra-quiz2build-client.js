#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-integrations module (v7.0.0)
// Original preserved as ezra-quiz2build-client.js.orig
const mod = require('./ezra-integrations');

module.exports = {
  Q2B_DOCUMENT_TYPES: mod.Q2B_DOCUMENT_TYPES,
  Q2B_DIMENSIONS: mod.Q2B_DIMENSIONS,
  EZRA_DOMAIN_MAP: mod.EZRA_DOMAIN_MAP,
  login: mod.login,
  refreshToken: mod.refreshToken,
  getSession: mod.getSession,
  importScore: mod.importScore,
  importHeatmap: mod.importHeatmap,
  importFacts: mod.importFacts,
  submitFacts: mod.submitFacts,
  calculateScore: mod.calculateScore,
  generateDocument: mod.generateDocument,
  downloadDocument: mod.downloadDocument,
  importDocuments: mod.importDocuments,
  getNextQuestions: mod.getNextQuestions,
  registerGithubAdapter: mod.registerGithubAdapter,
  syncAdapter: mod.syncAdapter,
  heatmapToRiskRegister: mod.heatmapToRiskRegister
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
      if (mod._handleSubModule) mod._handleSubModule('quiz2build-client', event);
      else if (mod._handleAs) mod._handleAs('quiz2build-client', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
