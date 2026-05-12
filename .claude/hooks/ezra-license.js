#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-integrations module (v7.0.0)
// Original preserved as ezra-license.js.orig
const mod = require('./ezra-integrations');

module.exports = {
  LICENSE_TIERS: mod.LICENSE_TIERS,
  FEATURE_TIER_MAP: mod.FEATURE_TIER_MAP,
  LICENSE_CACHE_FILE: mod.LICENSE_CACHE_FILE,
  CACHE_MAX_DAYS: mod.CACHE_MAX_DAYS,
  TIER_ORDER: mod.TIER_ORDER,
  validateKey: mod.validateKey,
  checkLicense: mod.checkLicense,
  isFeatureAvailable: mod.isFeatureAvailable,
  getLicenseStatus: mod.getLicenseStatus,
  getCachedLicense: mod.getCachedLicense,
  writeLicenseCache: mod.writeLicenseCache,
  computeCacheHmac: mod.computeCacheHmac,
  refreshLicense: mod.refreshLicense,
  readCloudSettings: mod.readCloudSettings,
  tierRank: mod.tierRank
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
      if (mod._handleSubModule) mod._handleSubModule('license', event);
      else if (mod._handleAs) mod._handleAs('license', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
