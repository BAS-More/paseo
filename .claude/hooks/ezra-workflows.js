#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-devops module (v7.0.0)
// Original preserved as ezra-workflows.js.orig
const mod = require('./ezra-devops');

module.exports = {
  STEP_TYPES: mod.STEP_TYPES,
  STEP_ON_FAILURE: mod.STEP_ON_FAILURE,
  WORKFLOW_STATUSES: mod.WORKFLOW_STATUSES,
  TEMPLATE_DIR: mod.TEMPLATE_DIR,
  PROCESS_DIR: mod.PROCESS_DIR,
  readYaml: mod.readYaml,
  writeYaml: mod.writeYaml,
  parseVal: mod.parseVal,
  parseTemplate: mod.parseTemplate,
  getTemplateDir: mod.getTemplateDir,
  getProcessDir: mod.getProcessDir,
  listTemplates: mod.listTemplates,
  getTemplate: mod.getTemplate,
  validateTemplate: mod.validateTemplate,
  listProcesses: mod.listProcesses,
  createProcess: mod.createProcess,
  deleteProcess: mod.deleteProcess,
  createRun: mod.createRun,
  updateRun: mod.updateRun,
  completeRun: mod.completeRun,
  listRuns: mod.listRuns,
  resolveStepDependencies: mod.resolveStepDependencies,
  evaluateCondition: mod.evaluateCondition,
  composeWorkflow: mod.composeWorkflow,
  getWorkflowStats: mod.getWorkflowStats,
  mapStepToNode: mod.mapStepToNode,
  runWorkflow: mod.runWorkflow
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
      if (mod._handleSubModule) mod._handleSubModule('workflows', event);
      else if (mod._handleAs) mod._handleAs('workflows', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
