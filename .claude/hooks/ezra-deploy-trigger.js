#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-devops module (v7.0.0)
// Original preserved as ezra-deploy-trigger.js.orig
const mod = require('./ezra-devops');

module.exports = {
  DEPLOY_TARGETS: mod.DEPLOY_TARGETS,
  triggerDeploy: mod.triggerDeploy,
  triggerVercel: mod.triggerVercel,
  triggerRailway: mod.triggerRailway,
  triggerNetlify: mod.triggerNetlify,
  triggerCustom: mod.triggerCustom
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
      if (mod._handleSubModule) mod._handleSubModule('deploy-trigger', event);
      else if (mod._handleAs) mod._handleAs('deploy-trigger', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
