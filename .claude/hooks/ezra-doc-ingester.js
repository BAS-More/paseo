#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-memory-module module (v7.0.0)
// Original preserved as ezra-doc-ingester.js.orig
const mod = require('./ezra-memory-module');

module.exports = {
  extractSignals: mod.extractSignals,
  ingestFile: mod.ingestFile,
  ingestPaths: mod.ingestPaths,
  SUPPORTED_EXTENSIONS: mod.SUPPORTED_EXTENSIONS,
  BINARY_EXTENSIONS: mod.BINARY_EXTENSIONS,
  TECH_PATTERNS: mod.TECH_PATTERNS
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
      if (mod._handleSubModule) mod._handleSubModule('doc-ingester', event);
      else if (mod._handleAs) mod._handleAs('doc-ingester', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
