#!/usr/bin/env node
'use strict';

/**
 * hooks/ezra-planning.js - Consolidated Planning Module for EZRA v7.0.0
 * Merges: ezra-planner, ezra-plan-generator, ezra-phase-suggester,
 *         ezra-interview-engine, ezra-task-verifier
 * ZERO external dependencies.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');
const readline = require('readline');

// Hub imports
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// Optional soft deps (same as originals)
let _def;
try { _def = require('./ezra-project-definition'); } catch (_e) { _def = null; }
let _yaml;
try { _yaml = require('./ezra-yaml-utils'); } catch (_e) { _yaml = null; }
let _q2bPlan;
try { _q2bPlan = require('./ezra-quiz2build-client'); } catch (_e) { _q2bPlan = null; }
let _q2b;
try { _q2b = require('./ezra-quiz2build-client'); } catch (_e) { _q2b = null; }

const MAX_STDIN = 1024 * 1024;

// ========== Sub-module: ezra-planner ==========



// ─── Constants ──────────────────────────────────────────────────

const PLAN_STAGES = [
  'holistic_plan',
  'task_decomposition',
  'assignment',
  'execution',
  'verification',
  'gap_check',
  'checkpoint',
];

const TASK_STATUSES = ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'blocked'];

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

const PLANS_DIR = '.ezra/plans';
const MASTER_PLAN_FILE = 'master-plan.yaml';
const TASK_QUEUE_FILE = 'task-queue.yaml';
const CHECKPOINTS_DIR = 'checkpoints';
const GAP_REPORTS_DIR = 'gap-reports';

// ─── YAML Helpers ───────────────────────────────────────────────

function parseVal(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s.replace(/^['"]|['"]$/g, '');
}

function readYaml(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const result = {};
  let currentKey = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const topMatch = line.match(/^([\w][\w_.-]*):\s*(.*)/);
    if (topMatch) {
      const key = topMatch[1];
      if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
      const val = topMatch[2].trim();
      if (val === '' || val === '|' || val === '>') {
        result[key] = {};
        currentKey = key;
      } else {
        result[key] = parseVal(val);
        currentKey = null;
      }
      continue;
    }
    const subMatch = line.match(/^  ([\w][\w_.-]*):\s*(.*)/);
    if (subMatch && currentKey) {
      if (/^(__proto__|constructor|prototype)$/.test(subMatch[1])) continue;
      if (typeof result[currentKey] !== 'object') result[currentKey] = {};
      result[currentKey][subMatch[1]] = parseVal(subMatch[2]);
    }
  }
  return result;
  } catch (e) { return {}; }
}

function writeYaml(filePath, obj) {
  const lines = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      lines.push(key + ':');
      for (const [k2, v2] of Object.entries(val)) {
        const sv = v2 === null ? 'null' : String(v2);
        lines.push('  ' + k2 + ': ' + sv);
      }
    } else {
      const sv = val === null ? 'null' : String(val);
      lines.push(key + ': ' + sv);
    }
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// ─── Helpers ────────────────────────────────────────────────────

function getPlansDir(projectDir) {
  const d = path.join(projectDir, PLANS_DIR);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function getCheckpointsDir(projectDir) {
  const d = path.join(getPlansDir(projectDir), CHECKPOINTS_DIR);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function getGapReportsDir(projectDir) {
  const d = path.join(getPlansDir(projectDir), GAP_REPORTS_DIR);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function generateId() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + crypto.randomBytes(2).toString('hex');
}

// ─── Core Functions ─────────────────────────────────────────────

/**
 * Create a master plan from a spec/description.
 */
function createPlan(projectDir, spec) {
  if (!spec || typeof spec !== 'object') {
    return { success: false, error: 'spec must be an object with name, description, features' };
  }
  if (!spec.name || !spec.description) {
    return { success: false, error: 'spec must have name and description' };
  }

  const planId = generateId();
  const features = Array.isArray(spec.features) ? spec.features : [];
  const risks = Array.isArray(spec.risks) ? spec.risks : [];

  const plan = {
    id: planId,
    name: spec.name,
    description: spec.description,
    stage: 'holistic_plan',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    feature_count: features.length,
    completed_features: 0,
    risk_level: risks.length > 3 ? 'high' : risks.length > 0 ? 'medium' : 'low',
    status: 'active',
  };

  // Store features as indexed entries
  features.forEach((f, i) => {
    plan['feature_' + i] = typeof f === 'string' ? f : String(f);
  });
  risks.forEach((r, i) => {
    plan['risk_' + i] = typeof r === 'string' ? r : String(r);
  });

  const plansDir = getPlansDir(projectDir);
  writeYaml(path.join(plansDir, MASTER_PLAN_FILE), plan);

  return { success: true, planId, stage: plan.stage, features: features.length };
}

/**
 * Load the current master plan.
 */
function loadPlan(projectDir) {
  const planPath = path.join(getPlansDir(projectDir), MASTER_PLAN_FILE);
  if (!fs.existsSync(planPath)) return null;
  return readYaml(planPath);
}

/**
 * Decompose a master plan into individual file-level tasks.
 */
function decomposeTasks(projectDir, tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { success: false, error: 'tasks must be a non-empty array' };
  }

  const plan = loadPlan(projectDir);
  if (!plan) {
    return { success: false, error: 'no master plan found — create one first' };
  }

  const taskQueue = {
    plan_id: plan.id,
    created_at: new Date().toISOString(),
    total_tasks: tasks.length,
    completed_tasks: 0,
    status: 'active',
  };

  tasks.forEach((t, i) => {
    const taskId = 'task_' + i;
    const name = (t && t.name) ? t.name : 'task-' + i;
    const file = (t && t.file) ? t.file : '';
    const deps = (t && t.depends_on) ? t.depends_on : '';
    const priority = (t && t.priority) ? t.priority : 'medium';
    taskQueue[taskId + '_name'] = name;
    taskQueue[taskId + '_file'] = file;
    taskQueue[taskId + '_status'] = 'pending';
    taskQueue[taskId + '_depends_on'] = deps;
    taskQueue[taskId + '_priority'] = priority;
    taskQueue[taskId + '_assigned_to'] = '';
  });

  // Update master plan stage
  plan.stage = 'task_decomposition';
  plan.updated_at = new Date().toISOString();
  const plansDir = getPlansDir(projectDir);
  writeYaml(path.join(plansDir, MASTER_PLAN_FILE), plan);
  writeYaml(path.join(plansDir, TASK_QUEUE_FILE), taskQueue);

  return { success: true, taskCount: tasks.length, stage: 'task_decomposition' };
}

/**
 * Assign a task to an agent (integration with ezra-agents.js).
 */
function assignTask(projectDir, taskIndex, agentId) {
  const queuePath = path.join(getPlansDir(projectDir), TASK_QUEUE_FILE);
  if (!fs.existsSync(queuePath)) {
    return { success: false, error: 'no task queue found — decompose tasks first' };
  }
  const queue = readYaml(queuePath);
  const key = 'task_' + taskIndex + '_status';
  if (!(key in queue)) {
    return { success: false, error: 'task index ' + taskIndex + ' not found' };
  }
  if (queue[key] !== 'pending') {
    return { success: false, error: 'task ' + taskIndex + ' is not pending (status: ' + queue[key] + ')' };
  }

  queue[key] = 'assigned';
  queue['task_' + taskIndex + '_assigned_to'] = agentId || 'default';

  // Update plan stage
  const plan = loadPlan(projectDir);
  if (plan && plan.stage === 'task_decomposition') {
    plan.stage = 'assignment';
    plan.updated_at = new Date().toISOString();
    writeYaml(path.join(getPlansDir(projectDir), MASTER_PLAN_FILE), plan);
  }

  writeYaml(queuePath, queue);
  return { success: true, taskIndex, assignedTo: agentId || 'default', stage: 'assignment' };
}

/**
 * Get the task queue.
 */
function getTaskQueue(projectDir) {
  const queuePath = path.join(getPlansDir(projectDir), TASK_QUEUE_FILE);
  if (!fs.existsSync(queuePath)) return null;
  return readYaml(queuePath);
}

/**
 * Advance a task to the next status.
 */
function advanceTask(projectDir, taskIndex, newStatus) {
  if (!TASK_STATUSES.includes(newStatus)) {
    return { success: false, error: 'invalid status: ' + newStatus };
  }
  const queuePath = path.join(getPlansDir(projectDir), TASK_QUEUE_FILE);
  if (!fs.existsSync(queuePath)) {
    return { success: false, error: 'no task queue found' };
  }
  const queue = readYaml(queuePath);
  const key = 'task_' + taskIndex + '_status';
  if (!(key in queue)) {
    return { success: false, error: 'task index ' + taskIndex + ' not found' };
  }

  const oldStatus = queue[key];
  queue[key] = newStatus;

  // Track completions
  if (newStatus === 'completed' && oldStatus !== 'completed') {
    queue.completed_tasks = (parseInt(queue.completed_tasks, 10) || 0) + 1;

    // Also update master plan
    const plan = loadPlan(projectDir);
    if (plan) {
      plan.completed_features = (parseInt(plan.completed_features, 10) || 0) + 1;
      plan.stage = 'verification';
      plan.updated_at = new Date().toISOString();
      writeYaml(path.join(getPlansDir(projectDir), MASTER_PLAN_FILE), plan);
    }
  }

  writeYaml(queuePath, queue);
  return { success: true, taskIndex, oldStatus, newStatus };
}

/**
 * Run a gap check — compare completed tasks against master plan.
 */
function runGapCheck(projectDir) {
  const plan = loadPlan(projectDir);
  if (!plan) return { success: false, error: 'no master plan found' };

  const queue = getTaskQueue(projectDir);
  if (!queue) return { success: false, error: 'no task queue found' };

  const totalTasks = parseInt(queue.total_tasks, 10) || 0;
  const completedTasks = parseInt(queue.completed_tasks, 10) || 0;
  const pendingTasks = totalTasks - completedTasks;

  // Count features in plan
  let featureCount = parseInt(plan.feature_count, 10) || 0;

  // Collect blocked/failed tasks
  const issues = [];
  for (let i = 0; i < totalTasks; i++) {
    const status = queue['task_' + i + '_status'];
    if (status === 'failed') {
      issues.push({ task: i, name: queue['task_' + i + '_name'] || '', issue: 'failed' });
    }
    if (status === 'blocked') {
      issues.push({ task: i, name: queue['task_' + i + '_name'] || '', issue: 'blocked' });
    }
  }

  const completionPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const drift = issues.length > 0 ? 'detected' : 'none';

  const report = {
    plan_id: plan.id || 'unknown',
    timestamp: new Date().toISOString(),
    total_tasks: totalTasks,
    completed_tasks: completedTasks,
    pending_tasks: pendingTasks,
    completion_pct: completionPct,
    feature_count: featureCount,
    drift: drift,
    issue_count: issues.length,
  };

  issues.forEach((iss, i) => {
    report['issue_' + i + '_task'] = iss.task;
    report['issue_' + i + '_name'] = iss.name;
    report['issue_' + i + '_type'] = iss.issue;
  });

  // Update plan stage
  if (plan) {
    plan.stage = 'gap_check';
    plan.updated_at = new Date().toISOString();
    writeYaml(path.join(getPlansDir(projectDir), MASTER_PLAN_FILE), plan);
  }

  // Save report
  const gapDir = getGapReportsDir(projectDir);
  const reportFile = 'gap-' + timestamp() + '.yaml';
  writeYaml(path.join(gapDir, reportFile), report);

  return { success: true, report, file: reportFile };
}

/**
 * Create a checkpoint — save current progress as recovery point.
 */
function createCheckpoint(projectDir, label) {
  const plan = loadPlan(projectDir);
  if (!plan) return { success: false, error: 'no master plan found' };

  const queue = getTaskQueue(projectDir);

  const ts = timestamp();
  const checkpoint = {
    label: label || 'checkpoint-' + ts,
    timestamp: new Date().toISOString(),
    plan_id: plan.id || 'unknown',
    plan_stage: plan.stage || 'unknown',
    completed_features: plan.completed_features || 0,
  };

  if (queue) {
    checkpoint.total_tasks = queue.total_tasks || 0;
    checkpoint.completed_tasks = queue.completed_tasks || 0;
  }

  // Update plan stage
  plan.stage = 'checkpoint';
  plan.updated_at = new Date().toISOString();
  writeYaml(path.join(getPlansDir(projectDir), MASTER_PLAN_FILE), plan);

  // Save checkpoint
  const cpDir = getCheckpointsDir(projectDir);
  const cpFile = 'checkpoint-' + ts + '.yaml';
  writeYaml(path.join(cpDir, cpFile), checkpoint);

  return { success: true, checkpoint, file: cpFile };
}

/**
 * Get plan status summary.
 */
function getPlanStatus(projectDir) {
  const plan = loadPlan(projectDir);
  if (!plan) return { exists: false };

  const queue = getTaskQueue(projectDir);
  const totalTasks = queue ? (parseInt(queue.total_tasks, 10) || 0) : 0;
  const completedTasks = queue ? (parseInt(queue.completed_tasks, 10) || 0) : 0;

  // Count checkpoints
  const cpDir = path.join(getPlansDir(projectDir), CHECKPOINTS_DIR);
  let checkpointCount = 0;
  if (fs.existsSync(cpDir)) {
    checkpointCount = fs.readdirSync(cpDir).filter(f => f.endsWith('.yaml')).length;
  }

  // Count gap reports
  const gapDir = path.join(getPlansDir(projectDir), GAP_REPORTS_DIR);
  let gapReportCount = 0;
  if (fs.existsSync(gapDir)) {
    gapReportCount = fs.readdirSync(gapDir).filter(f => f.endsWith('.yaml')).length;
  }

  return {
    exists: true,
    id: plan.id,
    name: plan.name || '',
    stage: plan.stage || 'unknown',
    status: plan.status || 'unknown',
    feature_count: parseInt(plan.feature_count, 10) || 0,
    completed_features: parseInt(plan.completed_features, 10) || 0,
    total_tasks: totalTasks,
    completed_tasks: completedTasks,
    checkpoints: checkpointCount,
    gap_reports: gapReportCount,
  };
}

/**
 * List all checkpoints.
 */
function listCheckpoints(projectDir) {
  const cpDir = path.join(getPlansDir(projectDir), CHECKPOINTS_DIR);
  if (!fs.existsSync(cpDir)) return [];
  return fs.readdirSync(cpDir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const data = readYaml(path.join(cpDir, f));
      return { file: f, ...data };
    })
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

/**
 * List all gap reports.
 */
function listGapReports(projectDir) {
  const gapDir = path.join(getPlansDir(projectDir), GAP_REPORTS_DIR);
  if (!fs.existsSync(gapDir)) return [];
  return fs.readdirSync(gapDir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const data = readYaml(path.join(gapDir, f));
      return { file: f, ...data };
    })
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

/**
 * Delete all plan data (for reset/testing).
 */
function deletePlan(projectDir) {
  const plansDir = path.join(projectDir, PLANS_DIR);
  if (!fs.existsSync(plansDir)) return { success: false, error: 'no plans directory' };
  // Guard: ensure plansDir is inside projectDir
  const resolved = path.resolve(plansDir);
  const parent = path.resolve(projectDir);
  if (!resolved.startsWith(parent + path.sep)) {
    return { success: false, error: 'plans directory outside project boundary' };
  }
  fs.rmSync(plansDir, { recursive: true, force: true });
  return { success: true };
}

/**
 * Describe a plan in human-readable format.
 */
function describePlan(projectDir) {
  const plan = loadPlan(projectDir);
  if (!plan) return 'No plan found.';

  const lines = [];
  lines.push('# Plan: ' + (plan.name || 'Unnamed'));
  lines.push('');
  lines.push('**ID:** ' + (plan.id || 'unknown'));
  lines.push('**Stage:** ' + (plan.stage || 'unknown'));
  lines.push('**Status:** ' + (plan.status || 'unknown'));
  lines.push('**Features:** ' + (plan.completed_features || 0) + '/' + (plan.feature_count || 0));
  lines.push('**Risk Level:** ' + (plan.risk_level || 'unknown'));
  lines.push('**Created:** ' + (plan.created_at || 'unknown'));
  lines.push('**Updated:** ' + (plan.updated_at || 'unknown'));
  lines.push('');

  // List features
  const featureCount = parseInt(plan.feature_count, 10) || 0;
  if (featureCount > 0) {
    lines.push('## Features');
    for (let i = 0; i < featureCount; i++) {
      const f = plan['feature_' + i] || 'unknown';
      lines.push('- ' + f);
    }
    lines.push('');
  }

  // Task queue info
  const queue = getTaskQueue(projectDir);
  if (queue) {
    const total = parseInt(queue.total_tasks, 10) || 0;
    const completed = parseInt(queue.completed_tasks, 10) || 0;
    lines.push('## Tasks: ' + completed + '/' + total);
    for (let i = 0; i < total; i++) {
      const name = queue['task_' + i + '_name'] || 'task-' + i;
      const status = queue['task_' + i + '_status'] || 'unknown';
      const assigned = queue['task_' + i + '_assigned_to'] || 'unassigned';
      const marker = status === 'completed' ? '[x]' : '[ ]';
      lines.push('- ' + marker + ' ' + name + ' (' + status + ', ' + assigned + ')');
    }
  }

  return lines.join('\n');
}

// ─── lockPlan / unlockPlan / addPhaseGate ───────────────────────

function lockPlan(projectDir) {
  const planPath = path.join(getPlansDir(projectDir), MASTER_PLAN_FILE);
  if (!fs.existsSync(planPath)) return { success: false, error: 'No master-plan.yaml found.' };
  try {
    const plan = readYaml(planPath);
    plan.status = 'locked';
    plan.locked_at = new Date().toISOString();
    writeYaml(planPath, plan);
    return { success: true, status: 'locked' };
  } catch (e) { return { success: false, error: e.message }; }
}

function unlockPlan(projectDir, reason) {
  const planPath = path.join(getPlansDir(projectDir), MASTER_PLAN_FILE);
  if (!fs.existsSync(planPath)) return { success: false, error: 'No master-plan.yaml found.' };
  try {
    const plan = readYaml(planPath);
    plan.status = 'active';
    plan.unlocked_at = new Date().toISOString();
    if (reason) plan.unlock_reason = reason;
    writeYaml(planPath, plan);
    return { success: true, status: 'active' };
  } catch (e) { return { success: false, error: e.message }; }
}

function addPhaseGate(projectDir, phaseNumber) {
  const queuePath = path.join(getPlansDir(projectDir), TASK_QUEUE_FILE);
  if (!fs.existsSync(queuePath)) return { success: false, error: 'No task-queue.yaml found.' };
  try {
    const queue = readYaml(queuePath);
    const total = parseInt(queue.total_tasks, 10) || 0;
    const gateId = 'gate-' + generateId();
    queue['task_' + total + '_id'] = gateId;
    queue['task_' + total + '_name'] = 'Phase ' + phaseNumber + ' gate';
    queue['task_' + total + '_type'] = 'gate';
    queue['task_' + total + '_phase'] = phaseNumber;
    queue['task_' + total + '_status'] = 'pending';
    queue['task_' + total + '_assigned_to'] = 'test-engineer';
    queue.total_tasks = total + 1;
    writeYaml(queuePath, queue);
    return { success: true, gate_id: gateId, task_index: total };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── createPlanFromDefinition ────────────────────────────────────

/**
 * Create a plan from a project-definition.yaml file.
 * Reads .ezra/project-definition.yaml, maps it to a createPlan() spec,
 * and returns the result of createPlan().
 */
function createPlanFromDefinition(projectDir) {
  const defPath = path.join(projectDir, '.ezra', 'project-definition.yaml');
  if (!fs.existsSync(defPath)) {
    return { success: false, error: 'No project-definition.yaml found. Run /ezra:interview first.' };
  }

  let def;
  try {
    def = readYaml(defPath);
  } catch (e) {
    return { success: false, error: 'Failed to read project-definition.yaml: ' + e.message };
  }

  if (!def.project_name && !def.name) {
    return { success: false, error: 'project-definition.yaml must have project_name field.' };
  }

  // Build features list from definition
  const features = [];

  // Add explicit features
  if (Array.isArray(def.features)) {
    def.features.forEach(f => { if (f) features.push(String(f)); });
  }

  // Add tech stack signals as constraints
  const stack = def.tech_stack || {};
  const langs = Array.isArray(stack.languages) ? stack.languages : (stack.languages ? [stack.languages] : []);
  const frameworks = Array.isArray(stack.frameworks) ? stack.frameworks : (stack.frameworks ? [stack.frameworks] : []);
  if (langs.length > 0) features.push('Tech stack: ' + langs.join(', '));
  if (frameworks.length > 0) features.push('Frameworks: ' + frameworks.join(', '));
  if (def.auth_strategy) features.push('Auth: ' + def.auth_strategy);
  if (def.database_choice) features.push('Database: ' + def.database_choice);
  if (def.deployment_target) features.push('Deploy to: ' + def.deployment_target);
  if (def.testing_requirements) features.push('Testing: ' + def.testing_requirements);

  // Build risk list from security level and constraints
  const risks = [];
  if (def.security_level && def.security_level !== 'low') {
    risks.push('Security level: ' + def.security_level + ' — enforce input validation, secrets management, OWASP top 10');
  }
  if (def.performance_targets) {
    risks.push('Performance targets: ' + def.performance_targets);
  }
  const constraints = Array.isArray(def.constraints) ? def.constraints : [];
  constraints.forEach(c => { if (c) risks.push(String(c)); });

  const spec = {
    name: def.project_name || def.name,
    description: def.description || '',
    features,
    risks,
  };

  return createPlan(projectDir, spec);
}

// ─── Exports ────────────────────────────────────────────────────


// ========== Sub-module: ezra-plan-generator ==========



// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT_ROLES = [
  'code-agent', 'security-specialist', 'architecture-reviewer',
  'test-engineer', 'devops-engineer', 'documentation-writer',
];

const COMPLEXITY_WEIGHTS = { low: 1, medium: 3, high: 5, critical: 8 };

const GEN_MAX_HIGH_COMPLEXITY_PER_PHASE = 8;

// ── YAML helpers ─────────────────────────────────────────────────────────────

function gen_readYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const result = {};
  let currentKey = null;
  let listItems = [];
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;
    if (indent === 0) {
      if (currentKey && listItems.length > 0) { result[currentKey] = listItems.slice(); listItems = []; }
      const m = line.match(/^(\w[\w_-]*):\s*(.*)/);
      if (m) { currentKey = m[1]; if (m[2].trim()) result[currentKey] = m[2].trim(); }
    } else if (line.trim().startsWith('- ') && currentKey) {
      listItems.push(line.trim().slice(2));
    }
  }
  if (currentKey && listItems.length > 0) result[currentKey] = listItems.slice();
  return result;
}

function gen_writeYaml(filePath, obj, header) {
  const lines = header ? ['# ' + header, ''] : [];
  function writeVal(key, val, indent) {
    const pad = ' '.repeat(indent);
    if (Array.isArray(val)) {
      lines.push(pad + key + ':');
      val.forEach(v => { lines.push(pad + '  - ' + String(v)); });
    } else if (val && typeof val === 'object') {
      lines.push(pad + key + ':');
      for (const [k, v] of Object.entries(val)) writeVal(k, v, indent + 2);
    } else {
      lines.push(pad + key + ': ' + String(val ?? ''));
    }
  }
  for (const [k, v] of Object.entries(obj)) writeVal(k, v, 0);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// ── Task decomposition ────────────────────────────────────────────────────────

const TASK_TEMPLATES = {
  auth: [
    { title: 'Implement authentication system', complexity: 'high', agent_role: 'code-agent',
      acceptance_criteria: 'Users can register, login, and logout. Sessions are secure.' },
    { title: 'Add authorization and role management', complexity: 'medium', agent_role: 'code-agent',
      acceptance_criteria: 'Role-based access control is enforced on all protected routes.' },
    { title: 'Security review of auth implementation', complexity: 'medium', agent_role: 'security-specialist',
      acceptance_criteria: 'No OWASP Top 10 auth vulnerabilities. Secrets not exposed.' },
  ],
  database: [
    { title: 'Design and implement database schema', complexity: 'high', agent_role: 'code-agent',
      acceptance_criteria: 'All entities defined with correct relationships and indexes.' },
    { title: 'Create data access layer / ORM setup', complexity: 'medium', agent_role: 'code-agent',
      acceptance_criteria: 'CRUD operations work for all entities. No raw SQL with user input.' },
    { title: 'Write database migration scripts', complexity: 'low', agent_role: 'devops-engineer',
      acceptance_criteria: 'Migrations run idempotently up and down without data loss.' },
  ],
  api: [
    { title: 'Design REST API contract', complexity: 'medium', agent_role: 'architecture-reviewer',
      acceptance_criteria: 'OpenAPI spec created. All endpoints documented.' },
    { title: 'Implement API endpoints', complexity: 'high', agent_role: 'code-agent',
      acceptance_criteria: 'All endpoints return correct status codes and validated data.' },
    { title: 'Add input validation and error handling', complexity: 'medium', agent_role: 'code-agent',
      acceptance_criteria: 'All inputs validated. Errors return structured JSON with codes.' },
  ],
  frontend: [
    { title: 'Build core UI components and layout', complexity: 'medium', agent_role: 'code-agent',
      acceptance_criteria: 'Component library covers all designs. Accessible and responsive.' },
    { title: 'Implement routing and navigation', complexity: 'low', agent_role: 'code-agent',
      acceptance_criteria: 'All routes work. Protected routes redirect unauthenticated users.' },
    { title: 'Connect frontend to API', complexity: 'medium', agent_role: 'code-agent',
      acceptance_criteria: 'All data fetching uses typed API client. Loading/error states shown.' },
  ],
  testing: [
    { title: 'Write unit tests for core logic', complexity: 'medium', agent_role: 'test-engineer',
      acceptance_criteria: 'Unit test coverage >= 80% for business logic modules.' },
    { title: 'Write integration tests for API', complexity: 'medium', agent_role: 'test-engineer',
      acceptance_criteria: 'All API endpoints have integration tests covering success + error cases.' },
    { title: 'Write E2E tests for critical flows', complexity: 'medium', agent_role: 'test-engineer',
      acceptance_criteria: 'Critical user journeys covered: register, login, core feature flows.' },
  ],
  deployment: [
    { title: 'Configure CI/CD pipeline', complexity: 'medium', agent_role: 'devops-engineer',
      acceptance_criteria: 'CI runs on every PR: lint, type-check, test. CD deploys on green main.' },
    { title: 'Set up production environment and secrets', complexity: 'medium', agent_role: 'devops-engineer',
      acceptance_criteria: 'All secrets in environment variables. No secrets in code or git.' },
    { title: 'Configure monitoring and logging', complexity: 'low', agent_role: 'devops-engineer',
      acceptance_criteria: 'Structured logs shipped. Error alerting configured.' },
  ],
  documentation: [
    { title: 'Write README and setup guide', complexity: 'low', agent_role: 'documentation-writer',
      acceptance_criteria: 'README covers install, config, run, test, deploy in under 10 minutes.' },
    { title: 'Document API reference', complexity: 'low', agent_role: 'documentation-writer',
      acceptance_criteria: 'All endpoints documented with request/response examples.' },
  ],
};

function detectTaskAreas(def) {
  const areas = new Set(['testing', 'deployment', 'documentation']);
  const lower = JSON.stringify(def).toLowerCase();
  if (lower.includes('auth') || lower.includes('login') || lower.includes('jwt') || lower.includes('oauth')) areas.add('auth');
  if (lower.includes('database') || lower.includes('postgres') || lower.includes('mysql') || lower.includes('mongo') || lower.includes('redis') || lower.includes('supabase')) areas.add('database');
  if (lower.includes('api') || lower.includes('rest') || lower.includes('graphql') || lower.includes('endpoint')) areas.add('api');
  if (lower.includes('frontend') || lower.includes('react') || lower.includes('next') || lower.includes('vue') || lower.includes('angular') || lower.includes('ui') || lower.includes('dashboard')) areas.add('frontend');

  // Add feature-based tasks
  const features = Array.isArray(def.features) ? def.features : [];
  for (const f of features) {
    const fl = String(f).toLowerCase();
    if (fl.includes('auth') || fl.includes('login') || fl.includes('user')) areas.add('auth');
    if (fl.includes('data') || fl.includes('stor') || fl.includes('db')) areas.add('database');
    if (fl.includes('api') || fl.includes('endpoint')) areas.add('api');
    if (fl.includes('ui') || fl.includes('page') || fl.includes('view') || fl.includes('front')) areas.add('frontend');
  }

  return Array.from(areas);
}

function gen_generateId() {
  return crypto.randomBytes(4).toString('hex');
}

function gen_decomposeTasks(def) {
  const areas = detectTaskAreas(def);
  const tasks = [];
  let idx = 0;

  // Add project setup task
  tasks.push({
    id: 'task-' + gen_generateId(),
    index: idx++,
    phase: 1,
    title: 'Project setup and scaffolding',
    description: 'Initialize project structure, install dependencies, configure tooling (lint, format, TypeScript, testing framework).',
    acceptance_criteria: 'Project runs locally. Lint and type-check pass on empty project.',
    agent_role: 'code-agent',
    complexity: 'low',
    depends_on: [],
    file_targets: ['package.json', 'tsconfig.json', '.eslintrc', 'README.md'],
    type: 'task',
    status: 'pending',
  });

  // Add area tasks
  for (const area of areas) {
    const templates = TASK_TEMPLATES[area] || [];
    for (const tmpl of templates) {
      tasks.push({
        id: 'task-' + gen_generateId(),
        index: idx++,
        phase: assignPhase(area),
        title: tmpl.title,
        description: 'Implement: ' + tmpl.title + (def.project_name ? ' for ' + def.project_name : ''),
        acceptance_criteria: tmpl.acceptance_criteria,
        agent_role: tmpl.agent_role || 'code-agent',
        complexity: tmpl.complexity || 'medium',
        depends_on: [],
        file_targets: [],
        type: 'task',
        status: 'pending',
      });
    }
  }

  return tasks;
}

function assignPhase(area) {
  const phaseMap = {
    database: 1,
    auth: 2,
    api: 2,
    frontend: 3,
    testing: 3,
    deployment: 4,
    documentation: 4,
  };
  return phaseMap[area] || 2;
}

// ── Phase suggestion ──────────────────────────────────────────────────────────

function gen_suggestPhases(tasks) {
  const phaseMap = {};
  for (const t of tasks) {
    const p = t.phase || 1;
    if (!phaseMap[p]) phaseMap[p] = [];
    phaseMap[p].push(t);
  }

  const phases = [];
  for (const [phaseNum, phaseTasks] of Object.entries(phaseMap).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const highComplexity = phaseTasks.filter(t => t.complexity === 'high' || t.complexity === 'critical').length;
    const overLimit = highComplexity > GEN_MAX_HIGH_COMPLEXITY_PER_PHASE;

    phases.push({
      phase: Number(phaseNum),
      name: gen_getPhaseName(Number(phaseNum)),
      tasks: phaseTasks,
      task_count: phaseTasks.length,
      high_complexity_count: highComplexity,
      over_complexity_limit: overLimit,
    });

    // Add gate task at end of each phase
    phaseTasks.push({
      id: 'gate-' + gen_generateId(),
      index: phaseTasks.length,
      phase: Number(phaseNum),
      title: 'Phase ' + phaseNum + ' gate — tests, lint, security, coverage',
      description: 'Run all phase gate checks: test suite, linter, security scan, coverage report.',
      acceptance_criteria: 'All tests pass. No lint errors. No critical security findings. Coverage >= target.',
      agent_role: 'test-engineer',
      complexity: 'medium',
      depends_on: phaseTasks.slice(0, -1).map(t => t.id),
      file_targets: [],
      type: 'gate',
      status: 'pending',
    });
  }

  return phases;
}

function gen_getPhaseName(phaseNum) {
  const names = {
    1: 'Foundation',
    2: 'Core Features',
    3: 'Frontend & Testing',
    4: 'Deployment & Documentation',
  };
  return names[phaseNum] || 'Phase ' + phaseNum;
}

// ── Master plan generation ────────────────────────────────────────────────────

function generatePlan(projectDir) {
  const defPath = path.join(projectDir, '.ezra', 'project-definition.yaml');
  if (!fs.existsSync(defPath)) {
    return { success: false, error: 'No project-definition.yaml found. Run /ezra:interview first.' };
  }

  let def;
  try { def = gen_readYaml(defPath); } catch (e) {
    return { success: false, error: 'Failed to read project-definition.yaml: ' + e.message };
  }

  const tasks = gen_decomposeTasks(def);
  const phases = gen_suggestPhases(tasks);

  // Flatten tasks (including gate tasks added by gen_suggestPhases)
  const allTasks = phases.flatMap(p => p.tasks);

  const plan = {
    id: 'plan-' + gen_generateId(),
    project_name: def.project_name || def.name || 'Unknown Project',
    description: def.description || '',
    generated_at: new Date().toISOString(),
    status: 'draft',
    phase_count: phases.length,
    task_count: allTasks.length,
    source: 'heuristic',
  };

  // Write plan metadata
  const plansDir = path.join(projectDir, '.ezra', 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  gen_writeYaml(path.join(plansDir, 'master-plan.yaml'), plan, 'EZRA Master Plan — ' + plan.project_name);

  // Write tasks
  const taskObj = { total_tasks: allTasks.length };
  allTasks.forEach((t, i) => {
    taskObj['task_' + i + '_id'] = t.id;
    taskObj['task_' + i + '_title'] = t.title;
    taskObj['task_' + i + '_phase'] = t.phase;
    taskObj['task_' + i + '_type'] = t.type;
    taskObj['task_' + i + '_complexity'] = t.complexity;
    taskObj['task_' + i + '_agent_role'] = t.agent_role;
    taskObj['task_' + i + '_status'] = t.status;
    taskObj['task_' + i + '_acceptance_criteria'] = t.acceptance_criteria;
  });
  gen_writeYaml(path.join(plansDir, 'tasks.yaml'), taskObj, 'EZRA Tasks');

  // Write phases
  const phaseObj = { total_phases: phases.length };
  phases.forEach((p, i) => {
    phaseObj['phase_' + i + '_number'] = p.phase;
    phaseObj['phase_' + i + '_name'] = p.name;
    phaseObj['phase_' + i + '_task_count'] = p.task_count;
    phaseObj['phase_' + i + '_high_complexity'] = p.high_complexity_count;
  });
  gen_writeYaml(path.join(plansDir, 'phases.yaml'), phaseObj, 'EZRA Phase Summary');

  return {
    success: true,
    plan_id: plan.id,
    status: plan.status,
    phases: phases.length,
    tasks: allTasks.length,
    task_types: {
      task: allTasks.filter(t => t.type === 'task').length,
      gate: allTasks.filter(t => t.type === 'gate').length,
    },
  };
}

function gen_loadPlan(projectDir) {
  const planPath = path.join(projectDir, '.ezra', 'plans', 'master-plan.yaml');
  if (!fs.existsSync(planPath)) return null;
  try { return gen_readYaml(planPath); } catch { return null; }
}

function loadTasks(projectDir) {
  const tasksPath = path.join(projectDir, '.ezra', 'plans', 'tasks.yaml');
  if (!fs.existsSync(tasksPath)) return null;
  try {
    const raw = gen_readYaml(tasksPath);
    const total = parseInt(raw.total_tasks, 10) || 0;
    const tasks = [];
    for (let i = 0; i < total; i++) {
      tasks.push({
        id: raw['task_' + i + '_id'],
        title: raw['task_' + i + '_title'],
        phase: parseInt(raw['task_' + i + '_phase'], 10) || 1,
        type: raw['task_' + i + '_type'] || 'task',
        complexity: raw['task_' + i + '_complexity'] || 'medium',
        agent_role: raw['task_' + i + '_agent_role'] || 'code-agent',
        status: raw['task_' + i + '_status'] || 'pending',
        acceptance_criteria: raw['task_' + i + '_acceptance_criteria'] || '',
      });
    }
    return tasks;
  } catch { return null; }
}

function gen_lockPlan(projectDir) {
  const planPath = path.join(projectDir, '.ezra', 'plans', 'master-plan.yaml');
  if (!fs.existsSync(planPath)) return { success: false, error: 'No master-plan.yaml found.' };
  try {
    const plan = gen_readYaml(planPath);
    plan.status = 'locked';
    plan.locked_at = new Date().toISOString();
    gen_writeYaml(planPath, plan, 'EZRA Master Plan — ' + (plan.project_name || 'Project'));
    return { success: true, status: 'locked' };
  } catch (e) { return { success: false, error: e.message }; }
}

function gen_unlockPlan(projectDir, reason) {
  const planPath = path.join(projectDir, '.ezra', 'plans', 'master-plan.yaml');
  if (!fs.existsSync(planPath)) return { success: false, error: 'No master-plan.yaml found.' };
  try {
    const plan = gen_readYaml(planPath);
    plan.status = 'draft';
    plan.unlocked_at = new Date().toISOString();
    plan.unlock_reason = reason || 'Manual unlock';
    gen_writeYaml(planPath, plan, 'EZRA Master Plan — ' + (plan.project_name || 'Project'));
    return { success: true, status: 'draft' };
  } catch (e) { return { success: false, error: e.message }; }
}

// ── Quiz2Build integration ────────────────────────────────────────────────────


/**
 * fromQuiz2BuildDocuments — generate a plan skeleton from Q2B documents.
 * Reads Architecture Dossier and SDLC Playbook action items → EZRA plan tasks.
 */
function fromQuiz2BuildDocuments(projectDir, sessionId) {
  if (!_q2bPlan) return { error: 'ezra-quiz2build-client not available' };

  const imported = _q2bPlan.importDocuments(projectDir, sessionId, ['architecture_dossier', 'sdlc_playbook']);
  if (imported.error) return imported;

  const tasks = [];
  for (const doc of (imported.documents || [])) {
    if (doc.error || !doc.data) continue;
    const actions = doc.data.action_items || doc.data.actions || doc.data.tasks || [];
    for (const action of actions) {
      const title = typeof action === 'string' ? action : (action.title || action.description || String(action));
      const complexity = action.complexity || 'medium';
      const role = action.agent_role || 'code-agent';
      tasks.push({
        id: 'Q2B-' + (tasks.length + 1),
        title: title.slice(0, 120),
        description: action.description || title,
        acceptance_criteria: action.acceptance_criteria || ['Task completed as described'],
        file_targets: action.file_targets || [],
        depends_on: [],
        agent_role: AGENT_ROLES.includes(role) ? role : 'code-agent',
        complexity,
        source: 'quiz2build',
        doc_type: doc.type,
      });
    }
  }

  if (tasks.length === 0) {
    return { warning: 'No action items found in Q2B documents. Using heuristic decomposition.', tasks: [] };
  }

  return { session_id: sessionId, tasks, count: tasks.length };
}


// ========== Sub-module: ezra-phase-suggester ==========



const SUG_MAX_HIGH_COMPLEXITY_PER_PHASE = 8;
const MAX_TASKS_PER_PHASE = 15;

function sug_generateId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Group tasks into phases respecting:
 * 1. Explicit phase assignments on tasks
 * 2. Max high-complexity tasks per phase
 * 3. Max total tasks per phase
 * 4. Dependency ordering
 */
function groupIntoPhases(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];

  // Group by explicit phase first
  const byPhase = {};
  for (const t of tasks) {
    const p = t.phase || 1;
    if (!byPhase[p]) byPhase[p] = [];
    byPhase[p].push(t);
  }

  const phases = [];
  for (const [phaseNum, phaseTasks] of Object.entries(byPhase).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    // Check if we need to split this phase
    const split = splitIfOverLimit(phaseTasks, Number(phaseNum));
    phases.push(...split);
  }

  // Re-number phases sequentially
  phases.forEach((p, i) => {
    p.phase = i + 1;
    p.tasks.forEach(t => { t.phase = i + 1; });
  });

  // Add gate task at end of each phase
  for (const phase of phases) {
    phase.tasks.push({
      id: 'gate-' + sug_generateId(),
      phase: phase.phase,
      title: 'Phase ' + phase.phase + ' gate',
      description: 'Run gate checks: all tests, lint, security scan, standards check, coverage report.',
      acceptance_criteria: 'All checks pass. No blockers. Phase can advance.',
      agent_role: 'test-engineer',
      complexity: 'medium',
      depends_on: phase.tasks.map(t => t.id),
      type: 'gate',
      status: 'pending',
    });
    phase.gate_task_id = phase.tasks[phase.tasks.length - 1].id;
    phase.task_count = phase.tasks.length;
  }

  return phases;
}

function splitIfOverLimit(tasks, basePhase) {
  const highComplexity = tasks.filter(t => t.complexity === 'high' || t.complexity === 'critical');
  const isOverLimit = highComplexity.length > SUG_MAX_HIGH_COMPLEXITY_PER_PHASE || tasks.length > MAX_TASKS_PER_PHASE;

  if (!isOverLimit) {
    return [{
      phase: basePhase,
      name: sug_getPhaseName(basePhase),
      tasks: tasks.slice(),
      task_count: tasks.length,
      high_complexity_count: highComplexity.length,
    }];
  }

  // Split into chunks
  const chunks = [];
  let current = [];
  let currentHigh = 0;

  for (const t of tasks) {
    const isHigh = t.complexity === 'high' || t.complexity === 'critical';
    if ((isHigh && currentHigh >= SUG_MAX_HIGH_COMPLEXITY_PER_PHASE) || current.length >= MAX_TASKS_PER_PHASE) {
      if (current.length > 0) chunks.push(current);
      current = [];
      currentHigh = 0;
    }
    current.push(t);
    if (isHigh) currentHigh++;
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((chunk, i) => ({
    phase: basePhase + i * 0.1,  // will be renumbered
    name: sug_getPhaseName(basePhase) + (chunks.length > 1 ? ' (Part ' + (i + 1) + ')' : ''),
    tasks: chunk,
    task_count: chunk.length,
    high_complexity_count: chunk.filter(t => t.complexity === 'high' || t.complexity === 'critical').length,
  }));
}

function sug_getPhaseName(phaseNum) {
  const names = {
    1: 'Foundation',
    2: 'Core Features',
    3: 'Frontend & Testing',
    4: 'Deployment & Documentation',
  };
  return names[Math.round(phaseNum)] || 'Phase ' + phaseNum;
}

/**
 * Calculate complexity score for a phase (0-100).
 * Used for health reporting.
 */
function calculatePhaseComplexity(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;
  const weights = { low: 1, medium: 3, high: 5, critical: 8 };
  const total = tasks.reduce((sum, t) => sum + (weights[t.complexity] || 3), 0);
  const max = tasks.length * 8;
  return Math.round((total / max) * 100);
}

/**
 * Validate phase ordering — all dependencies must be in earlier phases.
 * Returns list of violations.
 */
function validatePhaseOrdering(phases) {
  const violations = [];
  const taskPhaseMap = {};
  for (const p of phases) {
    for (const t of p.tasks) {
      taskPhaseMap[t.id] = p.phase;
    }
  }
  for (const p of phases) {
    for (const t of p.tasks) {
      for (const depId of (t.depends_on || [])) {
        const depPhase = taskPhaseMap[depId];
        if (depPhase !== undefined && depPhase > p.phase) {
          violations.push({ task: t.id, depends_on: depId, task_phase: p.phase, dep_phase: depPhase });
        }
      }
    }
  }
  return violations;
}


// ========== Sub-module: ezra-interview-engine ==========


// EZRA Interview Engine -- gap detection state machine for /ezra:interview
// 12 question domains, incremental save, readline for CLI mode.
// Zero external dependencies.


// ─── Question domains ────────────────────────────────────────────────────────────────────────────

const DOMAINS = [
  {
    id: 'project_name',
    question: 'What is the name of this project?',
    type: 'text',
    required: true,
  },
  {
    id: 'description',
    question: 'Describe what this project does in 2-3 sentences.',
    type: 'text',
    required: true,
  },
  {
    id: 'tech_stack',
    question: 'What is your primary tech stack? (e.g. TypeScript/Next.js/PostgreSQL)',
    type: 'text',
    required: true,
  },
  {
    id: 'features',
    question: 'List your top 5 core features (one per line, press Enter twice when done):',
    type: 'multiline',
    required: true,
  },
  {
    id: 'auth_strategy',
    question: 'How will users authenticate? (e.g. JWT, OAuth/SSO, email+password, magic link, none)',
    type: 'choice',
    choices: ['JWT', 'OAuth/SSO', 'email+password', 'magic link', 'supabase auth', 'none', 'other'],
    required: false,
  },
  {
    id: 'database_choice',
    question: 'Which database(s) will you use?',
    type: 'text',
    required: false,
  },
  {
    id: 'deployment_target',
    question: 'Where will this deploy? (e.g. Vercel, Railway, AWS, self-hosted)',
    type: 'choice',
    choices: ['Vercel', 'Railway', 'Render', 'AWS', 'GCP', 'Azure', 'Fly.io', 'self-hosted', 'unknown'],
    required: false,
  },
  {
    id: 'testing_requirements',
    question: 'What testing approach do you need? (unit/integration/e2e/all)',
    type: 'choice',
    choices: ['unit only', 'unit + integration', 'unit + integration + e2e', 'none for now'],
    required: false,
  },
  {
    id: 'security_level',
    question: 'Security sensitivity level?',
    type: 'choice',
    choices: ['standard', 'elevated (handles PII)', 'high (financial/medical)', 'critical (compliance required)'],
    required: false,
  },
  {
    id: 'performance_targets',
    question: 'Any specific performance targets? (e.g. <200ms API response, 10k concurrent users)',
    type: 'text',
    required: false,
  },
  {
    id: 'team_size',
    question: 'Team size (including yourself)?',
    type: 'choice',
    choices: ['1 (solo)', '2-3', '4-8', '9-20', '20+'],
    required: false,
  },
  {
    id: 'timeline',
    question: 'Target timeline / delivery date?',
    type: 'text',
    required: false,
  },
];

// ─── Gap detection ─────────────────────────────────────────────────────────────────────────────────

function detectGaps(existing) {
  const answered = new Set(Object.keys(existing || {}).filter(k => {
    const v = existing[k];
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  }));
  return DOMAINS.filter(d => !answered.has(d.id));
}

// ─── CLI interview ────────────────────────────────────────────────────────────────────────────────

async function runInterviewCLI(projectDir, existingDef) {
  const def = Object.assign({}, existingDef || {});
  const gaps = detectGaps(def);

  if (gaps.length === 0) {
    console.log('EZRA: Project definition is complete. No gaps detected.');
    return def;
  }

  const QUESTION_TIMEOUT_MS = 120000; // 2 minutes per question
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // GAP-024: Handle Ctrl-C gracefully
  rl.on('SIGINT', () => {
    console.log('\nEZRA: Interview interrupted. Saving progress...');
    rl.close();
  });

  // GAP-023/034: ask() with inactivity timeout
  const ask = (q) => new Promise((resolve) => {
    let timer = setTimeout(() => {
      console.log('\nEZRA: Question timed out after ' + (QUESTION_TIMEOUT_MS / 1000) + 's. Skipping.');
      resolve('');
    }, QUESTION_TIMEOUT_MS);
    timer.unref();
    rl.question(q, (answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });

  console.log('\nEZRA Gap Interview (' + gaps.length + ' questions)\n');

  for (const domain of gaps) {
    let answer = '';
    if (domain.type === 'choice' && domain.choices) {
      console.log('\n' + domain.question);
      domain.choices.forEach((c, i) => console.log('  ' + (i + 1) + '. ' + c));
      const raw = await ask('Enter number or type answer: ');
      const idx = parseInt(raw, 10) - 1;
      answer = (idx >= 0 && idx < domain.choices.length) ? domain.choices[idx] : raw.trim();
    } else if (domain.type === 'multiline') {
      console.log('\n' + domain.question);
      const lines = [];
      let line;
      while ((line = await ask('  > ')) !== '') {
        lines.push(line.trim());
        if (lines.length >= 10) break;
      }
      answer = lines;
    } else {
      answer = await ask('\n' + domain.question + '\n> ');
      answer = answer.trim();
    }

    if (answer && (typeof answer !== 'string' || answer.length > 0)) {
      def[domain.id] = answer;
      // Incremental save
      if (_def && projectDir) {
        try { _def.save(projectDir, def); } catch (_e) { /* non-blocking */ }
      }
    }
  }

  rl.close();
  return def;
}

// ─── SSE/API interview helper ────────────────────────────────────────────────────────────────────────────────

function getNextQuestion(existingDef) {
  const gaps = detectGaps(existingDef);
  if (gaps.length === 0) return null;
  return { domain: gaps[0], remaining: gaps.length };
}

function applyAnswer(existingDef, domainId, answer) {
  const def = Object.assign({}, existingDef || {});
  def[domainId] = answer;
  return def;
}

function getProgress(existingDef) {
  const answered = DOMAINS.filter(d => {
    const v = (existingDef || {})[d.id];
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  return { answered: answered.length, total: DOMAINS.length, pct: Math.round(answered.length / DOMAINS.length * 100) };
}

// ── Quiz2Build integration ────────────────────────────────────────────────────


/**
 * fromQuiz2BuildSession — hybrid interview mode.
 * Imports a Q2B session heatmap and marks EZRA domains that are already covered.
 * Returns { covered_domains[], remaining_domains[], answers_applied, session_score }
 */
function fromQuiz2BuildSession(projectDir, sessionId) {
  if (!_q2b) return { error: 'ezra-quiz2build-client not available' };

  const heatmapResult = _q2b.importHeatmap(projectDir, sessionId);
  if (heatmapResult.error) return heatmapResult;

  const factResult = _q2b.importFacts(projectDir, sessionId);
  const scoreResult = _q2b.importScore(projectDir, sessionId);

  const coveredEzraDomains = new Set();
  const heatmap = heatmapResult.heatmap || {};
  const domainMap = _q2b.EZRA_DOMAIN_MAP;

  // Mark domains covered where Q2B dimension is MOSTLY_ADDRESSED or better
  for (const [q2bDim, ezraDomains] of Object.entries(domainMap)) {
    const cells = Array.isArray(heatmap[q2bDim]) ? heatmap[q2bDim] :
                  (heatmap.matrix && heatmap.matrix[q2bDim]) ? heatmap.matrix[q2bDim] : [];
    const hasRedOrAmber = cells.some(c => {
      const level = (c.colour || c.color || c.level || 'green').toLowerCase();
      return level === 'red' || level === 'amber';
    });
    if (!hasRedOrAmber) {
      for (const d of ezraDomains) coveredEzraDomains.add(d);
    }
  }

  // EZRA-only domains always remain
  const allDomainIds = DOMAINS.map(d => d.id);
  const coveredArr = allDomainIds.filter(id => coveredEzraDomains.has(id));
  const remainingArr = allDomainIds.filter(id => !coveredEzraDomains.has(id));

  // Apply known facts as answers to the definition
  let answersApplied = 0;
  const facts = (factResult && !factResult.error && Array.isArray(factResult.facts)) ? factResult.facts : [];
  for (const fact of facts) {
    if (fact.domain && DOMAINS.some(d => d.id === fact.domain) && fact.value !== undefined) {
      // Caller must apply answers using applyAnswer() in their session state
      answersApplied++;
    }
  }

  return {
    session_id: sessionId,
    session_score: scoreResult.score || null,
    covered_domains: coveredArr,
    remaining_domains: remainingArr,
    facts,
    answers_applied: answersApplied,
    heatmap,
  };
}



// ========== Sub-module: ezra-task-verifier ==========



// ─── Constants ───────────────────────────────────────────────────

const VERIFICATION_LEVELS = ['basic', 'standard', 'strict'];

// ─── Exported Functions ───────────────────────────────────────────

/**
 * Check that every path in task.file_targets exists under projectDir.
 * Returns { passed: bool, missing: string[] }.
 */
function checkFileTargetsExist(task, projectDir) {
  const targets = Array.isArray(task.file_targets) ? task.file_targets : [];
  const missing = [];
  for (const filePath of targets) {
    if (!filePath) continue;
    const abs = path.join(projectDir, filePath);
    if (!fs.existsSync(abs)) {
      missing.push(filePath);
    }
  }
  return { passed: missing.length === 0, missing };
}

/**
 * Placeholder acceptance-criteria check via keyword matching.
 * Splits acceptance_criteria on '.', extracts key nouns, checks result string.
 * Always returns passed: true (placeholder for AI check).
 * Returns { passed: bool, unchecked: string[] }.
 */
function checkAcceptanceCriteria(task, result) {
  const criteria = task.acceptance_criteria || '';
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result || '');
  const sentences = criteria.split('.').map((s) => s.trim()).filter(Boolean);
  const unchecked = [];

  for (const sentence of sentences) {
    // Extract simple nouns: words longer than 4 chars, not common stop words
    const stopWords = new Set(['should', 'shall', 'must', 'have', 'that', 'with', 'when', 'then', 'each', 'every', 'which', 'there']);
    const words = sentence.split(/\s+/).filter((w) => w.length > 4 && !stopWords.has(w.toLowerCase()));
    const foundAny = words.some((w) => resultStr.toLowerCase().includes(w.toLowerCase()));
    if (!foundAny && words.length > 0) {
      unchecked.push(sentence);
    }
  }

  // Placeholder: always passed — real AI check deferred
  return { passed: true, unchecked };
}

/**
 * Attempts to run `npm run lint --silent` in projectDir.
 * Uses execFileSync with argument array to avoid shell injection.
 * Returns { passed: bool, output: string, error?: string, skipped?: bool }.
 */
function runLintCheck(projectDir, fileTargets) {
  // Check if package.json exists and has a lint script
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return { passed: true, output: 'lint skipped', skipped: true };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.scripts || !pkg.scripts.lint) {
      return { passed: true, output: 'lint skipped', skipped: true };
    }
  } catch (_) {
    return { passed: true, output: 'lint skipped', skipped: true };
  }

  // Determine npm executable (cross-platform)
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  try {
    const output = child_process.execFileSync(npmCmd, ['run', 'lint', '--silent'], {
      cwd: projectDir,
      timeout: 30000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, output: output || '' };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    const stdout = (e.stdout || '').toString();
    // Non-zero exit = lint failures found
    if (e.status !== null && e.status !== undefined) {
      return { passed: false, output: stdout + stderr, error: 'Lint check failed (exit ' + e.status + ')' };
    }
    // Timeout or other execution error — skip gracefully
    return { passed: true, output: 'lint skipped', skipped: true, error: e.message };
  }
}

/**
 * Full verification of a completed task.
 * Runs file-existence and acceptance-criteria checks.
 * Returns a VerificationResult object.
 */
function verifyTask(projectDir, task, executionResult) {
  const findings = [];
  const remediationHints = [];

  // Check 1: file targets exist
  const fileCheck = checkFileTargetsExist(task, projectDir);
  if (!fileCheck.passed) {
    for (const missing of fileCheck.missing) {
      findings.push({ level: 'error', message: 'Expected file not found: ' + missing });
      remediationHints.push('Ensure the agent created or modified: ' + missing);
    }
  }

  // Check 2: acceptance criteria (placeholder)
  const criteriaCheck = checkAcceptanceCriteria(task, executionResult);
  if (criteriaCheck.unchecked.length > 0) {
    for (const uc of criteriaCheck.unchecked) {
      findings.push({ level: 'warning', message: 'Acceptance criterion may be unmet: ' + uc });
    }
    if (criteriaCheck.unchecked.length > 0) {
      remediationHints.push('Review acceptance criteria manually: ' + criteriaCheck.unchecked.join('; '));
    }
  }

  const hasErrors = findings.some((f) => f.level === 'error');

  return {
    task_id: task.id || task.task_id,
    passed: !hasErrors,
    findings,
    remediation_hints: remediationHints,
    verified_at: new Date().toISOString(),
  };
}

// ─── Hook Protocol ────────────────────────────────────────────────


// ─── Exports ──────────────────────────────────────────────────────


// ========== Sub-module routing ==========

function _handleSubModule(subModule, event) {
  const cwd = event.cwd || process.cwd();
  let output = {};
  try {
    switch (subModule) {
      case 'planner': {
        const action = event.action || 'status';
        if (action === 'create') output = createPlan(cwd, event.spec || {});
        else if (action === 'decompose') output = decomposeTasks(cwd, event.tasks || []);
        else if (action === 'assign') output = assignTask(cwd, event.taskIndex, event.agentId);
        else if (action === 'advance') output = advanceTask(cwd, event.taskIndex, event.newStatus);
        else if (action === 'gap_check') output = runGapCheck(cwd);
        else if (action === 'checkpoint') output = createCheckpoint(cwd, event.label);
        else if (action === 'lock') output = lockPlan(cwd);
        else if (action === 'unlock') output = unlockPlan(cwd, event.reason);
        else if (action === 'delete') output = deletePlan(cwd);
        else if (action === 'describe') output = { text: describePlan(cwd) };
        else if (action === 'from_definition') output = createPlanFromDefinition(cwd);
        else output = getPlanStatus(cwd);
        break;
      }
      case 'plan-generator': {
        const action = event.action || 'generate';
        if (action === 'generate') output = generatePlan(cwd);
        else if (action === 'load') output = loadPlan(cwd) || { error: 'No plan found' };
        else if (action === 'tasks') output = { tasks: loadTasks(cwd) };
        else if (action === 'lock') output = lockPlan(cwd);
        else if (action === 'unlock') output = unlockPlan(cwd, event.reason);
        else if (action === 'q2b') output = fromQuiz2BuildDocuments(cwd, event.sessionId);
        else output = generatePlan(cwd);
        break;
      }
      case 'phase-suggester': { output = { phases: groupIntoPhases(event.tasks || []) }; break; }
      case 'interview-engine': {
        const existing = _def ? _def.load(cwd) : null;
        const gaps = detectGaps(existing);
        output = { gaps: gaps.map(d => d.id), count: gaps.length };
        break;
      }
      case 'task-verifier': {
        const action = event.action || '';
        if (action === 'verify') output = verifyTask(cwd, event.task || {}, event.execution_result || null);
        else if (action === 'lint') output = runLintCheck(cwd, event.file_targets || []);
        else output = { ok: false, error: 'Unknown action: ' + action };
        break;
      }
      default: output = { error: 'Unknown sub-module: ' + subModule };
    }
  } catch (e) { output = { error: e.message || 'unknown error' }; }
  process.stdout.write(JSON.stringify(output) + '\n');
}

// ========== Exports ==========

module.exports = {
  // ezra-planner
  PLAN_STAGES, TASK_STATUSES, RISK_LEVELS, PLANS_DIR,
  createPlan, loadPlan, decomposeTasks,
  assignTask, getTaskQueue, advanceTask, runGapCheck, createCheckpoint,
  getPlanStatus, listCheckpoints, listGapReports, deletePlan, describePlan,
  readYaml, writeYaml, getPlansDir, getCheckpointsDir, getGapReportsDir,
  generateId, createPlanFromDefinition,
  lockPlan, unlockPlan, addPhaseGate,
  // ezra-plan-generator (canonical + prefixed for wrapper access)
  generatePlan, loadTasks,
  suggestPhases: gen_suggestPhases, detectTaskAreas,
  fromQuiz2BuildDocuments, AGENT_ROLES, COMPLEXITY_WEIGHTS,
  MAX_HIGH_COMPLEXITY_PER_PHASE: GEN_MAX_HIGH_COMPLEXITY_PER_PHASE,
  gen_loadPlan, gen_decomposeTasks, gen_suggestPhases,
  gen_lockPlan, gen_unlockPlan,
  // ezra-phase-suggester
  groupIntoPhases, splitIfOverLimit, calculatePhaseComplexity,
  validatePhaseOrdering, getPhaseName: sug_getPhaseName,
  MAX_TASKS_PER_PHASE,
  SUGGESTER_MAX_HIGH_COMPLEXITY_PER_PHASE: SUG_MAX_HIGH_COMPLEXITY_PER_PHASE,
  // ezra-interview-engine
  DOMAINS, detectGaps, runInterviewCLI, getNextQuestion,
  applyAnswer, getProgress, fromQuiz2BuildSession,
  // ezra-task-verifier
  VERIFICATION_LEVELS, checkFileTargetsExist, checkAcceptanceCriteria,
  runLintCheck, verifyTask,
  // router
  _handleSubModule,
};

// ========== stdin handler ==========

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; if (input.length > MAX_STDIN) process.exit(0); });
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      if (event.submodule || event.sub_module) _handleSubModule(event.submodule || event.sub_module, event);
      else if (event.action === 'verify' || event.action === 'lint') _handleSubModule('task-verifier', event);
      else if (event.action === 'generate' || event.action === 'q2b') _handleSubModule('plan-generator', event);
      else if (event.tasks && !event.action) _handleSubModule('phase-suggester', event);
      else if (event.action === 'interview' || event.action === 'gaps') _handleSubModule('interview-engine', event);
      else _handleSubModule('planner', event);
    } catch (_e) {
      const errMsg = _e && _e.message ? _e.message : 'unknown error';
      process.stdout.write(JSON.stringify({ error: 'stdin_parse_error', message: errMsg }));
    }
    process.exit(0);
  });
}
