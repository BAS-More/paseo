#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

/**
 * EZRA Project Operations Hub (Consolidated Module)
 *
 * Merges 5 project-ops hooks into one module:
 *   1. ezra-pm.js           — Project management, tasks, milestones
 *   2. ezra-progress-hook.js — Progress tracking (PostToolUse)
 *   3. ezra-notifier.js      — Notification system
 *   4. ezra-dashboard-data.js — Dashboard data aggregation
 *   5. ezra-version-hook.js   — Version tracking
 *
 * Zero external dependencies — uses only Node.js built-ins.
 * Can be required as a module or invoked via stdin (hook protocol).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ─── EZRA Feedback Helpers (non-blocking) ───────────────────────

let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// ─── Settings Loader ────────────────────────────────────────────

let settingsModule;
try {
  settingsModule = require(path.join(__dirname, 'ezra-settings.js'));
} catch {
  settingsModule = null;
}

// ─── HTTP Module (for notifier/dashboard sync) ──────────────────

let _http;
try { _http = require('./ezra-http.js'); } catch { _http = null; }

// ═════════════════════════════════════════════════════════════════
// SECTION 1: SHARED UTILITIES
// ═════════════════════════════════════════════════════════════════

function atomicWriteFileSync(filePath, data, encoding) {
  const dir = path.dirname(filePath);
  const tmpName = '.ezra-tmp-' + crypto.randomBytes(6).toString('hex');
  const tmpPath = path.join(dir, tmpName);
  fs.writeFileSync(tmpPath, data, encoding);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (err) {
      if (err.code === 'EPERM' && attempt < 4) {
        const end = Date.now() + 50;
        while (Date.now() < end) { /* spin */ }
        continue;
      }
      try { fs.unlinkSync(tmpPath); } catch {}
      throw err;
    }
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isoTimestamp() {
  return new Date().toISOString();
}

// ─── YAML Parsers ───────────────────────────────────────────────

function parsePrimitive(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~' || val === '') return null;
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map(s => parsePrimitive(s.trim()));
  }
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

function parseSimple(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let currentSection = null;
  for (const line of lines) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent === 0) {
      const m = line.match(/^(\w[\w_-]*):\s*(.*)?$/);
      if (!m) continue;
      const key = m[1];
      if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
      const val = (m[2] || '').trim();
      if (val === '') {
        currentSection = key;
        result[key] = {};
      } else {
        currentSection = null;
        result[key] = parsePrimitive(val);
      }
    } else if (currentSection) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(result[currentSection])) {
          result[currentSection] = [];
        }
        result[currentSection].push(parsePrimitive(trimmed.slice(2).trim()));
      } else {
        const m = trimmed.match(/^(\w[\w_-]*):\s*(.*)?$/);
        if (m) {
          if (/^(__proto__|constructor|prototype)$/.test(m[1])) continue;
          if (typeof result[currentSection] !== 'object' || Array.isArray(result[currentSection])) {
            result[currentSection] = {};
          }
          result[currentSection][m[1]] = parsePrimitive((m[2] || '').trim());
        }
      }
    }
  }
  return result;
}

function readYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    if (settingsModule) {
      return settingsModule.parseYamlSimple(text);
    }
    return parseSimple(text);
  } catch {
    return {};
  }
}

function readDeepYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const result = {};
    const lines = text.split(/\r?\n/);
    let currentKey = null;
    let currentArray = null;
    let currentObj = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
      const indent = (line.match(/^(\s*)/)[1] || '').length;

      if (indent === 0) {
        if (currentObj && currentArray) { currentArray.push(currentObj); currentObj = null; }
        if (currentArray && currentKey) { result[currentKey] = currentArray; }
        const m = line.match(/^(\w[\w_-]*):\s*(.*)?$/);
        if (!m) continue;
        const key = m[1];
        if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
        const val = (m[2] || '').trim();
        if (val === '') {
          currentKey = key;
          currentArray = null;
          currentObj = null;
        } else {
          currentKey = null;
          currentArray = null;
          currentObj = null;
          result[key] = parsePrimitive(val);
        }
        continue;
      }

      const trimmed = line.trim();

      if (trimmed.startsWith('- ')) {
        if (currentObj && currentArray) { currentArray.push(currentObj); }
        if (!currentArray) currentArray = [];
        const rest = trimmed.slice(2).trim();
        const m = rest.match(/^(\w[\w_-]*):\s*(.*)?$/);
        if (m) {
          currentObj = {};
          currentObj[m[1]] = parsePrimitive((m[2] || '').trim());
        } else {
          currentObj = null;
          currentArray.push(parsePrimitive(rest));
        }
        continue;
      }

      if (currentObj) {
        const m = trimmed.match(/^(\w[\w_-]*):\s*(.*)?$/);
        if (m) {
          if (/^(__proto__|constructor|prototype)$/.test(m[1])) continue;
          currentObj[m[1]] = parsePrimitive((m[2] || '').trim());
          continue;
        }
      }

      if (currentKey && !currentArray) {
        const m = trimmed.match(/^(\w[\w_-]*):\s*(.*)?$/);
        if (m) {
          if (/^(__proto__|constructor|prototype)$/.test(m[1])) continue;
          if (typeof result[currentKey] !== 'object' || Array.isArray(result[currentKey])) {
            result[currentKey] = {};
          }
          result[currentKey][m[1]] = parsePrimitive((m[2] || '').trim());
        }
      }
    }

    if (currentObj && currentArray) { currentArray.push(currentObj); }
    if (currentArray && currentKey) { result[currentKey] = currentArray; }

    return result;
  } catch (e) {
    _log('pm', 'warn', 'readDeepYaml failed for ' + filePath + ': ' + (e.message || 'unknown'));
    return {};
  }
}

function formatVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v);
}

function writeYamlPM(filePath, data) {
  const lines = [];
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      lines.push(key + ':');
      for (const [k2, v2] of Object.entries(val)) {
        lines.push('  ' + k2 + ': ' + formatVal(v2));
      }
    } else if (Array.isArray(val)) {
      lines.push(key + ':');
      for (const item of val) {
        if (item && typeof item === 'object') {
          const parts = Object.entries(item).map(([k, v]) => k + ': ' + formatVal(v)).join(', ');
          lines.push('  - {' + parts + '}');
        } else {
          lines.push('  - ' + formatVal(item));
        }
      }
    } else {
      lines.push(key + ': ' + formatVal(val));
    }
  }
  ensureDir(path.dirname(filePath));
  atomicWriteFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// ─── Dashboard YAML Helpers ─────────────────────────────────────

function readYamlDash(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  let currentKey = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([\w.-]+):\s*(.*)$/);
    if (match) {
      const [, key, val] = match;
      if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
      if (val === '' || val === '|' || val === '>') {
        currentKey = key;
        result[key] = '';
      } else {
        result[key] = parseValDash(val);
        currentKey = key;
      }
    } else if (currentKey && trimmed.startsWith('- ')) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(trimmed.slice(2).trim());
    }
  }
  return result;
}

function parseValDash(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
  if (val.startsWith('[') && val.endsWith(']')) {
    return val.slice(1, -1).split(',').map(s => parseValDash(s.trim())).filter(Boolean);
  }
  return val;
}

function writeYamlDash(filePath, data) {
  const lines = [];
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      lines.push(key + ':');
      for (const item of val) lines.push('  - ' + item);
    } else if (typeof val === 'object' && val !== null) {
      lines.push(key + ':');
      for (const [k, v] of Object.entries(val)) lines.push('  ' + k + ': ' + v);
    } else {
      lines.push(key + ': ' + (val === null ? 'null' : val));
    }
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function padRight(str, len) {
  str = String(str);
  while (str.length < len) str += ' ';
  return str;
}

// ═════════════════════════════════════════════════════════════════
// SECTION 2: PROJECT MANAGER (from ezra-pm.js)
// ═════════════════════════════════════════════════════════════════

const PM_DEFAULTS = {
  enabled: true,
  mode: 'hybrid',
  routine_checks: 'rule-based',
  complex_decisions: 'ai',
  ai_provider: 'claude',
  check_interval: 'every_5_tasks',
  escalation_threshold: 3,
  stall_detection: 30,
  daily_report: true,
  weekly_report: true,
  milestones: [],
};

function loadPMSettings(cwd) {
  if (settingsModule) {
    try {
      return settingsModule.getProjectManager(cwd);
    } catch { /* fallback */ }
  }
  return Object.assign({}, PM_DEFAULTS);
}

function loadProjectState(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  const state = {
    exists: fs.existsSync(ezraDir),
    project: null,
    phase: null,
    health_score: null,
    last_scan: null,
    decisions: { total: 0, pending: 0, approved: 0, rejected: 0 },
    tasks: { total: 0, pending: 0, active: 0, done: 0, blocked: 0 },
    milestones: { total: 0, completed: 0, pending: 0 },
    settings: loadPMSettings(projectDir),
  };

  if (!state.exists) return state;

  const govPath = path.join(ezraDir, 'governance.yaml');
  const gov = readYamlFile(govPath);
  state.project = gov.project || gov.name || null;
  state.phase = gov.phase || null;

  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) {
    const scans = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).sort();
    if (scans.length > 0) {
      const latest = readYamlFile(path.join(scansDir, scans[scans.length - 1]));
      state.health_score = latest.health_score || latest.score || null;
      state.last_scan = scans[scans.length - 1].replace('.yaml', '');
    }
  }

  const decisionsDir = path.join(ezraDir, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    const decFiles = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml'));
    state.decisions.total = decFiles.length;
    for (const df of decFiles) {
      try {
        const fp = path.join(decisionsDir, df);
        const head = fs.readFileSync(fp, 'utf8').slice(0, 512);
        const statusMatch = head.match(/^status:\s*(\S+)/m);
        const status = statusMatch ? statusMatch[1].toLowerCase() : 'pending';
        if (status === 'pending') state.decisions.pending++;
        else if (status === 'approved') state.decisions.approved++;
        else if (status === 'rejected') state.decisions.rejected++;
      } catch { /* skip */ }
    }
  }

  const tasksPath = path.join(ezraDir, 'progress', 'tasks.yaml');
  const tasksData = readDeepYaml(tasksPath);
  if (tasksData.tasks && Array.isArray(tasksData.tasks)) {
    state.tasks.total = tasksData.tasks.length;
    for (const t of tasksData.tasks) {
      const s = (t.status || 'pending').toLowerCase();
      if (s === 'pending') state.tasks.pending++;
      else if (s === 'active') state.tasks.active++;
      else if (s === 'done') state.tasks.done++;
      else if (s === 'blocked') state.tasks.blocked++;
    }
  }

  const milestonesPath = path.join(ezraDir, 'progress', 'milestones.yaml');
  const msData = readDeepYaml(milestonesPath);
  if (msData.milestones && Array.isArray(msData.milestones)) {
    state.milestones.total = msData.milestones.length;
    for (const ms of msData.milestones) {
      if (ms.completed || ms.status === 'completed') state.milestones.completed++;
      else state.milestones.pending++;
    }
  }

  return state;
}

function checkMilestones(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  const milestonesPath = path.join(ezraDir, 'progress', 'milestones.yaml');
  const msData = readDeepYaml(milestonesPath);

  if (!msData.milestones || !Array.isArray(msData.milestones)) {
    return { milestones: [], summary: 'No milestones defined' };
  }

  const state = loadProjectState(projectDir);
  const tasksPath = path.join(ezraDir, 'progress', 'tasks.yaml');
  const tasksData = readDeepYaml(tasksPath);
  const tasks = (tasksData.tasks && Array.isArray(tasksData.tasks)) ? tasksData.tasks : [];

  const results = [];
  for (const ms of msData.milestones) {
    const criteria = ms.criteria || [];
    const met = [];

    for (const criterion of criteria) {
      const cStr = String(criterion);
      if (cStr.startsWith('health_score')) {
        const match = cStr.match(/>=?\s*(\d+)/);
        if (match) {
          const threshold = parseInt(match[1], 10);
          met.push(state.health_score !== null && state.health_score >= threshold);
        } else { met.push(false); }
      } else if (cStr === 'all_p1_tasks_done') {
        const p1Tasks = tasks.filter(t => t.priority === 'p1' || t.priority === 'P1' || t.priority === 1);
        const allDone = p1Tasks.length > 0 && p1Tasks.every(t => (t.status || '').toLowerCase() === 'done');
        met.push(allDone);
      } else if (cStr.startsWith('test_coverage')) {
        const match = cStr.match(/>=?\s*(\d+)/);
        if (match) {
          const threshold = parseInt(match[1], 10);
          const coverage = state.health_score !== null ? state.health_score : 0;
          met.push(coverage >= threshold);
        } else { met.push(false); }
      } else if (cStr === 'zero_critical_gaps') {
        const decisionsDir = path.join(ezraDir, 'decisions');
        let hasCritical = false;
        if (fs.existsSync(decisionsDir)) {
          const decFiles = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml'));
          for (const df of decFiles) {
            const dec = readYamlFile(path.join(decisionsDir, df));
            if ((dec.severity === 'critical' || dec.priority === 'critical') &&
                dec.status !== 'resolved' && dec.status !== 'approved') {
              hasCritical = true; break;
            }
          }
        }
        met.push(!hasCritical);
      } else { met.push(false); }
    }

    const metCount = met.filter(Boolean).length;
    const overall = criteria.length > 0 && metCount === criteria.length;
    const percentage = criteria.length > 0 ? Math.round((metCount / criteria.length) * 100) : 100;
    results.push({ name: ms.name || 'Unnamed', criteria, met, overall, percentage });
  }

  return {
    milestones: results,
    summary: results.filter(r => r.overall).length + '/' + results.length + ' milestones completed',
  };
}

function detectStalls(projectDir, thresholdMinutes) {
  const ezraDir = path.join(projectDir, '.ezra');
  const pmSettings = loadPMSettings(projectDir);
  const threshold = thresholdMinutes || pmSettings.stall_detection || 30;
  const tasksPath = path.join(ezraDir, 'progress', 'tasks.yaml');
  const tasksData = readDeepYaml(tasksPath);
  const tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];

  if (tasks.length === 0) return { stalled: false, lastActivity: null, minutesSinceActivity: 0, message: 'No tasks tracked' };

  let latest = null;
  let latestTask = null;
  for (const t of tasks) {
    const ts = t.updated || t.created;
    if (ts) {
      const d = new Date(ts);
      if (!latest || d > latest) { latest = d; latestTask = t; }
    }
  }

  if (!latest) return { stalled: false, lastActivity: null, minutesSinceActivity: 0, message: 'No timestamps on tasks' };

  const now = new Date();
  const minutes = (now - latest) / 60000;
  const stalled = minutes > threshold;
  return {
    stalled,
    lastActivity: latest.toISOString(),
    minutesSinceActivity: Math.round(minutes),
    stalledTask: latestTask ? (latestTask.description || latestTask.id) : null,
    message: stalled ? 'Stalled: ' + Math.round(minutes) + ' minutes since last activity' : 'Active',
  };
}

function generateProgressReport(projectDir) {
  const state = loadProjectState(projectDir);
  const milestoneStatus = checkMilestones(projectDir);
  const stallStatus = detectStalls(projectDir);
  const trend = calculateHealthTrend(projectDir, 10);
  const completionPct = state.tasks.total > 0 ? Math.round((state.tasks.done / state.tasks.total) * 100) : 0;
  return {
    generated: isoTimestamp(), project: state.project, phase: state.phase, completion: completionPct,
    health: { score: state.health_score, trend: trend.trend, delta: trend.delta },
    tasks: state.tasks, milestones: milestoneStatus, stalls: stallStatus, decisions: state.decisions, settings: state.settings,
  };
}

function calculateHealthTrend(projectDir, lastN) {
  const n = lastN || 10;
  const scansDir = path.join(projectDir, '.ezra', 'scans');
  if (!fs.existsSync(scansDir)) return { scores: [], current: null, previous: null, delta: 0, trend: 'stable' };
  const scanFiles = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).sort();
  const recentFiles = scanFiles.slice(-n);
  const scores = [];
  for (const sf of recentFiles) {
    const data = readYamlFile(path.join(scansDir, sf));
    const score = data.health_score || data.score || null;
    if (score !== null) scores.push(score);
  }
  if (scores.length === 0) return { scores: [], current: null, previous: null, delta: 0, trend: 'stable' };
  const current = scores[scores.length - 1];
  const previous = scores.length > 1 ? scores[scores.length - 2] : current;
  const delta = current - previous;
  let trend = 'stable';
  if (delta > 2) trend = 'improving';
  else if (delta < -2) trend = 'declining';
  return { scores, current, previous, delta, trend };
}

function checkEscalation(projectDir, consecutiveFailures) {
  const pmSettings = loadPMSettings(projectDir);
  const threshold = pmSettings.escalation_threshold || 3;
  const failures = consecutiveFailures || 0;
  const escPath = path.join(projectDir, '.ezra', 'progress', 'escalations.yaml');
  const escData = readDeepYaml(escPath);
  const history = Array.isArray(escData.escalations) ? escData.escalations : [];
  return {
    escalate: failures >= threshold,
    reason: failures >= threshold ? failures + ' consecutive failures (threshold: ' + threshold + ')' : null,
    count: failures, threshold, history,
  };
}

function generateDailyReport(projectDir) {
  const report = generateProgressReport(projectDir);
  const date = isoDate();
  const daily = {
    date, generated: report.generated, project: report.project, phase: report.phase,
    completion: report.completion, health_score: report.health ? report.health.score : null,
    health_trend: report.health ? report.health.trend : 'stable', tasks_done_today: 0,
    tasks_total: report.tasks.total, tasks_completed: report.tasks.done,
    milestones_summary: report.milestones.summary,
    stalls: report.stalls.stalled ? report.stalls.message : 'none', decisions_pending: report.decisions.pending,
  };
  const tasksPath = path.join(projectDir, '.ezra', 'progress', 'tasks.yaml');
  const tasksData = readDeepYaml(tasksPath);
  if (tasksData.tasks && Array.isArray(tasksData.tasks)) {
    daily.tasks_done_today = tasksData.tasks.filter(t => t.status === 'done' && t.updated && t.updated.startsWith(date)).length;
  }
  const reportsDir = path.join(projectDir, '.ezra', 'progress', 'reports');
  ensureDir(reportsDir);
  writeYamlPM(path.join(reportsDir, 'daily-' + date + '.yaml'), daily);
  return daily;
}

function updateProgress(projectDir, task, status) {
  const ezraDir = path.join(projectDir, '.ezra');
  const progressDir = path.join(ezraDir, 'progress');
  ensureDir(progressDir);
  const tasksPath = path.join(progressDir, 'tasks.yaml');
  const tasksData = readDeepYaml(tasksPath);
  let tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];
  const now = new Date().toISOString();
  const existing = tasks.find(t => t.id === task || t.description === task);
  let action;
  if (existing) {
    existing.status = status || existing.status;
    existing.updated = now;
    action = 'updated';
  } else {
    const id = 'task-' + (tasks.length + 1);
    tasks.push({ id, description: task, status: status || 'pending', created: now, updated: now });
    action = 'created';
  }
  let yaml = 'tasks:\n';
  for (const t of tasks) {
    yaml += '  - id: ' + (t.id || '') + '\n';
    if (t.description) yaml += '    description: ' + t.description + '\n';
    yaml += '    status: ' + (t.status || 'pending') + '\n';
    if (t.created) yaml += '    created: ' + t.created + '\n';
    if (t.updated) yaml += '    updated: ' + t.updated + '\n';
  }
  atomicWriteFileSync(tasksPath, yaml, 'utf8');
  const resultTask = existing || tasks[tasks.length - 1];
  return { action, id: resultTask.id, description: resultTask.description, status: resultTask.status };
}

// ═════════════════════════════════════════════════════════════════
// SECTION 3: PROGRESS TRACKING (from ezra-progress-hook.js)
// ═════════════════════════════════════════════════════════════════

function parseCheckInterval(interval) {
  if (typeof interval === 'number') return interval;
  const str = String(interval);
  const m = str.match(/every_(\d+)_tasks/);
  return m ? parseInt(m[1], 10) : 5;
}

function getActivityCount(activityPath) {
  if (!fs.existsSync(activityPath)) return 0;
  try {
    const content = fs.readFileSync(activityPath, 'utf8');
    return content.split('\n').filter(l => l.trim().length > 0).length;
  } catch { return 0; }
}

function logActivity(activityPath, filePath, tool) {
  ensureDir(path.dirname(activityPath));
  const entry = new Date().toISOString() + ' | ' + (tool || 'unknown') + ' | ' + filePath + '\n';
  fs.appendFileSync(activityPath, entry, 'utf8');
}

function hookOutput(extra) {
  const output = { hookSpecificOutput: { hookEventName: 'PostToolUse', permissionDecision: 'allow' } };
  if (extra) output.hookSpecificOutput.progress = extra;
  return output;
}

function processProgressEvent(event) {
  const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
  const tool = event.tool_name || 'unknown';
  const cwd = event.cwd || process.cwd();
  const ezraDir = path.join(cwd, '.ezra');
  if (!fs.existsSync(ezraDir)) return hookOutput();
  if (!filePath) return hookOutput();
  const activityPath = path.join(ezraDir, 'progress', 'activity.log');
  logActivity(activityPath, filePath, tool);
  let checkInterval = 5;
  if (settingsModule) {
    try { const pmSettings = settingsModule.getProjectManager(cwd); checkInterval = parseCheckInterval(pmSettings.check_interval); } catch {}
  }
  const count = getActivityCount(activityPath);
  const extra = { tracked: true, file: filePath, activity_count: count };
  if (count % checkInterval === 0) {
    try {
      const milestoneResult = checkMilestones(cwd);
      const stallResult = detectStalls(cwd);
      extra.periodic_check = true;
      extra.milestones = milestoneResult.summary;
      if (stallResult.stalled) {
        extra.stall_warning = stallResult.message;
        process.stderr.write('[EZRA PM] ' + stallResult.message + '\n');
      }
      if (milestoneResult.milestones) {
        for (const ms of milestoneResult.milestones) {
          if (ms.overall) {
            const msLogPath = path.join(ezraDir, 'progress', 'milestones.yaml');
            try {
              let content = '';
              if (fs.existsSync(msLogPath)) content = fs.readFileSync(msLogPath, 'utf8');
              if (!content.includes('completed: true') || !content.includes(ms.name)) {
                logActivity(activityPath, 'MILESTONE_COMPLETED: ' + ms.name, 'ezra-pm');
              }
            } catch {}
          }
        }
      }
    } catch {}
  }
  return hookOutput(extra);
}

// ═════════════════════════════════════════════════════════════════
// SECTION 4: NOTIFIER (from ezra-notifier.js)
// ═════════════════════════════════════════════════════════════════

const NOTIFICATION_TYPES = {
  decision_needed: 'Decision Required', phase_complete: 'Phase Complete',
  gate_failed: 'Gate Failed', gate_passed: 'Gate Passed',
  test_failed: 'Tests Failing', deployment_complete: 'Deployment Complete',
  audit_ready: 'Audit Ready', commit_created: 'Commit Created',
  achievement_earned: 'Achievement Unlocked',
  run_started: 'Execution Started', run_completed: 'Execution Complete',
};

const CHANNELS = ['email', 'slack', 'teams', 'dashboard'];

function formatBody(type, payload) {
  const title = NOTIFICATION_TYPES[type] || type;
  const lines = ['**' + title + '**'];
  if (payload.project) lines.push('Project: ' + payload.project);
  if (payload.phase != null) lines.push('Phase: ' + payload.phase);
  if (payload.message) lines.push(payload.message);
  if (payload.details) lines.push(payload.details);
  return lines.join('\n');
}

async function sendEmail(settings, type, payload, title) {
  const email = settings.notifications && settings.notifications.email;
  if (!email || !email.api_key || !email.to) return { sent: false, error: 'Email not configured' };
  if (!_http) return { sent: false, error: 'ezra-http not available' };
  const provider = email.provider || 'resend';
  const body = formatBody(type, payload);
  try {
    if (provider === 'resend') {
      const result = await _http.post('https://api.resend.com/emails', {
        from: email.from || 'EZRA <noreply@ezra.dev>',
        to: Array.isArray(email.to) ? email.to : [email.to],
        subject: title || NOTIFICATION_TYPES[type] || type, text: body,
      }, { 'Authorization': 'Bearer ' + email.api_key, 'Content-Type': 'application/json' });
      return { sent: true, provider: 'resend', result };
    }
    return { sent: false, error: 'Unknown email provider: ' + provider };
  } catch (e) { return { sent: false, error: e.message }; }
}

async function sendSlack(settings, type, payload, title) {
  const slack = settings.notifications && settings.notifications.slack;
  if (!slack || !slack.webhook_url) return { sent: false, error: 'Slack not configured' };
  if (!_http) return { sent: false, error: 'ezra-http not available' };
  const text = '*' + (title || NOTIFICATION_TYPES[type] || type) + '*\n' + formatBody(type, payload);
  try {
    await _http.post(slack.webhook_url, { text }, { 'Content-Type': 'application/json' });
    return { sent: true, provider: 'slack' };
  } catch (e) { return { sent: false, error: e.message }; }
}

async function sendTeams(settings, type, payload, title) {
  const teams = settings.notifications && settings.notifications.teams;
  if (!teams || !teams.webhook_url) return { sent: false, error: 'Teams not configured' };
  if (!_http) return { sent: false, error: 'ezra-http not available' };
  const card = {
    '@type': 'MessageCard', '@context': 'http://schema.org/extensions',
    themeColor: type.includes('fail') ? 'FF0000' : type.includes('complete') ? '00FF00' : '0076D7',
    summary: title || NOTIFICATION_TYPES[type] || type,
    sections: [{ activityTitle: title || NOTIFICATION_TYPES[type] || type, activityText: formatBody(type, payload) }],
  };
  try {
    await _http.post(teams.webhook_url, card, { 'Content-Type': 'application/json' });
    return { sent: true, provider: 'teams' };
  } catch (e) { return { sent: false, error: e.message }; }
}

function sendDashboard(projectDir, type, payload, title) {
  try {
    const eventsDir = path.join(projectDir, '.ezra', 'events');
    if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });
    const queuePath = path.join(eventsDir, 'dashboard-queue.yaml');
    const entry = { type, title: title || NOTIFICATION_TYPES[type] || type, payload, created_at: new Date().toISOString(), read: false };
    fs.appendFileSync(queuePath, '- ' + JSON.stringify(entry) + '\n', 'utf8');
    return { sent: true, provider: 'dashboard' };
  } catch (e) { return { sent: false, error: e.message }; }
}

async function notify(projectDir, type, payload, options) {
  options = options || {};
  const settings = settingsModule ? settingsModule.loadSettings(projectDir) : {};
  const notifSettings = settings.notifications || {};
  const onEvents = notifSettings.on_events || Object.keys(NOTIFICATION_TYPES);
  const title = options.title || NOTIFICATION_TYPES[type] || type;
  if (!onEvents.includes(type) && !onEvents.includes('*')) return { skipped: true, reason: "Event type '" + type + "' not in on_events list" };
  const results = {};
  results.dashboard = sendDashboard(projectDir, type, payload, title);
  if (notifSettings.email && notifSettings.email.api_key) results.email = await sendEmail(settings, type, payload, title);
  if (notifSettings.slack && notifSettings.slack.webhook_url) results.slack = await sendSlack(settings, type, payload, title);
  if (notifSettings.teams && notifSettings.teams.webhook_url) results.teams = await sendTeams(settings, type, payload, title);
  const sent = Object.values(results).filter(r => r.sent).length;
  _log(projectDir, 'ezra-notifier', 'info', 'Sent ' + type + ' to ' + sent + ' channel(s)');
  return { sent: sent > 0, channels: results, type, title };
}

// ═════════════════════════════════════════════════════════════════
// SECTION 5: DASHBOARD DATA (from ezra-dashboard-data.js)
// ═════════════════════════════════════════════════════════════════

const MAX_PORTFOLIO_PROJECTS = 50;
const PORTFOLIO_FILE = '.ezra-portfolio.yaml';

function getPortfolioPath() { return path.join(os.homedir(), PORTFOLIO_FILE); }

function loadPortfolio() {
  const filePath = getPortfolioPath();
  if (!fs.existsSync(filePath)) return { projects: [] };
  const content = fs.readFileSync(filePath, 'utf8');
  const projects = [];
  let current = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- name:')) {
      if (current) projects.push(current);
      current = { name: trimmed.replace('- name:', '').trim(), path: '' };
    } else if (trimmed.startsWith('path:') && current) {
      current.path = trimmed.replace('path:', '').trim();
    }
  }
  if (current) projects.push(current);
  return { projects };
}

function savePortfolio(portfolio) {
  const lines = ['projects:'];
  for (const proj of (portfolio.projects || [])) { lines.push('  - name: ' + proj.name); lines.push('    path: ' + proj.path); }
  atomicWriteFileSync(getPortfolioPath(), lines.join('\n') + '\n', 'utf8');
}

function collectProjectHealth(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(ezraDir)) {
    return { initialized: false, health_score: null, version: null, decisions_count: 0, drift_level: null, last_scan: null, name: path.basename(projectDir) };
  }
  const result = { initialized: true, name: path.basename(projectDir), health_score: null, version: null, decisions_count: 0, drift_level: null, last_scan: null };
  const currentPath = path.join(ezraDir, 'versions', 'current.yaml');
  if (fs.existsSync(currentPath)) {
    const current = readYamlDash(currentPath);
    result.health_score = current.health_score || current.score || null;
    result.version = current.version || null;
  }
  const decisionsDir = path.join(ezraDir, 'decisions');
  if (fs.existsSync(decisionsDir)) result.decisions_count = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.md')).length;
  const driftPath = path.join(ezraDir, 'docs', '.drift-counter.json');
  if (fs.existsSync(driftPath)) { try { const drift = JSON.parse(fs.readFileSync(driftPath, 'utf8')); result.drift_level = drift.count || drift.edits || 0; } catch { result.drift_level = 0; } }
  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) {
    const scans = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).sort().reverse();
    if (scans.length > 0) { const lastScan = readYamlDash(path.join(scansDir, scans[0])); result.last_scan = lastScan.date || lastScan.timestamp || scans[0].replace('.yaml', ''); }
  }
  return result;
}

function generatePortfolioDashboard() {
  const portfolio = loadPortfolio();
  if (!portfolio.projects || portfolio.projects.length === 0) return { generated: new Date().toISOString().slice(0, 10), projects: [], warnings: ['No projects configured. Add projects to ~/.ezra-portfolio.yaml'] };
  const projects = [];
  const warnings = [];
  const projectList = portfolio.projects.slice(0, MAX_PORTFOLIO_PROJECTS);
  if (portfolio.projects.length > MAX_PORTFOLIO_PROJECTS) warnings.push('Portfolio truncated to ' + MAX_PORTFOLIO_PROJECTS + ' projects (total: ' + portfolio.projects.length + ')');
  for (const proj of projectList) {
    const health = collectProjectHealth(proj.path);
    health.name = proj.name || health.name;
    projects.push(health);
    if (!health.initialized) warnings.push(proj.name + ': EZRA not initialized');
    else if (health.drift_level !== null && health.drift_level > 10) warnings.push(proj.name + ': drift threshold exceeded (' + health.drift_level + ' edits)');
  }
  return { generated: new Date().toISOString().slice(0, 10), projects, warnings };
}

function formatPortfolioDashboard(dashboard) {
  const lines = ['EZRA PORTFOLIO HEALTH', String.fromCharCode(9552).repeat(55), ''];
  if (dashboard.projects.length === 0) { lines.push('No projects configured.'); lines.push('Add projects to ~/.ezra-portfolio.yaml'); return lines.join('\n'); }
  lines.push(padRight('Project', 20) + padRight('Health', 10) + padRight('Decisions', 12) + padRight('Drift', 10) + 'Last Scan');
  lines.push(String.fromCharCode(9472).repeat(65));
  for (const proj of dashboard.projects) {
    const health = proj.health_score !== null ? proj.health_score + '/100' : String.fromCharCode(8212) + '/100';
    const decisions = proj.decisions_count + ' active';
    const drift = proj.drift_level !== null ? proj.drift_level + '/10' : String.fromCharCode(8212);
    const scan = proj.last_scan || 'Never';
    lines.push(padRight(proj.name, 20) + padRight(health, 10) + padRight(decisions, 12) + padRight(drift, 10) + scan);
  }
  if (dashboard.warnings.length > 0) { lines.push(''); for (const w of dashboard.warnings) lines.push(String.fromCharCode(9888) + ' ' + w); }
  return lines.join('\n');
}

function generateHandoff(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  const projectName = path.basename(projectDir);
  const date = new Date().toISOString().slice(0, 10);
  const brief = { project: projectName, date, health: null, version: null, architecture: '', recent_decisions: [], recent_changes: [], open_items: [], recent_commits: [] };
  if (!fs.existsSync(ezraDir)) { brief.open_items.push('EZRA not initialized'); return brief; }
  const currentPath = path.join(ezraDir, 'versions', 'current.yaml');
  if (fs.existsSync(currentPath)) { const current = readYamlDash(currentPath); brief.health = current.health_score || current.score || null; brief.version = current.version || null; }
  const knowledgePath = path.join(ezraDir, 'knowledge.yaml');
  if (fs.existsSync(knowledgePath)) { const knowledge = readYamlDash(knowledgePath); brief.architecture = knowledge.description || knowledge.summary || knowledge.architecture || ''; }
  const decisionsDir = path.join(ezraDir, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.md')).sort().reverse().slice(0, 10);
    for (const f of files) { const dec = readYamlDash(path.join(decisionsDir, f)); brief.recent_decisions.push({ id: dec.id || f.replace(/\.(yaml|md)$/, ''), title: dec.title || dec.name || f, status: dec.status || 'ACTIVE' }); }
  }
  const changelogPath = path.join(ezraDir, 'versions', 'changelog.yaml');
  if (fs.existsSync(changelogPath)) { const content = fs.readFileSync(changelogPath, 'utf8'); const entries = []; for (const line of content.split('\n')) { const trimmed = line.trim(); if (trimmed.startsWith('- ')) entries.push(trimmed.slice(2)); } brief.recent_changes = entries.slice(0, 20); }
  const driftPath = path.join(ezraDir, 'docs', '.drift-counter.json');
  if (fs.existsSync(driftPath)) { try { const drift = JSON.parse(fs.readFileSync(driftPath, 'utf8')); const count = drift.count || drift.edits || 0; if (count > 0) brief.open_items.push('Drift counter: ' + count + ' edits since last sync'); } catch {} }
  const registryPath = path.join(ezraDir, 'docs', 'registry.yaml');
  if (fs.existsSync(registryPath)) { const registry = readYamlDash(registryPath); const missing = registry.missing_count || 0; if (missing > 0) brief.open_items.push(missing + ' critical documents missing'); }
  try { const { execSync } = require('child_process'); const output = execSync('git log --oneline -10', { cwd: projectDir, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }); brief.recent_commits = output.trim().split('\n').filter(Boolean); } catch { brief.recent_commits = ['(git not available or not a git repo)']; }
  return brief;
}

function formatHandoff(brief) {
  const sep = String.fromCharCode(9552).repeat(55);
  const lines = ['EZRA HANDOFF BRIEF ' + String.fromCharCode(8212) + ' ' + brief.project + ' ' + String.fromCharCode(8212) + ' ' + brief.date, sep, '', 'HEALTH: ' + (brief.health !== null ? brief.health + '/100' : String.fromCharCode(8212)) + ' | VERSION: ' + (brief.version || String.fromCharCode(8212)), ''];
  if (brief.architecture) { lines.push('ARCHITECTURE'); lines.push(brief.architecture); lines.push(''); }
  if (brief.recent_decisions.length > 0) { lines.push('RECENT DECISIONS (last ' + brief.recent_decisions.length + ')'); for (const d of brief.recent_decisions) lines.push('- ' + d.id + ': ' + d.title + ' [' + d.status + ']'); lines.push(''); }
  if (brief.recent_changes.length > 0) { lines.push('RECENT CHANGES (last ' + brief.recent_changes.length + ')'); for (const c of brief.recent_changes) lines.push('- ' + c); lines.push(''); }
  if (brief.open_items.length > 0) { lines.push('OPEN ITEMS'); for (const item of brief.open_items) lines.push('- ' + item); lines.push(''); }
  if (brief.recent_commits.length > 0) { lines.push('RECENT COMMITS'); for (const c of brief.recent_commits) lines.push('- ' + c); lines.push(''); }
  return lines.join('\n');
}

function saveHandoff(projectDir, brief) {
  const handoffsDir = path.join(projectDir, '.ezra', 'handoffs');
  if (!fs.existsSync(handoffsDir)) fs.mkdirSync(handoffsDir, { recursive: true });
  const filename = brief.date + '-handoff.md';
  const filePath = path.join(handoffsDir, filename);
  atomicWriteFileSync(filePath, formatHandoff(brief), 'utf8');
  return filePath;
}

function exportDashboardData(projectDir) {
  const health = collectProjectHealth(projectDir);
  const brief = generateHandoff(projectDir);
  return { collected_at: new Date().toISOString(), health, brief };
}

function saveDashboardExport(projectDir, data) {
  const exportDir = path.join(projectDir, '.ezra', 'exports');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  const filename = new Date().toISOString().slice(0, 10) + '-dashboard.yaml';
  const filePath = path.join(exportDir, filename);
  writeYamlDash(filePath, {
    collected_at: data.collected_at, health_score: data.health.health_score, version: data.health.version,
    decisions_count: data.health.decisions_count, drift_level: data.health.drift_level, last_scan: data.health.last_scan,
    open_items_count: data.brief.open_items.length, recent_decisions_count: data.brief.recent_decisions.length,
  });
  return filePath;
}

async function syncToDashboard(projectDir, action) {
  const ezraDir = path.join(projectDir, '.ezra');
  const settingsPath = path.join(ezraDir, 'settings.yaml');
  if (!fs.existsSync(settingsPath)) return { synced: false, reason: 'no settings.yaml' };
  const settings = readYamlDash(settingsPath);
  const dashUrl = settings.dashboard_url || (settings.dashboard && settings.dashboard.url) || '';
  const syncToken = settings.dashboard_sync_token || (settings.dashboard && settings.dashboard.sync_token) || '';
  if (!dashUrl) return { synced: false, reason: 'dashboard_url not configured in .ezra/settings.yaml' };
  if (!syncToken) return { synced: false, reason: 'dashboard_sync_token not configured in .ezra/settings.yaml' };
  const exported = exportDashboardData(projectDir);
  const gov = readYamlDash(path.join(ezraDir, 'governance.yaml'));
  const plansDir = path.join(ezraDir, 'plans');
  let plansCount = 0;
  if (fs.existsSync(plansDir)) plansCount = fs.readdirSync(plansDir).filter(f => f.endsWith('.yaml')).length;
  const risksPath = path.join(ezraDir, 'risks.yaml');
  let riskCount = 0;
  if (fs.existsSync(risksPath)) { const risksContent = fs.readFileSync(risksPath, 'utf8'); riskCount = (risksContent.match(/status:\s*open/gi) || []).length; }
  const score = exported.health.health_score;
  let grade = 'N/A';
  if (score !== null) { if (score >= 90) grade = 'A'; else if (score >= 75) grade = 'B'; else if (score >= 60) grade = 'C'; else if (score >= 40) grade = 'D'; else grade = 'F'; }
  const payload = {
    action: action || 'sync', project_name: gov.project || gov.name || path.basename(projectDir), project_path: projectDir,
    phase: gov.phase || gov.project_phase || null, version: exported.health.version, health_score: score, health_grade: grade,
    decisions_count: exported.health.decisions_count, plans_count: plansCount, scans_count: 0, drift_level: exported.health.drift_level,
    risk_count: riskCount, last_scan_date: exported.health.last_scan, open_items: exported.brief.open_items || [],
    recent_decisions: exported.brief.recent_decisions || [], recent_commits: exported.brief.recent_commits || [],
    architecture: exported.brief.architecture || '', cli_last_seen_at: new Date().toISOString(),
  };
  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) payload.scans_count = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).length;
  if (!_http) return { synced: false, reason: 'ezra-http.js not found' };
  const url = dashUrl.replace(/\/$/, '') + '/api/ezra/sync';
  try {
    const result = await _http.post(url, payload, { 'x-ezra-sync-token': syncToken, 'Content-Type': 'application/json' });
    return { synced: true, statusCode: result.statusCode, body: result.body };
  } catch (err) { return { synced: false, reason: err.message }; }
}

// ═════════════════════════════════════════════════════════════════
// SECTION 6: VERSION TRACKING (from ezra-version-hook.js)
// ═════════════════════════════════════════════════════════════════

function processVersionEvent(event) {
  const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
  if (!filePath) return;
  const cwd = event.cwd || process.cwd();
  const ezraDir = path.join(cwd, '.ezra');
  const relativePath = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, '/');
  if (!relativePath.startsWith('.ezra/')) return;
  if (relativePath.startsWith('.ezra/versions/')) return;
  if (relativePath.includes('.drift-counter.json')) return;
  const versionsDir = path.join(ezraDir, 'versions');
  if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true });
  let changeType = 'GOVERNANCE';
  let action = 'UPDATED';
  if (relativePath.startsWith('.ezra/decisions/')) { changeType = 'DECISION'; action = 'CREATED'; }
  else if (relativePath.startsWith('.ezra/docs/proposals/')) { changeType = 'PROPOSAL'; action = 'CREATED'; }
  else if (relativePath.startsWith('.ezra/docs/')) { changeType = 'DOCUMENT'; if (relativePath.includes('registry.yaml')) changeType = 'GOVERNANCE'; }
  else if (relativePath.startsWith('.ezra/scans/')) { changeType = 'SCAN'; action = 'CREATED'; }
  else if (relativePath.startsWith('.ezra/plans/')) { changeType = 'PLAN'; }
  else if (relativePath === '.ezra/knowledge.yaml') { changeType = 'KNOWLEDGE'; }
  else if (relativePath === '.ezra/governance.yaml') { changeType = 'GOVERNANCE'; }
  const currentPath = path.join(versionsDir, 'current.yaml');
  let version = '1.0.0';
  let totalChanges = 0;
  if (fs.existsSync(currentPath)) {
    const content = fs.readFileSync(currentPath, 'utf8');
    const vMatch = content.match(/version:\s*"?([0-9.]+)"?/);
    const cMatch = content.match(/total_changes:\s*(\d+)/);
    if (vMatch) version = vMatch[1];
    if (cMatch) totalChanges = parseInt(cMatch[1]);
  }
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  const newVersion = parts.join('.');
  totalChanges++;
  const now = new Date().toISOString();
  const changeId = 'CHG-' + String(totalChanges).padStart(4, '0');
  const entry = [
    '  - id: ' + changeId, '    timestamp: "' + now + '"', '    version_before: "' + version + '"',
    '    version_after: "' + newVersion + '"', '    type: ' + changeType, '    action: ' + action,
    '    target: "' + relativePath + '"', '    summary: "' + changeType + ' ' + action.toLowerCase() + ': ' + path.basename(filePath) + '"',
    '    triggered_by: auto', ''
  ].join('\n');
  const changelogPath = path.join(versionsDir, 'changelog.yaml');
  if (!fs.existsSync(changelogPath)) {
    fs.writeFileSync(changelogPath, '# EZRA Changelog \u2014 APPEND ONLY\nlog:\n' + entry);
  } else {
    const existing = fs.readFileSync(changelogPath, 'utf8');
    const entryCount = (existing.match(/  - id: CHG-/g) || []).length;
    if (entryCount > 1000) {
      const lines = existing.split('\n');
      const headerEnd = lines.findIndex(l => l.startsWith('  - id: CHG-'));
      const entryStarts = [];
      lines.forEach((l, i) => { if (l.startsWith('  - id: CHG-')) entryStarts.push(i); });
      const keepFrom = entryStarts[entryStarts.length - 500] || headerEnd;
      const rotated = lines.slice(0, headerEnd).concat(lines.slice(keepFrom)).join('\n');
      fs.writeFileSync(changelogPath, rotated + entry);
    } else { fs.appendFileSync(changelogPath, entry); }
  }
  if (fs.existsSync(currentPath)) {
    const existing = fs.readFileSync(currentPath, 'utf8');
    const lines = existing.split('\n');
    const updated = lines.map(line => {
      if (line.startsWith('version:')) return 'version: "' + newVersion + '"';
      if (line.startsWith('updated:')) return 'updated: "' + now + '"';
      if (line.startsWith('total_changes:')) return 'total_changes: ' + totalChanges;
      return line;
    });
    fs.writeFileSync(currentPath, updated.join('\n'));
  } else {
    fs.writeFileSync(currentPath, ['version: "' + newVersion + '"', 'created: "' + now + '"', 'updated: "' + now + '"', 'total_changes: ' + totalChanges, '', 'counts:', '  decisions: 0', '  documents: 0', '  scans: 0', '  plans: 0', '  risks: 0', '  proposals: 0', '', 'integrity:', '  last_health_check: "never"', '  health_score: null', '  governance_compliant: unknown'].join('\n'));
  }
}

// ═════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════

module.exports = {
  // Section 2: Project Manager
  loadProjectState, checkMilestones, detectStalls, generateProgressReport,
  calculateHealthTrend, checkEscalation, generateDailyReport, updateProgress, PM_DEFAULTS,
  // Section 3: Progress Tracking
  processEvent: processProgressEvent, hookOutput, parseCheckInterval, getActivityCount, logActivity,
  // Section 4: Notifier
  NOTIFICATION_TYPES, CHANNELS, notify, sendEmail, sendSlack, sendTeams, sendDashboard, formatBody,
  // Section 5: Dashboard Data
  readYaml: readYamlDash, writeYaml: writeYamlDash, parseVal: parseValDash, padRight, PORTFOLIO_FILE,
  getPortfolioPath, loadPortfolio, savePortfolio, collectProjectHealth, generatePortfolioDashboard,
  formatPortfolioDashboard, generateHandoff, formatHandoff, saveHandoff, exportDashboardData,
  saveDashboardExport, syncToDashboard,
  // Section 6: Version Tracking
  processVersionEvent, MAX_STDIN,
};

// ═════════════════════════════════════════════════════════════════
// HOOK PROTOCOL (stdin -> stdout -> exit 0)
// ═════════════════════════════════════════════════════════════════

if (require.main === module) {
  const HOOK_TIMEOUT = 10000;
  const _hookTimer = setTimeout(() => {
    process.stdout.write(JSON.stringify({ error: 'hook_timeout', message: 'Project-ops hook exceeded ' + HOOK_TIMEOUT + 'ms' }));
    process.exit(0);
  }, HOOK_TIMEOUT);
  _hookTimer.unref();
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; if (input.length > MAX_STDIN) { clearTimeout(_hookTimer); process.exit(0); } });
  process.stdin.on('end', async () => {
    try {
      const event = JSON.parse(input);
      const action = event.action || 'report';
      const cwd = event.cwd || process.cwd();
      let result;
      switch (action) {
        case 'report': result = generateProgressReport(cwd); break;
        case 'progress': result = processProgressEvent(event); break;
        case 'version': processVersionEvent(event); result = { ok: true }; break;
        case 'notify': {
          const type = event.notification_type || event.type;
          const payload = event.payload || {};
          if (!type) { result = { error: 'notification_type required' }; break; }
          result = await notify(cwd, type, payload); break;
        }
        case 'collect': result = collectProjectHealth(cwd); break;
        case 'portfolio': result = generatePortfolioDashboard(); break;
        case 'handoff': result = generateHandoff(cwd); break;
        case 'export': result = exportDashboardData(cwd); break;
        case 'sync': result = await syncToDashboard(cwd, event.sync_action || 'sync'); break;
        default: result = generateProgressReport(cwd);
      }
      process.stdout.write(JSON.stringify(result));
    } catch (e) {
      const msg = _fmt('PROJECT_OPS_001', { detail: e.message });
      process.stderr.write(msg + '\n');
      _log(process.cwd(), 'ezra-project-ops', 'warn', msg);
      process.stdout.write(JSON.stringify({ error: e.message }));
    }
    clearTimeout(_hookTimer);
    process.exit(0);
  });
}
