#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-agents-module module (v7.0.0)
// Original preserved as ezra-agents.js.orig
const mod = require('./ezra-agents-module');

module.exports = {
  SUPPORTED_PROVIDERS: mod.SUPPORTED_PROVIDERS,
  ASSIGNMENT_STRATEGIES: mod.ASSIGNMENT_STRATEGIES,
  SCORING_WEIGHTS: mod.SCORING_WEIGHTS,
  PRICING: mod.PRICING,
  STUB_PROVIDERS: mod.STUB_PROVIDERS,
  createProvider: mod.createProvider,
  createAnthropicProvider: mod.createAnthropicProvider,
  createOpenAIProvider: mod.createOpenAIProvider,
  createStubProvider: mod.createStubProvider,
  createMockProvider: mod.createMockProvider,
  executeWithFallback: mod.executeWithFallback,
  resolveApiKey: mod.resolveApiKey,
  resolveModel: mod.resolveModel,
  calcCost: mod.calcCost,
  setHttpsPost: mod.setHttpsPost,
  loadAgentConfig: mod.loadAgentConfig,
  getAgentRoster: mod.getAgentRoster,
  assignTask: mod.assignTask,
  recordTaskResult: mod.recordTaskResult,
  getAgentPerformance: mod.getAgentPerformance,
  getAgentLeaderboard: mod.getAgentLeaderboard,
  checkBudget: mod.checkBudget,
  writeYaml: mod.writeYaml,
  readYaml: mod.readYaml
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
      if (mod._handleSubModule) mod._handleSubModule('agents', event);
      else if (mod._handleAs) mod._handleAs('agents', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
