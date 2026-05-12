#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-config module (v7.0.0)
// Original preserved as ezra-project-definition.js.orig
const mod = require('./ezra-config');

module.exports = {
  validate: mod.validate,
  serialise: mod.serialise,
  load: mod.load,
  save: mod.save,
  SCHEMA: mod.SCHEMA
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
      if (mod._handleSubModule) mod._handleSubModule('project-definition', event);
      else if (mod._handleAs) mod._handleAs('project-definition', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
