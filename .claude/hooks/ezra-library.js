#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-integrations module (v7.0.0)
// Original preserved as ezra-library.js.orig
const mod = require('./ezra-integrations');

module.exports = {
  LIBRARY_CATEGORIES: mod.LIBRARY_CATEGORIES,
  ENTRY_SCHEMA: mod.ENTRY_SCHEMA,
  SEVERITY_LEVELS: mod.SEVERITY_LEVELS,
  initLibrary: mod.initLibrary,
  getCategories: mod.getCategories,
  getEntries: mod.getEntries,
  addEntry: mod.addEntry,
  removeEntry: mod.removeEntry,
  searchLibrary: mod.searchLibrary,
  getRelevant: mod.getRelevant,
  importFromUrl: mod.importFromUrl,
  importFromQuiz2Build: mod.importFromQuiz2Build,
  exportLibrary: mod.exportLibrary,
  serializeEntry: mod.serializeEntry,
  serializeEntries: mod.serializeEntries,
  parseEntries: mod.parseEntries,
  syncFromWeb: mod.syncFromWeb
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
      if (mod._handleSubModule) mod._handleSubModule('library', event);
      else if (mod._handleAs) mod._handleAs('library', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
