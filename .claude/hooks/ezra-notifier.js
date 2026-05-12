#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-project-ops module (v7.0.0)
// Original preserved as ezra-notifier.js.orig
const mod = require('./ezra-project-ops');

module.exports = {
  NOTIFICATION_TYPES: mod.NOTIFICATION_TYPES,
  CHANNELS: mod.CHANNELS,
  notify: mod.notify,
  sendEmail: mod.sendEmail,
  sendSlack: mod.sendSlack,
  sendTeams: mod.sendTeams,
  sendDashboard: mod.sendDashboard,
  formatBody: mod.formatBody
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
      if (mod._handleSubModule) mod._handleSubModule('notifier', event);
      else if (mod._handleAs) mod._handleAs('notifier', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
