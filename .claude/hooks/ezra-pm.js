#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

/**
 * EZRA Project Manager Hook
 *
 * Hybrid design: rule-based for routine checks, AI-ready interface
 * for complex decisions (AI integration deferred to Phase 5).
 *
 * Provides project state loading, milestone tracking, stall detection,
 * health trend analysis, escalation, progress reports, and task management.
 *
 * Reads/writes .ezra/progress/ directory:
 *   tasks.yaml, milestones.yaml, reports/, escalations.yaml
 *
 * Zero external dependencies — uses ezra-settings.js for config.
 *
 * Can be required as a module or invoked via stdin (hook protocol).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Atomic Write (GAP-020) ───────────────────────────────────────

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

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// ─── Settings Loader ─────────────────────────────────────────────

let settingsModule;
try {
  settingsModule = require(path.join(__dirname, 'ezra-settings.js'));
} catch {
  settingsModule = null;
}

// ─── PM Defaults ─────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────

function loadPMSettings(cwd) {
  if (settingsModule) {
    try {
      return settingsModule.getProjectManager(cwd);
    } catch { /* fallback */ }
  }
  return Object.assign({}, PM_DEFAULTS);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    if (settingsModule) {
      return settingsModule.parseYamlSimple(text);
    }
    // Minimal inline parser fallback
    return parseSimple(text);
  } catch {
    return {};
  }
}

/**
 * Enhanced YAML reader for progress files that need arrays of objects.
 * Handles: top-level keys, arrays of objects (- key: val\n  key: val), nested sections.
 */
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

      // Top-level key (no indent)
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

      // Array item start
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

      // Continuation of array object item
      if (currentObj) {
        const m = trimmed.match(/^(\w[\w_-]*):\s*(.*)?$/);
        if (m) {
          if (/^(__proto__|constructor|prototype)$/.test(m[1])) continue;
          currentObj[m[1]] = parsePrimitive((m[2] || '').trim());
          continue;
        }
      }

      // Plain nested key:value (not in array)
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

    // Flush last item
    if (currentObj && currentArray) { currentArray.push(currentObj); }
    if (currentArray && currentKey) { result[currentKey] = currentArray; }

    return result;
  } catch (e) {
    // GAP-003: Log YAML parse failures instead of silent swallow
    _log('pm', 'warn', 'readDeepYaml failed for ' + filePath + ': ' + (e.message || 'unknown'));
    return {};
  }
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

function parsePrimitive(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~' || val === '') return null;
  // Inline array: [a, b, c]
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

function writeYaml(filePath, data) {
  const lines = [];
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const [k2, v2] of Object.entries(val)) {
        lines.push(`  ${k2}: ${formatVal(v2)}`);
      }
    } else if (Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const item of val) {
        if (item && typeof item === 'object') {
          // Write inline object items
          const parts = Object.entries(item).map(([k, v]) => `${k}: ${formatVal(v)}`).join(', ');
          lines.push(`  - {${parts}}`);
        } else {
          lines.push(`  - ${formatVal(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatVal(val)}`);
    }
  }
  ensureDir(path.dirname(filePath));
  atomicWriteFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function formatVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v);
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isoTimestamp() {
  return new Date().toISOString();
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Load project state from .ezra/ directory.
 * Returns a structured project object with governance, scan, decision,
 * task, and milestone data.
 */
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

  // Read governance.yaml
  const govPath = path.join(ezraDir, 'governance.yaml');
  const gov = readYamlFile(govPath);
  state.project = gov.project || gov.name || null;
  state.phase = gov.phase || null;

  // Read latest scan
  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) {
    const scans = fs.readdirSync(scansDir)
      .filter(f => f.endsWith('.yaml'))
      .sort();
    if (scans.length > 0) {
      const latest = readYamlFile(path.join(scansDir, scans[scans.length - 1]));
      state.health_score = latest.health_score || latest.score || null;
      state.last_scan = scans[scans.length - 1].replace('.yaml', '');
    }
  }

  // Read decisions (GAP-027: optimized — read only status line, not full file)
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
      } catch { /* skip unreadable files */ }
    }
  }

  // Read tasks
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

  // Read milestones
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

/**
 * Check milestones against current project state.
 * For each milestone, evaluates criteria and returns status.
 */
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
        } else {
          met.push(false);
        }
      } else if (cStr === 'all_p1_tasks_done') {
        const p1Tasks = tasks.filter(t =>
          t.priority === 'p1' || t.priority === 'P1' || t.priority === 1
        );
        const allDone = p1Tasks.length > 0 && p1Tasks.every(t => (t.status || '').toLowerCase() === 'done');
        met.push(allDone);
      } else if (cStr.startsWith('test_coverage')) {
        const match = cStr.match(/>=?\s*(\d+)/);
        if (match) {
          const threshold = parseInt(match[1], 10);
          // Read from latest scan if available
          const coverage = state.health_score !== null ? state.health_score : 0;
          met.push(coverage >= threshold);
        } else {
          met.push(false);
        }
      } else if (cStr === 'zero_critical_gaps') {
        const decisionsDir = path.join(ezraDir, 'decisions');
        let hasCritical = false;
        if (fs.existsSync(decisionsDir)) {
          const decFiles = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml'));
          for (const df of decFiles) {
            const dec = readYamlFile(path.join(decisionsDir, df));
            if ((dec.severity === 'critical' || dec.priority === 'critical') &&
                dec.status !== 'resolved' && dec.status !== 'approved') {
              hasCritical = true;
              break;
            }
          }
        }
        met.push(!hasCritical);
      } else {
        // Unknown criterion — mark as not met
        met.push(false);
      }
    }

    const metCount = met.filter(Boolean).length;
    const overall = criteria.length > 0 && metCount === criteria.length;
    const percentage = criteria.length > 0 ? Math.round((metCount / criteria.length) * 100) : 100;

    results.push({
      name: ms.name || 'Unnamed',
      criteria,
      met,
      overall,
      percentage,
    });
  }

  return {
    milestones: results,
    summary: `${results.filter(r => r.overall).length}/${results.length} milestones completed`,
  };
}

/**
 * Detect if progress has stalled.
 * Checks the most recently updated task in tasks.yaml.
 */
function detectStalls(projectDir, thresholdMinutes) {
  const ezraDir = path.join(projectDir, '.ezra');
  const pmSettings = loadPMSettings(projectDir);
  const threshold = thresholdMinutes || pmSettings.stall_detection || 30;
  const tasksPath = path.join(ezraDir, 'progress', 'tasks.yaml');
  const tasksData = readDeepYaml(tasksPath);
  const tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];

  if (tasks.length === 0) {
    return { stalled: false, lastActivity: null, minutesSinceActivity: 0, message: 'No tasks tracked' };
  }

  // Find most recent update
  let latest = null;
  let latestTask = null;
  for (const t of tasks) {
    const ts = t.updated || t.created;
    if (ts) {
      const d = new Date(ts);
      if (!latest || d > latest) {
        latest = d;
        latestTask = t;
      }
    }
  }

  if (!latest) {
    return { stalled: false, lastActivity: null, minutesSinceActivity: 0, message: 'No timestamps on tasks' };
  }

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

/**
 * Generate a structured progress report.
 */
function generateProgressReport(projectDir) {
  const state = loadProjectState(projectDir);
  const milestoneStatus = checkMilestones(projectDir);
  const stallStatus = detectStalls(projectDir);
  const trend = calculateHealthTrend(projectDir, 10);

  const completionPct = state.tasks.total > 0
    ? Math.round((state.tasks.done / state.tasks.total) * 100)
    : 0;

  return {
    generated: isoTimestamp(),
    project: state.project,
    phase: state.phase,
    completion: completionPct,
    health: {
      score: state.health_score,
      trend: trend.trend,
      delta: trend.delta,
    },
    tasks: state.tasks,
    milestones: milestoneStatus,
    stalls: stallStatus,
    decisions: state.decisions,
    settings: state.settings,
  };
}

/**
 * Calculate health score trend from scan history.
 */
function calculateHealthTrend(projectDir, lastN) {
  const n = lastN || 10;
  const scansDir = path.join(projectDir, '.ezra', 'scans');

  if (!fs.existsSync(scansDir)) {
    return { scores: [], current: null, previous: null, delta: 0, trend: 'stable' };
  }

  const scanFiles = fs.readdirSync(scansDir)
    .filter(f => f.endsWith('.yaml'))
    .sort();

  const recentFiles = scanFiles.slice(-n);
  const scores = [];

  for (const sf of recentFiles) {
    const data = readYamlFile(path.join(scansDir, sf));
    const score = data.health_score || data.score || null;
    if (score !== null) {
      scores.push(score);
    }
  }

  if (scores.length === 0) {
    return { scores: [], current: null, previous: null, delta: 0, trend: 'stable' };
  }

  const current = scores[scores.length - 1];
  const previous = scores.length > 1 ? scores[scores.length - 2] : current;
  const delta = current - previous;

  let trend = 'stable';
  if (delta > 2) trend = 'improving';
  else if (delta < -2) trend = 'declining';

  return { scores, current, previous, delta, trend };
}

/**
 * Check if escalation is needed based on consecutive failures.
 */
function checkEscalation(projectDir, consecutiveFailures) {
  const pmSettings = loadPMSettings(projectDir);
  const threshold = pmSettings.escalation_threshold || 3;
  const failures = consecutiveFailures || 0;

  // Also check escalation log
  const escPath = path.join(projectDir, '.ezra', 'progress', 'escalations.yaml');
  const escData = readDeepYaml(escPath);
  const history = Array.isArray(escData.escalations) ? escData.escalations : [];

  return {
    escalate: failures >= threshold,
    reason: failures >= threshold ? failures + ' consecutive failures (threshold: ' + threshold + ')' : null,
    count: failures,
    threshold,
    history,
  };
}

/**
 * Generate a daily report and optionally write it to .ezra/progress/reports/.
 */
function generateDailyReport(projectDir) {
  const report = generateProgressReport(projectDir);
  const date = isoDate();

  const daily = {
    date,
    generated: report.generated,
    project: report.project,
    phase: report.phase,
    completion: report.completion,
    health_score: report.health ? report.health.score : null,
    health_trend: report.health ? report.health.trend : 'stable',
    tasks_done_today: 0,
    tasks_total: report.tasks.total,
    tasks_completed: report.tasks.done,
    milestones_summary: report.milestones.summary,
    stalls: report.stalls.stalled ? report.stalls.message : 'none',
    decisions_pending: report.decisions.pending,
  };

  // Count tasks done today
  const tasksPath = path.join(projectDir, '.ezra', 'progress', 'tasks.yaml');
  const tasksData = readDeepYaml(tasksPath);
  if (tasksData.tasks && Array.isArray(tasksData.tasks)) {
    daily.tasks_done_today = tasksData.tasks.filter(t =>
      t.status === 'done' && t.updated && t.updated.startsWith(date)
    ).length;
  }

  // Write report
  const reportsDir = path.join(projectDir, '.ezra', 'progress', 'reports');
  ensureDir(reportsDir);
  const reportPath = path.join(reportsDir, `daily-${date}.yaml`);
  writeYaml(reportPath, daily);

  return daily;
}

/**
 * Update progress: add or update a task in tasks.yaml.
 */
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

  // Serialize tasks back to YAML
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

// ─── Exports ─────────────────────────────────────────────────────

module.exports = {
  loadProjectState,
  checkMilestones,
  detectStalls,
  generateProgressReport,
  calculateHealthTrend,
  checkEscalation,
  generateDailyReport,
  updateProgress,
  PM_DEFAULTS,
};

// ─── Hook Protocol (stdin → stdout → exit 0) ─────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > MAX_STDIN) { process.exit(0); }
});
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      const cwd = event.cwd || process.cwd();
      const report = generateProgressReport(cwd);
      process.stdout.write(JSON.stringify(report));
    } catch {
      const msg = _fmt('PM_001', { detail: 'Hook protocol error' });
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-pm', 'warn', msg);
      process.stdout.write('{}');
    }
    process.exit(0);
  });
}
