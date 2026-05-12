#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

/**
 * EZRA Dashboard Data Engine
 * Collects health data from .ezra/ state for portfolio dashboards and handoff briefs.
 * Zero external dependencies.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MAX_PORTFOLIO_PROJECTS = 50; // Safety limit for portfolio dashboard (GAP-031)

// GAP-021: Atomic write helper (with Windows EPERM retry)
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

// ─── YAML Helpers ────────────────────────────────────────────────

function readYaml(filePath) {
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
        result[key] = parseVal(val);
        currentKey = key;
      }
    } else if (currentKey && trimmed.startsWith('- ')) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(trimmed.slice(2).trim());
    }
  }
  return result;
}

function parseVal(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
  if (val.startsWith('[') && val.endsWith(']')) {
    return val.slice(1, -1).split(',').map(s => parseVal(s.trim())).filter(Boolean);
  }
  return val;
}

function writeYaml(filePath, data) {
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

// ─── Portfolio Config ────────────────────────────────────────────

const PORTFOLIO_FILE = '.ezra-portfolio.yaml';

function getPortfolioPath() {
  return path.join(os.homedir(), PORTFOLIO_FILE);
}

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
  for (const proj of (portfolio.projects || [])) {
    lines.push('  - name: ' + proj.name);
    lines.push('    path: ' + proj.path);
  }
  atomicWriteFileSync(getPortfolioPath(), lines.join('\n') + '\n', 'utf8');
}

// ─── Project Health Collection ───────────────────────────────────

function collectProjectHealth(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(ezraDir)) {
    return {
      initialized: false,
      health_score: null,
      version: null,
      decisions_count: 0,
      drift_level: null,
      last_scan: null,
      name: path.basename(projectDir),
    };
  }

  const result = {
    initialized: true,
    name: path.basename(projectDir),
    health_score: null,
    version: null,
    decisions_count: 0,
    drift_level: null,
    last_scan: null,
  };

  // Health score + version from versions/current.yaml
  const currentPath = path.join(ezraDir, 'versions', 'current.yaml');
  if (fs.existsSync(currentPath)) {
    const current = readYaml(currentPath);
    result.health_score = current.health_score || current.score || null;
    result.version = current.version || null;
  }

  // Decisions count
  const decisionsDir = path.join(ezraDir, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    result.decisions_count = fs.readdirSync(decisionsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.md')).length;
  }

  // Drift level from docs/.drift-counter.json
  const driftPath = path.join(ezraDir, 'docs', '.drift-counter.json');
  if (fs.existsSync(driftPath)) {
    try {
      const drift = JSON.parse(fs.readFileSync(driftPath, 'utf8'));
      result.drift_level = drift.count || drift.edits || 0;
    } catch (e) {
      result.drift_level = 0;
    }
  }

  // Last scan date
  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) {
    const scans = fs.readdirSync(scansDir)
      .filter(f => f.endsWith('.yaml'))
      .sort()
      .reverse();
    if (scans.length > 0) {
      const lastScan = readYaml(path.join(scansDir, scans[0]));
      result.last_scan = lastScan.date || lastScan.timestamp || scans[0].replace('.yaml', '');
    }
  }

  return result;
}

// ─── Portfolio Dashboard ─────────────────────────────────────────

function generatePortfolioDashboard() {
  const portfolio = loadPortfolio();
  if (!portfolio.projects || portfolio.projects.length === 0) {
    return {
      generated: new Date().toISOString().slice(0, 10),
      projects: [],
      warnings: ['No projects configured. Add projects to ~/.ezra-portfolio.yaml'],
    };
  }

  const projects = [];
  const warnings = [];

  // GAP-031: Limit portfolio size to prevent unbounded memory usage
  const projectList = portfolio.projects.slice(0, MAX_PORTFOLIO_PROJECTS);
  if (portfolio.projects.length > MAX_PORTFOLIO_PROJECTS) {
    warnings.push('Portfolio truncated to ' + MAX_PORTFOLIO_PROJECTS + ' projects (total: ' + portfolio.projects.length + ')');
  }

  for (const proj of projectList) {
    const health = collectProjectHealth(proj.path);
    health.name = proj.name || health.name;
    projects.push(health);

    if (!health.initialized) {
      warnings.push(proj.name + ': EZRA not initialized');
    } else if (health.drift_level !== null && health.drift_level > 10) {
      warnings.push(proj.name + ': drift threshold exceeded (' + health.drift_level + ' edits)');
    }
  }

  return {
    generated: new Date().toISOString().slice(0, 10),
    projects,
    warnings,
  };
}

function formatPortfolioDashboard(dashboard) {
  const lines = [
    'EZRA PORTFOLIO HEALTH',
    String.fromCharCode(9552).repeat(55),
    '',
  ];

  if (dashboard.projects.length === 0) {
    lines.push('No projects configured.');
    lines.push('Add projects to ~/.ezra-portfolio.yaml');
    return lines.join('\n');
  }

  // Header
  lines.push(padRight('Project', 20) + padRight('Health', 10) + padRight('Decisions', 12) + padRight('Drift', 10) + 'Last Scan');
  lines.push(String.fromCharCode(9472).repeat(65));

  for (const proj of dashboard.projects) {
    const health = proj.health_score !== null ? proj.health_score + '/100' : String.fromCharCode(8212) + '/100';
    const decisions = proj.decisions_count + ' active';
    const drift = proj.drift_level !== null ? proj.drift_level + '/10' : String.fromCharCode(8212);
    const scan = proj.last_scan || 'Never';
    lines.push(padRight(proj.name, 20) + padRight(health, 10) + padRight(decisions, 12) + padRight(drift, 10) + scan);
  }

  if (dashboard.warnings.length > 0) {
    lines.push('');
    for (const w of dashboard.warnings) {
      lines.push(String.fromCharCode(9888) + ' ' + w);
    }
  }

  return lines.join('\n');
}

function padRight(str, len) {
  str = String(str);
  while (str.length < len) str += ' ';
  return str;
}

// ─── Handoff Brief ───────────────────────────────────────────────

function generateHandoff(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  const projectName = path.basename(projectDir);
  const date = new Date().toISOString().slice(0, 10);

  const brief = {
    project: projectName,
    date: date,
    health: null,
    version: null,
    architecture: '',
    recent_decisions: [],
    recent_changes: [],
    open_items: [],
    recent_commits: [],
  };

  if (!fs.existsSync(ezraDir)) {
    brief.open_items.push('EZRA not initialized');
    return brief;
  }

  // Health + version
  const currentPath = path.join(ezraDir, 'versions', 'current.yaml');
  if (fs.existsSync(currentPath)) {
    const current = readYaml(currentPath);
    brief.health = current.health_score || current.score || null;
    brief.version = current.version || null;
  }

  // Architecture from knowledge.yaml
  const knowledgePath = path.join(ezraDir, 'knowledge.yaml');
  if (fs.existsSync(knowledgePath)) {
    const knowledge = readYaml(knowledgePath);
    brief.architecture = knowledge.description || knowledge.summary || knowledge.architecture || '';
  }

  // Recent decisions
  const decisionsDir = path.join(ezraDir, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    const files = fs.readdirSync(decisionsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 10);
    for (const f of files) {
      const dec = readYaml(path.join(decisionsDir, f));
      brief.recent_decisions.push({
        id: dec.id || f.replace(/\.(yaml|md)$/, ''),
        title: dec.title || dec.name || f,
        status: dec.status || 'ACTIVE',
      });
    }
  }

  // Recent changes from changelog
  const changelogPath = path.join(ezraDir, 'versions', 'changelog.yaml');
  if (fs.existsSync(changelogPath)) {
    const content = fs.readFileSync(changelogPath, 'utf8');
    const entries = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        entries.push(trimmed.slice(2));
      }
    }
    brief.recent_changes = entries.slice(0, 20);
  }

  // Open items
  const driftPath = path.join(ezraDir, 'docs', '.drift-counter.json');
  if (fs.existsSync(driftPath)) {
    try {
      const drift = JSON.parse(fs.readFileSync(driftPath, 'utf8'));
      const count = drift.count || drift.edits || 0;
      if (count > 0) brief.open_items.push('Drift counter: ' + count + ' edits since last sync');
    } catch (e) { /* ignore */ }
  }

  const registryPath = path.join(ezraDir, 'docs', 'registry.yaml');
  if (fs.existsSync(registryPath)) {
    const registry = readYaml(registryPath);
    const missing = registry.missing_count || 0;
    if (missing > 0) brief.open_items.push(missing + ' critical documents missing');
  }

  // Recent git commits
  try {
    const { execSync } = require('child_process');
    const output = execSync('git log --oneline -10', { cwd: projectDir, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    brief.recent_commits = output.trim().split('\n').filter(Boolean);
  } catch (e) {
    brief.recent_commits = ['(git not available or not a git repo)'];
  }

  return brief;
}

function formatHandoff(brief) {
  const sep = String.fromCharCode(9552).repeat(55);
  const lines = [
    'EZRA HANDOFF BRIEF ' + String.fromCharCode(8212) + ' ' + brief.project + ' ' + String.fromCharCode(8212) + ' ' + brief.date,
    sep,
    '',
    'HEALTH: ' + (brief.health !== null ? brief.health + '/100' : String.fromCharCode(8212)) + ' | VERSION: ' + (brief.version || String.fromCharCode(8212)),
    '',
  ];

  if (brief.architecture) {
    lines.push('ARCHITECTURE');
    lines.push(brief.architecture);
    lines.push('');
  }

  if (brief.recent_decisions.length > 0) {
    lines.push('RECENT DECISIONS (last ' + brief.recent_decisions.length + ')');
    for (const d of brief.recent_decisions) {
      lines.push('- ' + d.id + ': ' + d.title + ' [' + d.status + ']');
    }
    lines.push('');
  }

  if (brief.recent_changes.length > 0) {
    lines.push('RECENT CHANGES (last ' + brief.recent_changes.length + ')');
    for (const c of brief.recent_changes) {
      lines.push('- ' + c);
    }
    lines.push('');
  }

  if (brief.open_items.length > 0) {
    lines.push('OPEN ITEMS');
    for (const item of brief.open_items) {
      lines.push('- ' + item);
    }
    lines.push('');
  }

  if (brief.recent_commits.length > 0) {
    lines.push('RECENT COMMITS');
    for (const c of brief.recent_commits) {
      lines.push('- ' + c);
    }
    lines.push('');
  }

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

// ─── Dashboard Export ────────────────────────────────────────────

function exportDashboardData(projectDir) {
  const health = collectProjectHealth(projectDir);
  const brief = generateHandoff(projectDir);
  return {
    collected_at: new Date().toISOString(),
    health: health,
    brief: brief,
  };
}

function saveDashboardExport(projectDir, data) {
  const exportDir = path.join(projectDir, '.ezra', 'exports');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  const filename = new Date().toISOString().slice(0, 10) + '-dashboard.yaml';
  const filePath = path.join(exportDir, filename);
  writeYaml(filePath, {
    collected_at: data.collected_at,
    health_score: data.health.health_score,
    version: data.health.version,
    decisions_count: data.health.decisions_count,
    drift_level: data.health.drift_level,
    last_scan: data.health.last_scan,
    open_items_count: data.brief.open_items.length,
    recent_decisions_count: data.brief.recent_decisions.length,
  });
  return filePath;
}

// ─── Dashboard Sync ─────────────────────────────────────────────

/**
 * Push current project state to the EZRA Dashboard.
 * Reads dashboard_url and dashboard_sync_token from .ezra/settings.yaml.
 * Uses ezra-http.js for SSRF-safe HTTPS POST.
 */
async function syncToDashboard(projectDir, action) {
  const ezraDir = path.join(projectDir, '.ezra');
  const settingsPath = path.join(ezraDir, 'settings.yaml');
  if (!fs.existsSync(settingsPath)) return { synced: false, reason: 'no settings.yaml' };

  const settings = readYaml(settingsPath);
  // Support nested and flat key formats
  const dashUrl = settings.dashboard_url || (settings.dashboard && settings.dashboard.url) || '';
  const syncToken = settings.dashboard_sync_token || (settings.dashboard && settings.dashboard.sync_token) || '';

  if (!dashUrl) return { synced: false, reason: 'dashboard_url not configured in .ezra/settings.yaml' };
  if (!syncToken) return { synced: false, reason: 'dashboard_sync_token not configured in .ezra/settings.yaml' };

  // Collect full state
  const exported = exportDashboardData(projectDir);
  const gov = readYaml(path.join(ezraDir, 'governance.yaml'));

  // Count plans
  const plansDir = path.join(ezraDir, 'plans');
  let plansCount = 0;
  if (fs.existsSync(plansDir)) {
    plansCount = fs.readdirSync(plansDir).filter(f => f.endsWith('.yaml')).length;
  }

  // Count risks
  const risksPath = path.join(ezraDir, 'risks.yaml');
  let riskCount = 0;
  if (fs.existsSync(risksPath)) {
    const risksContent = fs.readFileSync(risksPath, 'utf8');
    riskCount = (risksContent.match(/status:\s*open/gi) || []).length;
  }

  // Health grade from score
  const score = exported.health.health_score;
  let grade = 'N/A';
  if (score !== null) {
    if (score >= 90) grade = 'A';
    else if (score >= 75) grade = 'B';
    else if (score >= 60) grade = 'C';
    else if (score >= 40) grade = 'D';
    else grade = 'F';
  }

  const payload = {
    action: action || 'sync',
    project_name: gov.project || gov.name || path.basename(projectDir),
    project_path: projectDir,
    phase: gov.phase || gov.project_phase || null,
    version: exported.health.version,
    health_score: score,
    health_grade: grade,
    decisions_count: exported.health.decisions_count,
    plans_count: plansCount,
    scans_count: 0,
    drift_level: exported.health.drift_level,
    risk_count: riskCount,
    last_scan_date: exported.health.last_scan,
    open_items: exported.brief.open_items || [],
    recent_decisions: exported.brief.recent_decisions || [],
    recent_commits: exported.brief.recent_commits || [],
    architecture: exported.brief.architecture || '',
    cli_last_seen_at: new Date().toISOString(),
  };

  // Count scans
  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) {
    payload.scans_count = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).length;
  }

  // POST to dashboard
  let _http;
  try { _http = require('./ezra-http'); } catch { return { synced: false, reason: 'ezra-http.js not found' }; }

  const url = dashUrl.replace(/\/$/, '') + '/api/ezra/sync';
  try {
    const result = await _http.post(url, payload, {
      'x-ezra-sync-token': syncToken,
      'Content-Type': 'application/json',
    });
    return { synced: true, statusCode: result.statusCode, body: result.body };
  } catch (err) {
    return { synced: false, reason: err.message };
  }
}

// ─── Exports ─────────────────────────────────────────────────────

module.exports = {
  readYaml,
  writeYaml,
  parseVal,
  padRight,
  PORTFOLIO_FILE,
  getPortfolioPath,
  loadPortfolio,
  savePortfolio,
  collectProjectHealth,
  generatePortfolioDashboard,
  formatPortfolioDashboard,
  generateHandoff,
  formatHandoff,
  saveHandoff,
  exportDashboardData,
  saveDashboardExport,
  syncToDashboard,
};

// ─── Hook Protocol ───────────────────────────────────────────────

if (require.main === module) {
  // GAP-033/035: Safety timeout — if hook hangs on stdin or fs, force exit
  const HOOK_TIMEOUT = 10000; // 10 seconds max for entire hook execution
  const _hookTimer = setTimeout(() => {
    process.stdout.write(JSON.stringify({ error: 'hook_timeout', message: 'Dashboard hook exceeded ' + HOOK_TIMEOUT + 'ms' }));
    process.exit(0);
  }, HOOK_TIMEOUT);
  _hookTimer.unref(); // don't prevent exit if hook finishes normally

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    input += d;
    if (input.length > MAX_STDIN) { clearTimeout(_hookTimer); process.exit(0); }
  });
  process.stdin.on('end', async () => {
    try {
      const data = JSON.parse(input);
      const action = data.action || 'collect';
      const projectDir = data.project_dir || data.projectDir || process.cwd();
      let result;
      switch (action) {
        case 'collect':
          result = collectProjectHealth(projectDir);
          break;
        case 'portfolio':
          result = generatePortfolioDashboard();
          break;
        case 'handoff':
          result = generateHandoff(projectDir);
          break;
        case 'export':
          result = exportDashboardData(projectDir);
          break;
        case 'sync':
          result = await syncToDashboard(projectDir, data.sync_action || 'sync');
          break;
        default:
          result = { error: 'Unknown action: ' + action };
      }
      process.stdout.write(JSON.stringify(result));
    } catch (e) {
      const msg = _fmt('DASH_001', { detail: e.message });
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-dashboard-data', 'warn', msg);
      process.stdout.write(JSON.stringify({ error: e.message }));
    }
    clearTimeout(_hookTimer);
    process.exit(0);
  });
}
