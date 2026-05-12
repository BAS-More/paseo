#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-devops module (v7.0.0)
// Original preserved as ezra-commit-engine.js.orig
const mod = require('./ezra-devops');

module.exports = {
  MAX_FILES_PER_BATCH: mod.MAX_FILES_PER_BATCH,
  PROTECTED_BRANCHES: mod.PROTECTED_BRANCHES,
  COMMIT_TYPES: mod.COMMIT_TYPES,
  SAFE_REF_NAME: mod.SAFE_REF_NAME,
  validateRefName: mod.validateRefName,
  getChangedFiles: mod.getChangedFiles,
  getStagedFiles: mod.getStagedFiles,
  batchFiles: mod.batchFiles,
  batchCommits: mod.batchCommits,
  generateCommitMessage: mod.generateCommitMessage,
  inferCommitType: mod.inferCommitType,
  inferScope: mod.inferScope,
  getCurrentBranch: mod.getCurrentBranch,
  isProtectedBranch: mod.isProtectedBranch,
  commitBatch: mod.commitBatch,
  pushBranch: mod.pushBranch,
  createPR: mod.createPR,
  autoMerge: mod.autoMerge
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
      if (mod._handleSubModule) mod._handleSubModule('commit-engine', event);
      else if (mod._handleAs) mod._handleAs('commit-engine', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
