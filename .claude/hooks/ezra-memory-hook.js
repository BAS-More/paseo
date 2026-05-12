#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-memory-module module (v7.0.0)
// Original preserved as ezra-memory-hook.js.orig
const mod = require('./ezra-memory-module');

module.exports = {
  CAPTURE_TRIGGERS: mod.CAPTURE_TRIGGERS,
  MAX_CONTENT_LENGTH: mod.MAX_CONTENT_LENGTH,
  MIN_CONTENT_LENGTH: mod.MIN_CONTENT_LENGTH,
  detectPatterns: mod.detectPatterns,
  extractTags: mod.extractTags,
  processToolOutput: mod.processToolOutput,
  isDuplicate: mod.isDuplicate,
  calculateSimilarity: mod.calculateSimilarity
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
      if (mod._handleSubModule) mod._handleSubModule('ezra-memory-hook', event);
      else if (mod._handleAs) mod._handleAs('ezra-memory-hook', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
