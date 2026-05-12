#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-devops module (v7.0.0)
// Original preserved as ezra-installer.js.orig
const mod = require('./ezra-devops');

module.exports = {
  HOOK_FILES: mod.HOOK_FILES,
  INSTALL_PATHS: mod.INSTALL_PATHS,
  install: mod.install,
  uninstall: mod.uninstall,
  update: mod.update,
  getInstallStatus: mod.getInstallStatus,
  initProject: mod.initProject,
  getEzraRoot: mod.getEzraRoot
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
      if (mod._handleSubModule) mod._handleSubModule('installer', event);
      else if (mod._handleAs) mod._handleAs('installer', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
