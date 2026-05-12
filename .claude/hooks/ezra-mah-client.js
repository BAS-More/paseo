#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-agents-module module (v7.0.0)
// Original preserved as ezra-mah-client.js.orig
const mod = require('./ezra-agents-module');

module.exports = {
  MAH_ENDPOINT_DEFAULT: mod.MAH_ENDPOINT_DEFAULT,
  getMahEndpoint: mod.getMahEndpoint,
  routeTask: mod.routeTask,
  routeSecurityAudit: mod.routeSecurityAudit,
  routeArchitectureReview: mod.routeArchitectureReview,
  routeDocumentParse: mod.routeDocumentParse
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
      if (mod._handleSubModule) mod._handleSubModule('mah-client', event);
      else if (mod._handleAs) mod._handleAs('mah-client', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
