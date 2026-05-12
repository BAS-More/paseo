#!/usr/bin/env node
'use strict';

/**
 * hooks/ezra-plan-generator.js — AI-Driven Plan Generator for EZRA v7
 * Reads project-definition.yaml → generates master-plan.yaml
 * Heuristic decomposer (zero external dependencies) with MAH routing option.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT_ROLES = [
  'code-agent', 'security-specialist', 'architecture-reviewer',
  'test-engineer', 'devops-engineer', 'documentation-writer',
];

const COMPLEXITY_WEIGHTS = { low: 1, medium: 3, high: 5, critical: 8 };

const MAX_HIGH_COMPLEXITY_PER_PHASE = 8;

// ── YAML helpers ─────────────────────────────────────────────────────────────

function readYaml(filePath) {
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

function writeYaml(filePath, obj, header) {
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

function generateId() {
  return crypto.randomBytes(4).toString('hex');
}

function decomposeTasks(def) {
  const areas = detectTaskAreas(def);
  const tasks = [];
  let idx = 0;

  // Add project setup task
  tasks.push({
    id: 'task-' + generateId(),
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
        id: 'task-' + generateId(),
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

function suggestPhases(tasks) {
  const phaseMap = {};
  for (const t of tasks) {
    const p = t.phase || 1;
    if (!phaseMap[p]) phaseMap[p] = [];
    phaseMap[p].push(t);
  }

  const phases = [];
  for (const [phaseNum, phaseTasks] of Object.entries(phaseMap).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const highComplexity = phaseTasks.filter(t => t.complexity === 'high' || t.complexity === 'critical').length;
    const overLimit = highComplexity > MAX_HIGH_COMPLEXITY_PER_PHASE;

    phases.push({
      phase: Number(phaseNum),
      name: getPhaseName(Number(phaseNum)),
      tasks: phaseTasks,
      task_count: phaseTasks.length,
      high_complexity_count: highComplexity,
      over_complexity_limit: overLimit,
    });

    // Add gate task at end of each phase
    phaseTasks.push({
      id: 'gate-' + generateId(),
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

function getPhaseName(phaseNum) {
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
  try { def = readYaml(defPath); } catch (e) {
    return { success: false, error: 'Failed to read project-definition.yaml: ' + e.message };
  }

  const tasks = decomposeTasks(def);
  const phases = suggestPhases(tasks);

  // Flatten tasks (including gate tasks added by suggestPhases)
  const allTasks = phases.flatMap(p => p.tasks);

  const plan = {
    id: 'plan-' + generateId(),
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
  writeYaml(path.join(plansDir, 'master-plan.yaml'), plan, 'EZRA Master Plan — ' + plan.project_name);

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
  writeYaml(path.join(plansDir, 'tasks.yaml'), taskObj, 'EZRA Tasks');

  // Write phases
  const phaseObj = { total_phases: phases.length };
  phases.forEach((p, i) => {
    phaseObj['phase_' + i + '_number'] = p.phase;
    phaseObj['phase_' + i + '_name'] = p.name;
    phaseObj['phase_' + i + '_task_count'] = p.task_count;
    phaseObj['phase_' + i + '_high_complexity'] = p.high_complexity_count;
  });
  writeYaml(path.join(plansDir, 'phases.yaml'), phaseObj, 'EZRA Phase Summary');

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

function loadPlan(projectDir) {
  const planPath = path.join(projectDir, '.ezra', 'plans', 'master-plan.yaml');
  if (!fs.existsSync(planPath)) return null;
  try { return readYaml(planPath); } catch { return null; }
}

function loadTasks(projectDir) {
  const tasksPath = path.join(projectDir, '.ezra', 'plans', 'tasks.yaml');
  if (!fs.existsSync(tasksPath)) return null;
  try {
    const raw = readYaml(tasksPath);
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

function lockPlan(projectDir) {
  const planPath = path.join(projectDir, '.ezra', 'plans', 'master-plan.yaml');
  if (!fs.existsSync(planPath)) return { success: false, error: 'No master-plan.yaml found.' };
  try {
    const plan = readYaml(planPath);
    plan.status = 'locked';
    plan.locked_at = new Date().toISOString();
    writeYaml(planPath, plan, 'EZRA Master Plan — ' + (plan.project_name || 'Project'));
    return { success: true, status: 'locked' };
  } catch (e) { return { success: false, error: e.message }; }
}

function unlockPlan(projectDir, reason) {
  const planPath = path.join(projectDir, '.ezra', 'plans', 'master-plan.yaml');
  if (!fs.existsSync(planPath)) return { success: false, error: 'No master-plan.yaml found.' };
  try {
    const plan = readYaml(planPath);
    plan.status = 'draft';
    plan.unlocked_at = new Date().toISOString();
    plan.unlock_reason = reason || 'Manual unlock';
    writeYaml(planPath, plan, 'EZRA Master Plan — ' + (plan.project_name || 'Project'));
    return { success: true, status: 'draft' };
  } catch (e) { return { success: false, error: e.message }; }
}

// ── Quiz2Build integration ────────────────────────────────────────────────────

let _q2bPlan;
try { _q2bPlan = require('./ezra-quiz2build-client'); } catch (_e) { _q2bPlan = null; }

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

module.exports = {
  generatePlan,
  loadPlan,
  loadTasks,
  lockPlan,
  unlockPlan,
  decomposeTasks,
  suggestPhases,
  detectTaskAreas,
  fromQuiz2BuildDocuments,
  AGENT_ROLES,
  COMPLEXITY_WEIGHTS,
  MAX_HIGH_COMPLEXITY_PER_PHASE,
};
