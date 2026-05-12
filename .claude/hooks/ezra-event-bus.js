#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-config module (v7.0.0)
// Original preserved as ezra-event-bus.js.orig
const mod = require('./ezra-config');

module.exports = {
  EVENT_TYPES: mod.EVENT_TYPES,
  on: mod.on,
  emit: mod.emit,
  loadQueue: mod.loadQueue,
  persistEvent: mod.persistEvent,
  markProcessed: mod.markProcessed,
  getUnprocessed: mod.getUnprocessed,
  getQueue: mod.getQueue,
  clearQueue: mod.clearQueue
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
      if (mod._handleSubModule) mod._handleSubModule('event-bus', event);
      else if (mod._handleAs) mod._handleAs('event-bus', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
