#!/usr/bin/env node
'use strict';
// Thin wrapper — delegates to consolidated ezra-planning module (v7.0.0)
// Original preserved as ezra-planner.js.orig
const mod = require('./ezra-planning');

module.exports = {
  PLAN_STAGES: mod.PLAN_STAGES,
  TASK_STATUSES: mod.TASK_STATUSES,
  RISK_LEVELS: mod.RISK_LEVELS,
  PLANS_DIR: mod.PLANS_DIR,
  createPlan: mod.createPlan,
  loadPlan: mod.loadPlan,
  decomposeTasks: mod.decomposeTasks,
  assignTask: mod.assignTask,
  getTaskQueue: mod.getTaskQueue,
  advanceTask: mod.advanceTask,
  runGapCheck: mod.runGapCheck,
  createCheckpoint: mod.createCheckpoint,
  getPlanStatus: mod.getPlanStatus,
  listCheckpoints: mod.listCheckpoints,
  listGapReports: mod.listGapReports,
  deletePlan: mod.deletePlan,
  describePlan: mod.describePlan,
  readYaml: mod.readYaml,
  writeYaml: mod.writeYaml,
  getPlansDir: mod.getPlansDir,
  getCheckpointsDir: mod.getCheckpointsDir,
  getGapReportsDir: mod.getGapReportsDir,
  generateId: mod.generateId,
  createPlanFromDefinition: mod.createPlanFromDefinition,
  lockPlan: mod.lockPlan,
  unlockPlan: mod.unlockPlan,
  addPhaseGate: mod.addPhaseGate
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
      if (mod._handleSubModule) mod._handleSubModule('planner', event);
      else if (mod._handleAs) mod._handleAs('planner', event);
    } catch { /* graceful */ }
    process.exit(0);
  });
}
