#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-memory-module module (v7.0.0)
// Original preserved as ezra-memory.js.orig
const mod = require('./ezra-memory-module');

module.exports = {
  MEMORY_DIR: mod.MEMORY_DIR,
  MEMORY_INDEX: mod.MEMORY_INDEX,
  MEMORY_TYPES: mod.MEMORY_TYPES,
  MEMORY_PRIORITIES: mod.MEMORY_PRIORITIES,
  MAX_ENTRIES_PER_TYPE: mod.MAX_ENTRIES_PER_TYPE,
  getMemoryDir: mod.getMemoryDir,
  initMemory: mod.initMemory,
  generateId: mod.generateId,
  addMemory: mod.addMemory,
  getMemory: mod.getMemory,
  updateMemory: mod.updateMemory,
  deleteMemory: mod.deleteMemory,
  pruneType: mod.pruneType,
  listMemories: mod.listMemories,
  searchMemory: mod.searchMemory,
  getRelevantMemories: mod.getRelevantMemories,
  updateIndex: mod.updateIndex,
  getMemoryStats: mod.getMemoryStats,
  archiveMemory: mod.archiveMemory,
  getArchivedMemories: mod.getArchivedMemories,
  exportMemories: mod.exportMemories,
  importMemories: mod.importMemories,
  readYaml: mod.readYaml,
  writeYaml: mod.writeYaml
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
      if (mod._handleSubModule) mod._handleSubModule('memory', event);
      else if (mod._handleAs) mod._handleAs('memory', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
