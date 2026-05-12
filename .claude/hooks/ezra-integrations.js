#!/usr/bin/env node
'use strict';

/**
 * hooks/ezra-integrations.js — Consolidated Integration Module for EZRA v7
 *
 * Merges 7 hooks into one module:
 *   1. ezra-avios-bridge    — AVI-OS integration bridge
 *   2. ezra-cloud-sync      — Cloud sync (push/pull/manifest)
 *   3. ezra-session-sync    — Session sync hook
 *   4. ezra-quiz2build-client — Quiz2Build API client
 *   5. ezra-license          — License management engine
 *   6. ezra-library          — Best practice library engine
 *   7. ezra-bp-scheduler     — Best practice scheduler
 *
 * ZERO external dependencies. Pure Node.js only.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_STDIN = 1024 * 1024;
const MAX_SCAN_DEPTH = 5;
const MAX_SCAN_FILES = 10000;

// ─── Hub Imports ────────────────────────────────────────────────────────────
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

let _http;
try { _http = require('./ezra-http'); } catch { _http = null; }

// =============================================================================
//  SECTION 1: AVIOS BRIDGE
// =============================================================================

const AVIOS_CATEGORY_MAP = {
  ARCHITECTURE: 'AD',
  DATABASE: 'DD',
  SECURITY: 'SC',
  API: 'AD',
  TESTING: 'TC',
  INFRASTRUCTURE: 'AD',
  DEPENDENCY: 'TC',
  CONVENTION: 'TC'
};

function aviosParseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let currentKey = null;
  let currentList = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kvMatch = trimmed.match(/^([\w._-]+):\s*(.*)$/);
    if (kvMatch) {
      if (/^(__proto__|constructor|prototype)$/.test(kvMatch[1])) continue;
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val) {
        result[currentKey] = val;
        currentList = null;
      } else {
        result[currentKey] = [];
        currentList = currentKey;
      }
    } else if (trimmed.startsWith('- ') && currentList) {
      result[currentList].push(trimmed.slice(2).trim());
    }
  }
  return result;
}

function aviosReadGovernance(cwd) {
  const govPath = path.join(cwd, '.ezra', 'governance.yaml');
  if (!fs.existsSync(govPath)) return null;
  let gov;
  try {
    gov = aviosParseYaml(fs.readFileSync(govPath, 'utf8'));
  } catch {
    return null;
  }
  const rawText = fs.readFileSync(govPath, 'utf8');
  const enabledMatch = rawText.match(/avios_integration[\s\S]*?enabled:\s*(true|false)/);
  if (!enabledMatch || enabledMatch[1] !== 'true') return null;
  const projectId = gov.project_id || gov.name || path.basename(cwd);
  return { projectId, governance: gov };
}

function aviosEnsurePendingDir(cwd) {
  const pendingDir = path.join(cwd, '.ezra', '.avios-sync', 'pending');
  fs.mkdirSync(pendingDir, { recursive: true });
  return pendingDir;
}

function aviosWritePendingItem(pendingDir, item) {
  const id = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}_${id}.json`;
  const filePath = path.join(pendingDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf8');
  return filename;
}

function aviosProcessDecisionFile(filePath, cwd, projectId) {
  if (!fs.existsSync(filePath)) return null;
  let decision;
  try {
    decision = aviosParseYaml(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  const ezraCategory = (decision.category || 'ARCHITECTURE').toUpperCase();
  const aviosCategory = AVIOS_CATEGORY_MAP[ezraCategory] || 'AD';
  const pendingDir = aviosEnsurePendingDir(cwd);
  const item = {
    action: 'add_decision',
    project_id: projectId,
    category: aviosCategory,
    decision: decision.title || decision.decision || decision.name || path.basename(filePath, path.extname(filePath)),
    rationale: decision.rationale || decision.reason || decision.description || '',
    status: 'LOCKED',
    source_file: path.relative(cwd, filePath),
    synced_at: new Date().toISOString()
  };
  const filename = aviosWritePendingItem(pendingDir, item);
  return { type: 'decision', filename, category: aviosCategory };
}

function aviosProcessScanFile(filePath, cwd, projectId) {
  if (!fs.existsSync(filePath)) return [];
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const pendingDir = aviosEnsurePendingDir(cwd);
  const results = [];
  const findingBlocks = content.split(/---+|\n(?=finding|issue|vulnerability)/i);
  for (const block of findingBlocks) {
    const severityMatch = block.match(/severity:\s*(CRITICAL|HIGH)/i);
    if (!severityMatch) {
      if (!/CRITICAL|HIGH/i.test(block)) continue;
    }
    const severity = severityMatch
      ? severityMatch[1].toUpperCase()
      : (block.match(/CRITICAL/i) ? 'CRITICAL' : 'HIGH');
    const categoryMatch = block.match(/category:\s*(\w+)/i);
    const descMatch = block.match(/(?:description|title|message|finding):\s*(.+)/i);
    const ezraCategory = categoryMatch ? categoryMatch[1].toUpperCase() : 'SECURITY';
    const aviosCategory = AVIOS_CATEGORY_MAP[ezraCategory] || 'SC';
    const item = {
      action: 'add_risk',
      project_id: projectId,
      category: aviosCategory,
      description: descMatch
        ? descMatch[1].trim()
        : `${severity} finding from EZRA scan`,
      impact: severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      status: 'OPEN',
      source_file: path.relative(cwd, filePath),
      synced_at: new Date().toISOString()
    };
    const filename = aviosWritePendingItem(pendingDir, item);
    results.push({ type: 'risk', filename, severity });
  }
  return results;
}

function aviosBridgeHandleStdin(input) {
  const event = JSON.parse(input);
  const toolName = event.tool_name || '';
  const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
  if (!['Write', 'Edit'].includes(toolName)) return null;
  if (!filePath) return null;
  const cwd = event.cwd || process.cwd();
  const relativePath = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, '/');
  const isDecision = relativePath.startsWith('.ezra/decisions/');
  const isScan = relativePath.startsWith('.ezra/scans/');
  if (!isDecision && !isScan) return null;
  const gov = aviosReadGovernance(cwd);
  if (!gov) return null;
  const absolutePath = path.resolve(cwd, filePath);
  if (isDecision) {
    const result = aviosProcessDecisionFile(absolutePath, cwd, gov.projectId);
    if (result) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          message: `EZRA->AVI-OS: Decision queued for sync (${result.category}). Run /ezra:sync to push.`
        }
      };
    }
  } else if (isScan) {
    const results = aviosProcessScanFile(absolutePath, cwd, gov.projectId);
    if (results.length > 0) {
      const critical = results.filter(r => r.severity === 'CRITICAL').length;
      const high = results.filter(r => r.severity === 'HIGH').length;
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          message: `EZRA->AVI-OS: ${results.length} risk(s) queued (${critical} critical, ${high} high). Run /ezra:sync to push.`
        }
      };
    }
  }
  return null;
}

// =============================================================================
//  SECTION 2: CLOUD SYNC
// =============================================================================

const SYNC_DIR = '.ezra-sync';
const MANIFEST_FILE = 'sync-manifest.yaml';
const SYNC_STATE_FILE = 'sync-state.yaml';

const SYNCABLE_PATHS = [
  'governance.yaml',
  'knowledge.yaml',
  'settings.yaml',
  'decisions',
  'versions',
  'docs/registry.yaml',
  'library',
  'agents',
  'scans',
];

function cloudReadYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([\w.-]+):\s*(.*)$/);
    if (match) {
      const [, key, val] = match;
      if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
      if (val === 'true') result[key] = true;
      else if (val === 'false') result[key] = false;
      else if (val === 'null' || val === '~') result[key] = null;
      else if (/^-?\d+$/.test(val)) result[key] = parseInt(val, 10);
      else if (/^-?\d+\.\d+$/.test(val)) result[key] = parseFloat(val);
      else result[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  return result;
}

function cloudWriteYaml(filePath, data) {
  const lines = [];
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      lines.push(key + ':');
      for (const item of val) lines.push('  - ' + item);
    } else {
      lines.push(key + ': ' + (val === null ? 'null' : val));
    }
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function cloudHashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function cloudHashDir(dirPath, depth, _fileCount) {
  if (depth === undefined) depth = 0;
  if (!_fileCount) _fileCount = { count: 0, truncated: false };
  if (depth >= MAX_SCAN_DEPTH) { _fileCount.truncated = true; return null; }
  if (_fileCount.count >= MAX_SCAN_FILES) { _fileCount.truncated = true; return null; }
  if (!fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath).filter(f => !f.startsWith('.')).sort();
  const hashes = files.map(f => {
    if (_fileCount.count >= MAX_SCAN_FILES) { _fileCount.truncated = true; return null; }
    const fp = path.join(dirPath, f);
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) return cloudHashDir(fp, depth + 1, _fileCount);
    _fileCount.count++;
    return cloudHashFile(fp);
  }).filter(Boolean);
  if (hashes.length === 0) return null;
  return crypto.createHash('sha256').update(hashes.join(',')).digest('hex').slice(0, 16);
}

function cloudCountFilesInDir(dirPath, depth, _counter) {
  if (depth === undefined) depth = 0;
  if (!_counter) _counter = { total: 0 };
  if (depth >= MAX_SCAN_DEPTH) return _counter.total;
  if (_counter.total >= MAX_SCAN_FILES) return _counter.total;
  let count = 0;
  for (const f of fs.readdirSync(dirPath)) {
    if (_counter.total >= MAX_SCAN_FILES) break;
    const fp = path.join(dirPath, f);
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) {
      count += cloudCountFilesInDir(fp, depth + 1, _counter);
    } else {
      count++;
      _counter.total++;
    }
  }
  return count;
}

function cloudGenerateManifest(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(ezraDir)) return { error: 'EZRA not initialized', entries: [] };
  const entries = [];
  const now = new Date().toISOString();
  for (const syncPath of SYNCABLE_PATHS) {
    const fullPath = path.join(ezraDir, syncPath);
    if (!fs.existsSync(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    const entry = {
      path: syncPath,
      type: stat.isDirectory() ? 'directory' : 'file',
      hash: stat.isDirectory() ? cloudHashDir(fullPath) : cloudHashFile(fullPath),
      size: stat.isDirectory() ? cloudCountFilesInDir(fullPath) : stat.size,
      modified: stat.mtime.toISOString(),
    };
    entries.push(entry);
  }
  return { generated: now, project: path.basename(projectDir), entries: entries, total_entries: entries.length };
}

function cloudGetSyncDir(projectDir) {
  return path.join(projectDir, '.ezra', SYNC_DIR);
}

function cloudLoadSyncState(projectDir) {
  const statePath = path.join(cloudGetSyncDir(projectDir), SYNC_STATE_FILE);
  return cloudReadYaml(statePath);
}

function cloudSaveSyncState(projectDir, state) {
  const syncDir = cloudGetSyncDir(projectDir);
  if (!fs.existsSync(syncDir)) fs.mkdirSync(syncDir, { recursive: true });
  cloudWriteYaml(path.join(syncDir, SYNC_STATE_FILE), state);
}

function cloudCopyDirRecursive(src, dest, depth, _counter) {
  if (depth === undefined) depth = 0;
  if (!_counter) _counter = { total: 0 };
  if (depth >= MAX_SCAN_DEPTH) return;
  if (_counter.total >= MAX_SCAN_FILES) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (_counter.total >= MAX_SCAN_FILES) break;
    const srcItem = path.join(src, entry);
    const destItem = path.join(dest, entry);
    const stat = fs.statSync(srcItem);
    if (stat.isDirectory()) {
      cloudCopyDirRecursive(srcItem, destItem, depth + 1, _counter);
    } else {
      fs.copyFileSync(srcItem, destItem);
      _counter.total++;
    }
  }
}

function cloudCreateBackup(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(ezraDir)) return { error: 'EZRA not initialized' };
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const backupDir = path.join(cloudGetSyncDir(projectDir), 'backups', timestamp);
  fs.mkdirSync(backupDir, { recursive: true });
  let filesCopied = 0;
  let truncated = false;
  const copyCounter = { total: 0 };
  for (const syncPath of SYNCABLE_PATHS) {
    const srcPath = path.join(ezraDir, syncPath);
    if (!fs.existsSync(srcPath)) continue;
    const destPath = path.join(backupDir, syncPath);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      cloudCopyDirRecursive(srcPath, destPath, 0, copyCounter);
      filesCopied += cloudCountFilesInDir(srcPath);
      if (copyCounter.total >= MAX_SCAN_FILES) truncated = true;
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      filesCopied++;
    }
  }
  const manifest = cloudGenerateManifest(projectDir);
  cloudWriteYaml(path.join(backupDir, MANIFEST_FILE), {
    backup_date: new Date().toISOString(),
    files_copied: filesCopied,
    total_entries: manifest.total_entries,
    truncated: truncated,
    complete: true,
  });
  cloudSaveSyncState(projectDir, {
    last_backup: new Date().toISOString(),
    last_backup_dir: backupDir,
    files_backed_up: filesCopied,
  });
  return { backup_dir: backupDir, files_copied: filesCopied, timestamp: timestamp };
}

function cloudListBackups(projectDir) {
  const backupsDir = path.join(cloudGetSyncDir(projectDir), 'backups');
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter(d => {
      const fp = path.join(backupsDir, d);
      return fs.statSync(fp).isDirectory();
    })
    .sort()
    .reverse()
    .map(d => ({
      name: d,
      path: path.join(backupsDir, d),
      manifest: cloudReadYaml(path.join(backupsDir, d, MANIFEST_FILE)),
    }));
}

function cloudRestoreFromBackup(projectDir, backupName) {
  if (path.basename(backupName) !== backupName) {
    return { error: 'Invalid backup name: ' + backupName };
  }
  const backupDir = path.join(cloudGetSyncDir(projectDir), 'backups', backupName);
  if (!fs.existsSync(backupDir)) return { error: 'Backup not found: ' + backupName };
  const manifestPath = path.join(backupDir, MANIFEST_FILE);
  if (fs.existsSync(manifestPath)) {
    try {
      const mText = fs.readFileSync(manifestPath, 'utf8');
      if (!mText.includes('complete:') || mText.includes('complete: false')) {
        _log('cloud-sync', 'warn', 'Backup may be incomplete: ' + backupName);
      }
    } catch { /* proceed anyway */ }
  }
  const ezraDir = path.join(projectDir, '.ezra');
  let filesRestored = 0;
  for (const syncPath of SYNCABLE_PATHS) {
    const srcPath = path.join(backupDir, syncPath);
    if (!fs.existsSync(srcPath)) continue;
    const destPath = path.join(ezraDir, syncPath);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      cloudCopyDirRecursive(srcPath, destPath);
      filesRestored += cloudCountFilesInDir(srcPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      filesRestored++;
    }
  }
  cloudSaveSyncState(projectDir, {
    last_restore: new Date().toISOString(),
    restored_from: backupName,
    files_restored: filesRestored,
  });
  return { files_restored: filesRestored, restored_from: backupName };
}

function cloudDiffManifests(manifest1, manifest2) {
  const diffs = [];
  const map1 = {};
  const map2 = {};
  for (const e of manifest1.entries || []) map1[e.path] = e;
  for (const e of manifest2.entries || []) map2[e.path] = e;
  for (const p of Object.keys(map2)) {
    if (!map1[p]) {
      diffs.push({ path: p, change: 'added' });
    } else if (map1[p].hash !== map2[p].hash) {
      diffs.push({ path: p, change: 'modified', old_hash: map1[p].hash, new_hash: map2[p].hash });
    }
  }
  for (const p of Object.keys(map1)) {
    if (!map2[p]) {
      diffs.push({ path: p, change: 'removed' });
    }
  }
  return diffs;
}

function cloudReadCloudSyncSettings(projectDir) {
  const settingsPath = path.join(projectDir, '.ezra', 'settings.yaml');
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const settingsModule = require(path.join(__dirname, 'ezra-settings.js'));
    const all = settingsModule.loadSettings(projectDir);
    const cs = all.cloud_sync || {};
    return {
      enabled: cs.enabled === true,
      endpoint: cs.endpoint || undefined,
      auth_token: cs.auth_token || undefined,
      project_id: cs.project_id || undefined,
    };
  } catch {
    const content = fs.readFileSync(settingsPath, 'utf8');
    const result = {};
    const enabledMatch = content.match(/cloud_sync[\s\S]*?enabled:\s*(true|false)/);
    if (enabledMatch) result.enabled = enabledMatch[1] === 'true';
    return result;
  }
}

function cloudPushSync(projectDir) {
  const settings = cloudReadCloudSyncSettings(projectDir);
  if (settings.enabled !== true) return { skipped: true, reason: 'cloud_sync_disabled' };
  if (!settings.endpoint) return { skipped: true, reason: 'no_endpoint' };
  const ezraDir = path.join(projectDir, '.ezra');
  const payload = { project_id: settings.project_id || path.basename(projectDir) };
  const decisionsDir = path.join(ezraDir, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    payload.decisions = fs.readdirSync(decisionsDir)
      .filter(f => f.endsWith('.yaml'))
      .map(f => {
        const content = fs.readFileSync(path.join(decisionsDir, f), 'utf8');
        return { file: f, content };
      });
  }
  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) {
    const scanFiles = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).sort().reverse();
    if (scanFiles.length > 0) {
      payload.latest_scan = fs.readFileSync(path.join(scansDir, scanFiles[0]), 'utf8');
    }
  }
  const settingsPath = path.join(ezraDir, 'settings.yaml');
  if (fs.existsSync(settingsPath)) {
    payload.settings = fs.readFileSync(settingsPath, 'utf8');
  }
  const { httpsPost } = require(path.join(__dirname, 'ezra-http.js'));
  const url = settings.endpoint.replace(/\/+$/, '') + '/functions/v1/sync-push';
  const headers = {};
  if (settings.auth_token) headers['Authorization'] = 'Bearer ' + settings.auth_token;
  return httpsPost(url, payload, headers)
    .then((response) => {
      cloudSaveSyncState(projectDir, {
        last_push: new Date().toISOString(),
        push_status: response.statusCode === 200 ? 'success' : 'error',
        status_code: response.statusCode,
      });
      return { success: response.statusCode === 200, statusCode: response.statusCode, body: response.body };
    })
    .catch((err) => {
      return { success: false, reason: 'network_error', error: err.message };
    });
}

function cloudPullSync(projectDir) {
  const settings = cloudReadCloudSyncSettings(projectDir);
  if (settings.enabled !== true) return { skipped: true, reason: 'cloud_sync_disabled' };
  if (!settings.endpoint) return { skipped: true, reason: 'no_endpoint' };
  const state = cloudLoadSyncState(projectDir);
  const since = state.last_pull || '1970-01-01T00:00:00Z';
  const projectId = settings.project_id || path.basename(projectDir);
  const { httpsGet } = require(path.join(__dirname, 'ezra-http.js'));
  const url = settings.endpoint.replace(/\/+$/, '') + '/functions/v1/sync-pull?project_id=' + encodeURIComponent(projectId) + '&since=' + encodeURIComponent(since);
  const headers = {};
  if (settings.auth_token) headers['Authorization'] = 'Bearer ' + settings.auth_token;
  return httpsGet(url, headers)
    .then((response) => {
      if (response.statusCode !== 200) {
        return { success: false, statusCode: response.statusCode };
      }
      const data = typeof response.body === 'object' ? response.body : {};
      let mergedCount = 0;
      const ezraDir = path.join(projectDir, '.ezra');
      if (data.decisions && Array.isArray(data.decisions)) {
        const decisionsDir = path.join(ezraDir, 'decisions');
        if (!fs.existsSync(decisionsDir)) fs.mkdirSync(decisionsDir, { recursive: true });
        for (const d of data.decisions) {
          if (d.file && d.content) {
            const safe = path.basename(d.file);
            if (safe !== d.file || d.file.includes('..') || d.file.includes('/') || d.file.includes('\\')) continue;
            if (!safe.endsWith('.yaml') && !safe.endsWith('.yml')) continue;
            fs.writeFileSync(path.join(decisionsDir, safe), d.content, 'utf8');
            mergedCount++;
          }
        }
      }
      cloudSaveSyncState(projectDir, {
        last_pull: new Date().toISOString(),
        pull_status: 'success',
        merged_count: mergedCount,
      });
      return { success: true, merged_count: mergedCount };
    })
    .catch((err) => {
      return { success: false, reason: 'network_error', error: err.message };
    });
}

// =============================================================================
//  SECTION 3: SESSION SYNC
// =============================================================================

// Session sync is primarily a stdin hook — the logic delegates to ezra-dashboard-data
// and ezra-settings-pull. We expose nothing from module.exports but handle stdin.

function sessionSyncHandleStdin(input) {
  // Returns a Promise
  const data = JSON.parse(input);
  const projectDir = data.project_dir || data.projectDir || process.cwd();
  const dashData = require('./ezra-dashboard-data');
  return dashData.syncToDashboard(projectDir, 'session_start').then(result => {
    if (result.synced) {
      process.stderr.write('EZRA [SYNC]: Dashboard synced successfully\n');
      try {
        const pullMod = require('./ezra-settings-pull');
        const pullConfig = pullMod.pullSettings(projectDir);
        if (pullConfig.success && pullConfig.url) {
          process.stderr.write('EZRA [SYNC]: Settings pull available at ' + pullConfig.url + '\n');
        }
      } catch (pullErr) {
        // Settings pull is optional
      }
    } else {
      if (result.reason && !result.reason.includes('not configured')) {
        process.stderr.write('EZRA [SYNC]: ' + result.reason + '\n');
      }
    }
    _log(projectDir, 'ezra-session-sync', 'info', 'Session sync: ' + (result.synced ? 'OK' : result.reason));
    return result;
  });
}

// =============================================================================
//  SECTION 4: QUIZ2BUILD CLIENT
// =============================================================================

let _settings;
try { _settings = require('./ezra-settings'); } catch { _settings = null; }

const Q2B_DEFAULT_ENDPOINT = 'http://localhost:3000';

const Q2B_DOCUMENT_TYPES = [
  'architecture_dossier',
  'sdlc_playbook',
  'test_strategy',
  'security_framework',
  'api_specification',
  'deployment_guide',
  'data_model',
  'risk_register',
];

const Q2B_DIMENSIONS = [
  'modern_architecture',
  'ai_assisted_development',
  'coding_standards',
  'testing_qa',
  'security_devsecops',
  'workflow_operations',
  'documentation',
];

const EZRA_DOMAIN_MAP = {
  modern_architecture:     ['tech_stack', 'deployment_target'],
  ai_assisted_development: ['ai_tooling'],
  coding_standards:        ['standards_level'],
  testing_qa:              ['testing_requirements'],
  security_devsecops:      ['security_level'],
  workflow_operations:     ['rollback_strategy'],
  documentation:           ['documentation_level'],
};

function q2bGetEndpoint(projectDir) {
  if (_settings) {
    try {
      const s = _settings.loadSettings(projectDir);
      return (s && s.quiz2build && s.quiz2build.endpoint) || Q2B_DEFAULT_ENDPOINT;
    } catch { /* fallthrough */ }
  }
  return Q2B_DEFAULT_ENDPOINT;
}

function q2bGetApiKey(projectDir) {
  if (_settings) {
    try {
      const s = _settings.loadSettings(projectDir);
      return (s && s.quiz2build && s.quiz2build.api_key) || null;
    } catch { /* fallthrough */ }
  }
  return null;
}

function q2bBuildHeaders(apiKey) {
  const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
  return h;
}

function q2bApiRequest(endpoint, urlPath, options) {
  if (!_http) {
    return { error: 'ezra-http not available', skipped: true };
  }
  if (endpoint && endpoint.startsWith('http://') && !endpoint.includes('localhost') && !endpoint.includes('127.0.0.1')) {
    process.stderr.write('[Q2B] Warning: endpoint "' + endpoint + '" uses plain HTTP. Production endpoints must use HTTPS.\n');
  }
  const url = endpoint.replace(/\/$/, '') + urlPath;
  try {
    return _http.request(url, options);
  } catch (e) {
    return { error: e.message, skipped: true };
  }
}

function q2bLogin(endpoint, email, password) {
  return q2bApiRequest(endpoint, '/auth/login', {
    method: 'POST',
    headers: q2bBuildHeaders(null),
    body: JSON.stringify({ email, password }),
  });
}

function q2bRefreshToken(endpoint, refreshToken_) {
  return q2bApiRequest(endpoint, '/auth/refresh', {
    method: 'POST',
    headers: q2bBuildHeaders(null),
    body: JSON.stringify({ refresh_token: refreshToken_ }),
  });
}

function q2bGetSession(projectDir, sessionId) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  return q2bApiRequest(endpoint, '/scoring/' + sessionId, {
    method: 'GET',
    headers: q2bBuildHeaders(apiKey),
  });
}

function q2bImportScore(projectDir, sessionId) {
  const result = q2bGetSession(projectDir, sessionId);
  if (result.error) return result;
  return { sessionId, score: result.score || result.readiness_score || null, raw: result };
}

function q2bImportHeatmap(projectDir, sessionId) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  const result = q2bApiRequest(endpoint, '/heatmap/' + sessionId, {
    method: 'GET',
    headers: q2bBuildHeaders(apiKey),
  });
  if (result.error) return result;
  return { sessionId, heatmap: result, dimensions: Q2B_DIMENSIONS, ezra_domain_map: EZRA_DOMAIN_MAP };
}

function q2bImportFacts(projectDir, q2bProjectId) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  return q2bApiRequest(endpoint, '/facts/' + q2bProjectId, {
    method: 'GET',
    headers: q2bBuildHeaders(apiKey),
  });
}

function q2bSubmitFacts(projectDir, q2bProjectId, facts) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  if (!Array.isArray(facts) || facts.length === 0) {
    return { error: 'facts must be a non-empty array', skipped: true };
  }
  return q2bApiRequest(endpoint, '/questionnaires/dynamic/' + q2bProjectId, {
    method: 'POST',
    headers: q2bBuildHeaders(apiKey),
    body: JSON.stringify({ facts }),
  });
}

function q2bCalculateScore(projectDir, sessionId) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  const invalidate = q2bApiRequest(endpoint, '/scoring/' + sessionId + '/invalidate', {
    method: 'POST',
    headers: q2bBuildHeaders(apiKey),
    body: JSON.stringify({}),
  });
  if (invalidate.error) return invalidate;
  return q2bApiRequest(endpoint, '/scoring/calculate', {
    method: 'POST',
    headers: q2bBuildHeaders(apiKey),
    body: JSON.stringify({ session_id: sessionId }),
  });
}

function q2bGenerateDocument(projectDir, q2bProjectId, docType) {
  if (!Q2B_DOCUMENT_TYPES.includes(docType)) {
    return { error: 'Unknown document type: ' + docType, valid_types: Q2B_DOCUMENT_TYPES };
  }
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  return q2bApiRequest(endpoint, '/documents/project/' + q2bProjectId + '/generate', {
    method: 'POST',
    headers: q2bBuildHeaders(apiKey),
    body: JSON.stringify({ type: docType }),
  });
}

function q2bDownloadDocument(projectDir, docId) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  return q2bApiRequest(endpoint, '/documents/' + docId + '/download', {
    method: 'GET',
    headers: q2bBuildHeaders(apiKey),
  });
}

function q2bImportDocuments(projectDir, sessionId, docTypes) {
  const types = Array.isArray(docTypes) ? docTypes : Q2B_DOCUMENT_TYPES;
  const results = [];
  for (const t of types) {
    if (!Q2B_DOCUMENT_TYPES.includes(t)) { results.push({ type: t, error: 'unknown type' }); continue; }
    const endpoint = q2bGetEndpoint(projectDir);
    const apiKey = q2bGetApiKey(projectDir);
    const r = q2bApiRequest(endpoint, '/documents/session/' + sessionId + '?type=' + t, {
      method: 'GET',
      headers: q2bBuildHeaders(apiKey),
    });
    results.push({ type: t, ...(r.error ? { error: r.error } : { data: r }) });
  }
  return { sessionId, documents: results };
}

function q2bGetNextQuestions(projectDir, q2bProjectId) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  return q2bApiRequest(endpoint, '/scoring/next-questions', {
    method: 'POST',
    headers: q2bBuildHeaders(apiKey),
    body: JSON.stringify({ project_id: q2bProjectId }),
  });
}

function q2bRegisterGithubAdapter(projectDir, q2bAdapterId, repoUrl, token) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  return q2bApiRequest(endpoint, '/adapters/webhooks/github', {
    method: 'POST',
    headers: q2bBuildHeaders(apiKey),
    body: JSON.stringify({ adapter_id: q2bAdapterId, repo_url: repoUrl, token }),
  });
}

function q2bSyncAdapter(projectDir, adapterId) {
  const endpoint = q2bGetEndpoint(projectDir);
  const apiKey = q2bGetApiKey(projectDir);
  return q2bApiRequest(endpoint, '/adapters/configs/' + adapterId + '/sync', {
    method: 'POST',
    headers: q2bBuildHeaders(apiKey),
    body: JSON.stringify({}),
  });
}

function q2bHeatmapToRiskRegister(heatmap) {
  const risks = [];
  const severityOrder = { red: 'CRITICAL', amber: 'HIGH', green: 'LOW' };
  for (const dim of Q2B_DIMENSIONS) {
    const cells = Array.isArray(heatmap[dim]) ? heatmap[dim] :
                  (heatmap.matrix && heatmap.matrix[dim]) ? heatmap.matrix[dim] : [];
    for (const cell of cells) {
      const colour = (cell.colour || cell.color || cell.level || 'green').toLowerCase();
      if (colour === 'green') continue;
      risks.push({
        id: 'Q2B-' + dim.toUpperCase().replace(/_/g, '-') + '-' + risks.length,
        source: 'quiz2build',
        dimension: dim,
        description: cell.gap || cell.description || ('Gap in ' + dim),
        severity: severityOrder[colour] || 'MEDIUM',
        recommendation: cell.recommendation || cell.action || '',
        domains: EZRA_DOMAIN_MAP[dim] || [],
      });
    }
  }
  return risks;
}

// =============================================================================
//  SECTION 5: LICENSE
// =============================================================================

const LICENSE_TIERS = {
  core:       { name: 'Core',       price: 'Free',        requiresKey: false },
  pro:        { name: 'Pro',        price: '$29/user/mo', requiresKey: true  },
  team:       { name: 'Team',       price: '$59/user/mo', requiresKey: true  },
  enterprise: { name: 'Enterprise', price: 'Custom',      requiresKey: true  },
};

const FEATURE_TIER_MAP = {
  'oversight.level':         'core',
  'oversight.standards':     'core',
  'doc_sync':                'core',
  'workflow_custom':         'core',
  'settings':                'core',
  'init':                    'core',
  'guard':                   'core',
  'scan':                    'core',
  'status':                  'core',
  'help':                    'core',
  'health':                  'core',
  'version':                 'core',
  'multi_agent':             'pro',
  'research_agent':          'pro',
  'cloud_sync':              'pro',
  'workflow_import':         'pro',
  'memory_system':           'pro',
  'planning_engine':         'pro',
  'dashboard':               'pro',
  'compliance_profiles':     'pro',
  'self_learning':           'pro',
  'advisor':                 'pro',
  'cost_tracking':           'pro',
  'project_manager':         'team',
  'cross_project_learning':  'team',
  'portfolio':               'team',
  'handoff':                 'team',
};

const LICENSE_CACHE_FILE = 'license-cache.json';
const CACHE_MAX_DAYS = 30;
const TIER_ORDER = ['core', 'pro', 'team', 'enterprise'];

function licGetCachePath(projectDir) {
  return path.join(projectDir, '.ezra', LICENSE_CACHE_FILE);
}

function licDaysBetween(d1, d2) {
  return Math.abs(d2 - d1) / (1000 * 60 * 60 * 24);
}

function licTierRank(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx >= 0 ? idx : 0;
}

function licValidateKey(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, reason: 'key must be a non-empty string' };
  }
  const prefixes = ['ezra_pro_', 'ezra_team_', 'ezra_ent_'];
  const hasValidPrefix = prefixes.some(p => key.startsWith(p));
  if (!hasValidPrefix) {
    return { valid: false, reason: 'key must start with ezra_pro_, ezra_team_, or ezra_ent_' };
  }
  const suffix = key.slice(key.indexOf('_', 5) + 1);
  if (suffix.length < 8) {
    return { valid: false, reason: 'key suffix too short (min 8 chars)' };
  }
  let tier = 'pro';
  if (key.startsWith('ezra_team_')) tier = 'team';
  if (key.startsWith('ezra_ent_')) tier = 'enterprise';
  return { valid: true, tier, prefix: key.split('_').slice(0, 2).join('_') + '_' };
}

function licComputeCacheHmac(dataStr) {
  const hmacKey = 'ezra-license-' + (process.env.USER || process.env.USERNAME || 'default');
  return crypto.createHmac('sha256', hmacKey).update(dataStr).digest('hex');
}

function licGetCachedLicense(projectDir) {
  const cachePath = licGetCachePath(projectDir);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (raw && raw._hmac && raw._data) {
      const expected = licComputeCacheHmac(raw._data);
      if (!crypto.timingSafeEqual(Buffer.from(raw._hmac, 'hex'), Buffer.from(expected, 'hex'))) {
        return null;
      }
      return JSON.parse(raw._data);
    }
    return raw;
  } catch {
    return null;
  }
}

function licWriteLicenseCache(projectDir, cacheData) {
  const cachePath = licGetCachePath(projectDir);
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dataStr = JSON.stringify(cacheData, null, 2);
  const hmac = licComputeCacheHmac(dataStr);
  const wrapped = JSON.stringify({ _data: dataStr, _hmac: hmac }, null, 2);
  fs.writeFileSync(cachePath, wrapped, 'utf8');
  return { success: true, path: cachePath };
}

function licCheckLicense(projectDir) {
  let tier = 'core';
  const settingsPath = path.join(projectDir, '.ezra', 'settings.yaml');
  if (fs.existsSync(settingsPath)) {
    const content = fs.readFileSync(settingsPath, 'utf8');
    const tierMatch = content.match(/^  tier:\s*(.+)/m) || content.match(/tier:\s*(.+)/m);
    if (tierMatch) {
      const parsed = tierMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (TIER_ORDER.includes(parsed)) tier = parsed;
    }
  }
  if (tier === 'core') {
    return {
      valid: true,
      tier: 'core',
      expires: null,
      features_available: Object.keys(FEATURE_TIER_MAP).filter(f => FEATURE_TIER_MAP[f] === 'core'),
      features_locked: Object.keys(FEATURE_TIER_MAP).filter(f => FEATURE_TIER_MAP[f] !== 'core'),
    };
  }
  const cache = licGetCachedLicense(projectDir);
  if (!cache) {
    return {
      valid: false, tier, reason: 'no_cache', action: 'revalidate',
      features_available: [], features_locked: Object.keys(FEATURE_TIER_MAP),
    };
  }
  try {
    const validatedAt = new Date(cache.validated_at);
    const now = new Date();
    const age = licDaysBetween(validatedAt, now);
    if (age > CACHE_MAX_DAYS) {
      return {
        valid: false, tier, reason: 'cache_expired', action: 'revalidate',
        cache_age_days: Math.round(age),
        features_available: [], features_locked: Object.keys(FEATURE_TIER_MAP),
      };
    }
    const currentRank = licTierRank(cache.tier || tier);
    const available = Object.keys(FEATURE_TIER_MAP).filter(f => licTierRank(FEATURE_TIER_MAP[f]) <= currentRank);
    const locked = Object.keys(FEATURE_TIER_MAP).filter(f => licTierRank(FEATURE_TIER_MAP[f]) > currentRank);
    return {
      valid: true, tier: cache.tier || tier, expires: cache.expires_at || null,
      seats: cache.seats || 1, cache_age_days: Math.round(age),
      features_available: available, features_locked: locked,
    };
  } catch {
    return {
      valid: false, tier, reason: 'cache_corrupted', action: 'revalidate',
      features_available: [], features_locked: Object.keys(FEATURE_TIER_MAP),
    };
  }
}

function licIsFeatureAvailable(projectDir, feature) {
  const requiredTier = FEATURE_TIER_MAP[feature];
  if (!requiredTier) return { available: true, reason: 'unmapped_feature' };
  if (requiredTier === 'core') return { available: true, tier: 'core' };
  const license = licCheckLicense(projectDir);
  if (!license.valid) {
    return { available: false, requiredTier, currentTier: license.tier, reason: license.reason };
  }
  const currentRank = licTierRank(license.tier);
  const requiredRank = licTierRank(requiredTier);
  if (currentRank >= requiredRank) {
    return { available: true, tier: license.tier, requiredTier };
  }
  return {
    available: false, currentTier: license.tier, requiredTier,
    reason: 'insufficient_tier',
    upgrade: 'Requires EZRA ' + LICENSE_TIERS[requiredTier].name + '. Upgrade at ezra.dev/pricing',
  };
}

function licGetLicenseStatus(projectDir) {
  const license = licCheckLicense(projectDir);
  return {
    tier: license.tier, valid: license.valid,
    features_available: license.features_available ? license.features_available.length : 0,
    features_locked: license.features_locked ? license.features_locked.length : 0,
    expires: license.expires || null, reason: license.reason || null,
  };
}

function licReadCloudSettings(projectDir) {
  const settingsPath = path.join(projectDir, '.ezra', 'settings.yaml');
  if (!fs.existsSync(settingsPath)) return {};
  const content = fs.readFileSync(settingsPath, 'utf8');
  const result = {};
  const endpointMatch = content.match(/endpoint:\s*['"]?([^\s'"]+)/);
  if (endpointMatch) result.endpoint = endpointMatch[1];
  const keyMatch = content.match(/license_key:\s*['"]?([^\s'"]+)/);
  if (keyMatch) result.license_key = keyMatch[1];
  return result;
}

function licRefreshLicense(projectDir) {
  const cache = licGetCachedLicense(projectDir);
  if (cache) {
    try {
      const validatedAt = new Date(cache.validated_at);
      const now = new Date();
      const age = licDaysBetween(validatedAt, now);
      if (age < CACHE_MAX_DAYS) {
        return { valid: cache.valid !== false, tier: cache.tier || 'core', cached: true, cache_age_days: Math.round(age) };
      }
    } catch {
      // Cache corrupted, will revalidate
    }
  }
  const cloudSettings = licReadCloudSettings(projectDir);
  if (!cloudSettings.endpoint || !cloudSettings.license_key) {
    const fallbackCache = licGetCachedLicense(projectDir);
    if (fallbackCache) {
      return { valid: fallbackCache.valid !== false, tier: fallbackCache.tier || 'core', cached: true, reason: 'no_endpoint' };
    }
    return { valid: true, tier: 'core', cached: false, reason: 'no_endpoint' };
  }
  const { httpsPost } = require(path.join(__dirname, 'ezra-http.js'));
  const url = cloudSettings.endpoint.replace(/\/+$/, '') + '/functions/v1/validate-license';
  return httpsPost(url, { key: cloudSettings.license_key })
    .then((response) => {
      const result = typeof response.body === 'object' ? response.body : {};
      const cacheData = {
        valid: result.valid !== false,
        tier: result.tier || 'core',
        expires_at: result.expires_at || null,
        seats: result.seats || 1,
        validated_at: new Date().toISOString(),
      };
      licWriteLicenseCache(projectDir, cacheData);
      return { valid: cacheData.valid, tier: cacheData.tier, cached: false };
    })
    .catch(() => {
      const cachedData = licGetCachedLicense(projectDir);
      if (cachedData) {
        return { valid: cachedData.valid !== false, tier: cachedData.tier || 'core', cached: true, reason: 'network_error' };
      }
      return { valid: true, tier: 'core', cached: false, reason: 'network_error' };
    });
}

// =============================================================================
//  SECTION 6: LIBRARY
// =============================================================================

const LIBRARY_CATEGORIES = [
  'code-quality', 'security', 'testing', 'architecture', 'devops',
  'ui-ux', 'performance', 'documentation', 'process-qc', 'iso-standards',
  'compliance', 'ai-agent', 'database', 'api-design',
];

const ENTRY_SCHEMA = {
  id: 'string', title: 'string', description: 'string', category: 'string',
  subcategory: 'string', source_url: 'string', date_added: 'string',
  date_verified: 'string', relevance_score: 'number', applicable_to: 'array',
  tags: 'array', severity: 'string',
};

const SEVERITY_LEVELS = ['info', 'advisory', 'recommended', 'required'];

function libSerializeEntry(entry) {
  const lines = [];
  lines.push('- id: ' + entry.id);
  lines.push('  title: "' + (entry.title || '').replace(/"/g, '\\"') + '"');
  lines.push('  description: "' + (entry.description || '').replace(/"/g, '\\"') + '"');
  lines.push('  category: ' + (entry.category || ''));
  lines.push('  subcategory: ' + (entry.subcategory || ''));
  lines.push('  source_url: "' + (entry.source_url || '') + '"');
  lines.push('  date_added: ' + (entry.date_added || ''));
  lines.push('  date_verified: ' + (entry.date_verified || ''));
  lines.push('  relevance_score: ' + (entry.relevance_score || 0));
  lines.push('  applicable_to: [' + (entry.applicable_to || []).join(', ') + ']');
  lines.push('  tags: [' + (entry.tags || []).join(', ') + ']');
  lines.push('  severity: ' + (entry.severity || 'info'));
  return lines.join('\n');
}

function libSerializeEntries(entries) {
  if (!entries || entries.length === 0) return 'entries: []\n';
  return 'entries:\n' + entries.map(e => libSerializeEntry(e)).join('\n') + '\n';
}

function libParseEntries(text) {
  const entries = [];
  if (!text || !text.includes('entries:')) return entries;
  const entryBlocks = text.split(/^- id:/m);
  for (let i = 1; i < entryBlocks.length; i++) {
    const block = '- id:' + entryBlocks[i];
    const entry = {};
    const lines = block.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- id:')) entry.id = trimmed.slice(5).trim();
      else if (trimmed.startsWith('id:')) entry.id = trimmed.slice(3).trim();
      else if (trimmed.startsWith('title:')) entry.title = trimmed.slice(6).trim().replace(/^"|"$/g, '');
      else if (trimmed.startsWith('description:')) entry.description = trimmed.slice(12).trim().replace(/^"|"$/g, '');
      else if (trimmed.startsWith('category:')) entry.category = trimmed.slice(9).trim();
      else if (trimmed.startsWith('subcategory:')) entry.subcategory = trimmed.slice(12).trim();
      else if (trimmed.startsWith('source_url:')) entry.source_url = trimmed.slice(11).trim().replace(/^"|"$/g, '');
      else if (trimmed.startsWith('date_added:')) entry.date_added = trimmed.slice(11).trim();
      else if (trimmed.startsWith('date_verified:')) entry.date_verified = trimmed.slice(14).trim();
      else if (trimmed.startsWith('relevance_score:')) entry.relevance_score = parseInt(trimmed.slice(16).trim()) || 0;
      else if (trimmed.startsWith('applicable_to:')) {
        const inner = trimmed.slice(14).trim();
        if (inner.startsWith('[') && inner.endsWith(']')) {
          const arr = inner.slice(1, -1).trim();
          entry.applicable_to = arr === '' ? [] : arr.split(',').map(s => s.trim());
        } else { entry.applicable_to = []; }
      }
      else if (trimmed.startsWith('tags:')) {
        const inner = trimmed.slice(5).trim();
        if (inner.startsWith('[') && inner.endsWith(']')) {
          const arr = inner.slice(1, -1).trim();
          entry.tags = arr === '' ? [] : arr.split(',').map(s => s.trim());
        } else { entry.tags = []; }
      }
      else if (trimmed.startsWith('severity:')) entry.severity = trimmed.slice(9).trim();
    }
    if (entry.id) entries.push(entry);
  }
  return entries;
}

function libGetSeedData() {
  const now = new Date().toISOString().slice(0, 10);
  return {
    'code-quality': [
      { id: 'cq-001', title: 'Use strict mode in all modules', description: 'Always include use strict to catch common errors early.', category: 'code-quality', subcategory: 'general', source_url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Strict_mode', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['js', 'ts'], tags: ['strict', 'safety'], severity: 'required' },
      { id: 'cq-002', title: 'Keep functions under 30 lines', description: 'Shorter functions are easier to test, read, and maintain.', category: 'code-quality', subcategory: 'complexity', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['complexity', 'readability'], severity: 'recommended' },
      { id: 'cq-003', title: 'Prefer const over let', description: 'Use const by default; only use let when reassignment is necessary.', category: 'code-quality', subcategory: 'variables', source_url: '', date_added: now, date_verified: now, relevance_score: 7, applicable_to: ['js', 'ts'], tags: ['variables', 'immutability'], severity: 'recommended' },
      { id: 'cq-004', title: 'No unused variables or imports', description: 'Remove all dead code to improve clarity and reduce bundle size.', category: 'code-quality', subcategory: 'cleanup', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['cleanup', 'lint'], severity: 'required' },
    ],
    'security': [
      { id: 'sec-001', title: 'Never store secrets in code', description: 'Use environment variables or secret managers for all credentials.', category: 'security', subcategory: 'secrets', source_url: 'https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password', date_added: now, date_verified: now, relevance_score: 10, applicable_to: ['all'], tags: ['secrets', 'owasp'], severity: 'required' },
      { id: 'sec-002', title: 'Validate all inputs', description: 'Every user input, API parameter, and file path must be validated.', category: 'security', subcategory: 'validation', source_url: 'https://owasp.org/www-community/Input_Validation_Cheat_Sheet', date_added: now, date_verified: now, relevance_score: 10, applicable_to: ['all'], tags: ['validation', 'owasp'], severity: 'required' },
      { id: 'sec-003', title: 'Use parameterised queries', description: 'Never concatenate user input into SQL or NoSQL queries.', category: 'security', subcategory: 'injection', source_url: 'https://owasp.org/www-community/attacks/SQL_Injection', date_added: now, date_verified: now, relevance_score: 10, applicable_to: ['all'], tags: ['sql', 'injection', 'owasp'], severity: 'required' },
      { id: 'sec-004', title: 'Enforce HTTPS everywhere', description: 'All network communication must use TLS/HTTPS.', category: 'security', subcategory: 'transport', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['web', 'api'], tags: ['https', 'tls'], severity: 'required' },
      { id: 'sec-005', title: 'Apply rate limiting to public endpoints', description: 'Prevent abuse by rate limiting authentication and API endpoints.', category: 'security', subcategory: 'dos', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['api', 'web'], tags: ['rate-limit', 'dos'], severity: 'recommended' },
    ],
    'testing': [
      { id: 'test-001', title: 'Aim for 80%+ code coverage', description: 'Test coverage should be at least 80% for production code.', category: 'testing', subcategory: 'coverage', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['coverage'], severity: 'recommended' },
      { id: 'test-002', title: 'Write tests before fixing bugs', description: 'Create a failing test that reproduces the bug before writing the fix.', category: 'testing', subcategory: 'methodology', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['tdd', 'bugs'], severity: 'recommended' },
      { id: 'test-003', title: 'Test edge cases and error paths', description: 'Cover null, empty, boundary, and error cases in every test suite.', category: 'testing', subcategory: 'edges', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['edge-cases', 'errors'], severity: 'required' },
    ],
    'architecture': [
      { id: 'arch-001', title: 'Enforce single responsibility principle', description: 'Each module or class should have exactly one reason to change.', category: 'architecture', subcategory: 'solid', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['solid', 'srp'], severity: 'required' },
      { id: 'arch-002', title: 'Define clear layer boundaries', description: 'Separate presentation, business logic, and data access layers.', category: 'architecture', subcategory: 'layers', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['layers', 'separation'], severity: 'required' },
      { id: 'arch-003', title: 'Document decisions as ADRs', description: 'Record all significant architectural decisions in a persistent format.', category: 'architecture', subcategory: 'decisions', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['adr', 'decisions'], severity: 'recommended' },
    ],
    'devops': [
      { id: 'devops-001', title: 'Automate CI/CD pipelines', description: 'Every merge to main should trigger automated build, test, and deploy.', category: 'devops', subcategory: 'ci-cd', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['ci', 'cd', 'automation'], severity: 'required' },
      { id: 'devops-002', title: 'Use infrastructure as code', description: 'Define all infrastructure in version-controlled templates.', category: 'devops', subcategory: 'iac', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['iac', 'terraform', 'bicep'], severity: 'recommended' },
      { id: 'devops-003', title: 'Monitor production with alerts', description: 'Set up dashboards and alerts for key metrics and error rates.', category: 'devops', subcategory: 'monitoring', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['monitoring', 'alerts'], severity: 'recommended' },
    ],
    'ui-ux': [
      { id: 'ux-001', title: 'Provide loading states for async operations', description: 'Show spinners, skeletons, or progress indicators for all async work.', category: 'ui-ux', subcategory: 'feedback', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['web', 'mobile'], tags: ['loading', 'ux'], severity: 'recommended' },
      { id: 'ux-002', title: 'Support keyboard navigation', description: 'All interactive elements must be accessible via keyboard.', category: 'ui-ux', subcategory: 'accessibility', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['web'], tags: ['a11y', 'keyboard'], severity: 'required' },
      { id: 'ux-003', title: 'Show clear error messages', description: 'Error messages should explain what happened and how to fix it.', category: 'ui-ux', subcategory: 'errors', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['web', 'mobile'], tags: ['errors', 'ux'], severity: 'recommended' },
    ],
    'performance': [
      { id: 'perf-001', title: 'Lazy load non-critical resources', description: 'Defer loading of below-the-fold content and non-essential scripts.', category: 'performance', subcategory: 'loading', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['web'], tags: ['lazy-load', 'bundle'], severity: 'recommended' },
      { id: 'perf-002', title: 'Use caching for repeated reads', description: 'Cache API responses, database queries, and computed values.', category: 'performance', subcategory: 'caching', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['caching'], severity: 'recommended' },
      { id: 'perf-003', title: 'Avoid N+1 query patterns', description: 'Use eager loading or batch queries to prevent N+1 database issues.', category: 'performance', subcategory: 'database', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['n+1', 'database'], severity: 'required' },
    ],
    'documentation': [
      { id: 'doc-001', title: 'Keep README current', description: 'README should reflect the current state of setup, usage, and architecture.', category: 'documentation', subcategory: 'readme', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['readme'], severity: 'recommended' },
      { id: 'doc-002', title: 'Document API endpoints', description: 'All public API endpoints need clear request/response documentation.', category: 'documentation', subcategory: 'api', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['api'], tags: ['api', 'openapi'], severity: 'required' },
      { id: 'doc-003', title: 'Add inline comments for complex logic', description: 'Non-obvious algorithms and business rules need explanatory comments.', category: 'documentation', subcategory: 'code', source_url: '', date_added: now, date_verified: now, relevance_score: 7, applicable_to: ['all'], tags: ['comments'], severity: 'advisory' },
    ],
    'process-qc': [
      { id: 'pqc-001', title: 'Require code reviews for all merges', description: 'No code reaches main without peer review.', category: 'process-qc', subcategory: 'review', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['review', 'pr'], severity: 'required' },
      { id: 'pqc-002', title: 'Run linting before commit', description: 'Enforce lint rules in pre-commit hooks or CI.', category: 'process-qc', subcategory: 'lint', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['lint', 'pre-commit'], severity: 'recommended' },
      { id: 'pqc-003', title: 'Track technical debt explicitly', description: 'Maintain a tech debt register with severity and remediation priority.', category: 'process-qc', subcategory: 'debt', source_url: '', date_added: now, date_verified: now, relevance_score: 7, applicable_to: ['all'], tags: ['tech-debt'], severity: 'advisory' },
    ],
    'iso-standards': [
      { id: 'iso-001', title: 'Align with ISO 25010 quality model', description: 'Map quality attributes to the 8 ISO 25010 characteristics.', category: 'iso-standards', subcategory: '25010', source_url: 'https://iso25000.com/index.php/en/iso-25000-standards/iso-25010', date_added: now, date_verified: now, relevance_score: 7, applicable_to: ['all'], tags: ['iso', '25010'], severity: 'advisory' },
      { id: 'iso-002', title: 'Define measurable quality metrics', description: 'Each quality characteristic should have quantifiable metrics.', category: 'iso-standards', subcategory: 'metrics', source_url: '', date_added: now, date_verified: now, relevance_score: 7, applicable_to: ['all'], tags: ['metrics', 'quality'], severity: 'advisory' },
      { id: 'iso-003', title: 'Document quality requirements', description: 'Quality requirements should be explicit and testable.', category: 'iso-standards', subcategory: 'requirements', source_url: '', date_added: now, date_verified: now, relevance_score: 7, applicable_to: ['all'], tags: ['requirements'], severity: 'advisory' },
    ],
    'compliance': [
      { id: 'comp-001', title: 'Implement data retention policies', description: 'Define and enforce how long data is kept and when it is purged.', category: 'compliance', subcategory: 'data', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['data', 'retention', 'gdpr'], severity: 'recommended' },
      { id: 'comp-002', title: 'Log all access to sensitive data', description: 'Audit trail for who accessed what data and when.', category: 'compliance', subcategory: 'audit', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['audit', 'logging'], severity: 'required' },
      { id: 'comp-003', title: 'Obtain and track consent', description: 'For GDPR/HIPAA ensure user consent is recorded and revocable.', category: 'compliance', subcategory: 'consent', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['web', 'mobile'], tags: ['consent', 'gdpr', 'hipaa'], severity: 'recommended' },
    ],
    'ai-agent': [
      { id: 'ai-001', title: 'Guard agent output before applying', description: 'Always validate AI-generated code against governance rules before committing.', category: 'ai-agent', subcategory: 'safety', source_url: '', date_added: now, date_verified: now, relevance_score: 10, applicable_to: ['all'], tags: ['ai', 'safety', 'guard'], severity: 'required' },
      { id: 'ai-002', title: 'Log all agent actions', description: 'Every action taken by an AI agent must be logged for audit.', category: 'ai-agent', subcategory: 'audit', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['ai', 'audit', 'logging'], severity: 'required' },
      { id: 'ai-003', title: 'Set token and cost budgets', description: 'Enforce per-task and per-day token limits to control costs.', category: 'ai-agent', subcategory: 'budget', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['ai', 'budget', 'tokens'], severity: 'recommended' },
    ],
    'database': [
      { id: 'db-001', title: 'Use migrations for schema changes', description: 'Never modify database schemas manually; use versioned migrations.', category: 'database', subcategory: 'migrations', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['migrations', 'schema'], severity: 'required' },
      { id: 'db-002', title: 'Index columns used in WHERE clauses', description: 'Add indexes for frequently queried columns to avoid full scans.', category: 'database', subcategory: 'indexes', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['all'], tags: ['indexes', 'performance'], severity: 'recommended' },
      { id: 'db-003', title: 'Back up databases regularly', description: 'Automated backups with tested restore procedures.', category: 'database', subcategory: 'backup', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['all'], tags: ['backup', 'recovery'], severity: 'required' },
    ],
    'api-design': [
      { id: 'api-001', title: 'Use consistent naming conventions', description: 'API endpoints should follow RESTful naming with plural nouns.', category: 'api-design', subcategory: 'naming', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['api'], tags: ['rest', 'naming'], severity: 'recommended' },
      { id: 'api-002', title: 'Version your API', description: 'Include version in URL or headers to support backward compatibility.', category: 'api-design', subcategory: 'versioning', source_url: '', date_added: now, date_verified: now, relevance_score: 8, applicable_to: ['api'], tags: ['versioning'], severity: 'recommended' },
      { id: 'api-003', title: 'Return proper HTTP status codes', description: 'Use 200, 201, 400, 401, 403, 404, 500 appropriately.', category: 'api-design', subcategory: 'status-codes', source_url: '', date_added: now, date_verified: now, relevance_score: 9, applicable_to: ['api'], tags: ['http', 'status-codes'], severity: 'required' },
    ],
  };
}

const LIB_EXT_CATEGORY_MAP = {
  '.js': ['code-quality', 'security', 'testing'],
  '.ts': ['code-quality', 'security', 'testing'],
  '.jsx': ['code-quality', 'ui-ux', 'performance'],
  '.tsx': ['code-quality', 'ui-ux', 'performance'],
  '.css': ['ui-ux', 'performance'],
  '.scss': ['ui-ux', 'performance'],
  '.html': ['ui-ux', 'security'],
  '.sql': ['database', 'security'],
  '.prisma': ['database'],
  '.yaml': ['devops', 'process-qc'],
  '.yml': ['devops', 'process-qc'],
  '.json': ['api-design', 'devops'],
  '.md': ['documentation'],
  '.dockerfile': ['devops', 'security'],
  '.tf': ['devops'],
  '.bicep': ['devops'],
  '.py': ['code-quality', 'security', 'testing'],
};

function libGetLibraryDir(projectDir) {
  return path.join(projectDir, '.ezra', 'library');
}

function libGetCategoryPath(projectDir, category) {
  return path.join(libGetLibraryDir(projectDir), category + '.yaml');
}

function libGetMetaPath(projectDir) {
  return path.join(libGetLibraryDir(projectDir), 'meta.yaml');
}

function libGetCategories() {
  return LIBRARY_CATEGORIES.slice();
}

function libInitLibrary(projectDir) {
  const libDir = libGetLibraryDir(projectDir);
  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
  const seed = libGetSeedData();
  for (const cat of LIBRARY_CATEGORIES) {
    const catPath = libGetCategoryPath(projectDir, cat);
    const entries = seed[cat] || [];
    fs.writeFileSync(catPath, libSerializeEntries(entries), 'utf8');
  }
  const totalEntries = Object.values(seed).reduce((sum, arr) => sum + arr.length, 0);
  const meta = [
    'last_update: ' + new Date().toISOString().slice(0, 10),
    'total_entries: ' + totalEntries,
    'categories: ' + LIBRARY_CATEGORIES.length,
    'research_agent_status: not_configured',
  ].join('\n') + '\n';
  fs.writeFileSync(libGetMetaPath(projectDir), meta, 'utf8');
  return { categories: LIBRARY_CATEGORIES.length, entries: totalEntries };
}

const _libEntryCache = {};

function libGetEntries(projectDir, category, filter) {
  if (!LIBRARY_CATEGORIES.includes(category)) return [];
  const catPath = libGetCategoryPath(projectDir, category);
  if (!fs.existsSync(catPath)) return [];
  let entries;
  try {
    const stat = fs.statSync(catPath);
    const cached = _libEntryCache[catPath];
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      entries = cached.entries;
    } else {
      const text = fs.readFileSync(catPath, 'utf8');
      entries = libParseEntries(text);
      _libEntryCache[catPath] = { mtimeMs: stat.mtimeMs, entries };
    }
  } catch {
    const text = fs.readFileSync(catPath, 'utf8');
    entries = libParseEntries(text);
  }
  if (filter) {
    const f = String(filter).toLowerCase();
    entries = entries.filter(e =>
      (e.title && e.title.toLowerCase().includes(f)) ||
      (e.description && e.description.toLowerCase().includes(f)) ||
      (e.tags && e.tags.some(t => t.toLowerCase().includes(f)))
    );
  }
  return entries;
}

function libAddEntry(projectDir, entry) {
  if (!entry || !entry.id || !entry.category) {
    return { success: false, reason: 'Missing id or category' };
  }
  if (!LIBRARY_CATEGORIES.includes(entry.category)) {
    return { success: false, reason: 'Invalid category: ' + entry.category };
  }
  if (entry.severity && !SEVERITY_LEVELS.includes(entry.severity)) entry.severity = 'info';
  if (!entry.date_added) entry.date_added = new Date().toISOString().slice(0, 10);
  if (!entry.date_verified) entry.date_verified = entry.date_added;
  if (!entry.applicable_to) entry.applicable_to = [];
  if (!entry.tags) entry.tags = [];
  if (!entry.relevance_score) entry.relevance_score = 5;
  if (!entry.subcategory) entry.subcategory = 'general';
  if (!entry.source_url) entry.source_url = '';
  if (!entry.description) entry.description = '';
  const catPath = libGetCategoryPath(projectDir, entry.category);
  const libDir = libGetLibraryDir(projectDir);
  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
  let entries = [];
  if (fs.existsSync(catPath)) {
    const text = fs.readFileSync(catPath, 'utf8');
    entries = libParseEntries(text);
  }
  if (entries.some(e => e.id === entry.id)) {
    return { success: false, reason: 'Duplicate ID: ' + entry.id };
  }
  entries.push(entry);
  fs.writeFileSync(catPath, libSerializeEntries(entries), 'utf8');
  delete _libEntryCache[catPath];
  return { success: true, total: entries.length };
}

function libRemoveEntry(projectDir, category, entryId) {
  if (!LIBRARY_CATEGORIES.includes(category)) return { success: false, reason: 'Invalid category' };
  const catPath = libGetCategoryPath(projectDir, category);
  if (!fs.existsSync(catPath)) return { success: false, reason: 'Category file not found' };
  const text = fs.readFileSync(catPath, 'utf8');
  const entries = libParseEntries(text);
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return { success: false, reason: 'Entry not found: ' + entryId };
  entries.splice(idx, 1);
  fs.writeFileSync(catPath, libSerializeEntries(entries), 'utf8');
  delete _libEntryCache[catPath];
  return { success: true, remaining: entries.length };
}

function libSearchLibrary(projectDir, query) {
  if (!query) return [];
  const q = String(query).toLowerCase();
  const results = [];
  for (const cat of LIBRARY_CATEGORIES) {
    const catPath = libGetCategoryPath(projectDir, cat);
    if (!fs.existsSync(catPath)) continue;
    const text = fs.readFileSync(catPath, 'utf8');
    const entries = libParseEntries(text);
    for (const e of entries) {
      if (
        (e.title && e.title.toLowerCase().includes(q)) ||
        (e.description && e.description.toLowerCase().includes(q)) ||
        (e.tags && e.tags.some(t => t.toLowerCase().includes(q))) ||
        (e.id && e.id.toLowerCase().includes(q))
      ) {
        results.push(e);
      }
    }
  }
  return results;
}

function libGetRelevant(projectDir, filePath) {
  if (!filePath) return [];
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  let categories = LIB_EXT_CATEGORY_MAP[ext] || [];
  if (basename === 'dockerfile' || basename.startsWith('dockerfile')) {
    categories = [...new Set([...categories, 'devops', 'security'])];
  }
  if (basename.includes('test') || basename.includes('spec')) {
    categories = [...new Set([...categories, 'testing'])];
  }
  if (basename.includes('api') || basename.includes('route')) {
    categories = [...new Set([...categories, 'api-design', 'security'])];
  }
  const results = [];
  for (const cat of categories) {
    const entries = libGetEntries(projectDir, cat);
    results.push(...entries);
  }
  return results;
}

function libImportFromUrl(projectDir, url) {
  if (!url || typeof url !== 'string') {
    return { status: 'error', message: 'URL is required' };
  }
  if (url.startsWith('ezra-cloud://')) {
    const query = url.slice('ezra-cloud://'.length);
    const settingsPath = path.join(projectDir, '.ezra', 'settings.yaml');
    if (!fs.existsSync(settingsPath)) {
      return { status: 'error', message: 'No settings found. Run /ezra:init first.' };
    }
    const content = fs.readFileSync(settingsPath, 'utf8');
    const endpointMatch = content.match(/endpoint:\s*['"]?([^\s'"]+)/);
    if (!endpointMatch) {
      return { status: 'requires_research_agent', url: url, message: 'Cloud endpoint not configured in settings.' };
    }
    const endpoint = endpointMatch[1].replace(/\/+$/, '');
    const { httpsPost } = require(path.join(__dirname, 'ezra-http.js'));
    const apiUrl = endpoint + '/functions/v1/research-agent';
    return httpsPost(apiUrl, { query: query, project: path.basename(projectDir) })
      .then((response) => {
        if (response.statusCode !== 200) {
          return { status: 'error', message: 'Research agent returned ' + response.statusCode };
        }
        return { status: 'success', data: response.body };
      })
      .catch((err) => {
        return { status: 'error', message: 'Network error: ' + err.message };
      });
  }
  return { status: 'requires_research_agent', url: url, message: 'Cloud research agent not configured. Available in Phase 6.' };
}

function libExportLibrary(projectDir) {
  const allEntries = {};
  let total = 0;
  for (const cat of LIBRARY_CATEGORIES) {
    const entries = libGetEntries(projectDir, cat);
    allEntries[cat] = entries;
    total += entries.length;
  }
  return { categories: LIBRARY_CATEGORIES.length, total_entries: total, entries: allEntries };
}

function libSyncFromWeb(projectDir, techFilter) {
  const scraper = require('./ezra-scraper.js');
  return scraper.scrapeForTech(techFilter || []).then(results => {
    let added = 0;
    const errors = [];
    for (const r of results) {
      if (r.error) { errors.push({ url: r.url, error: r.error }); continue; }
      try {
        libAddEntry(projectDir, {
          title: 'Web: ' + (r.url.replace(/^https?:\/\//, '').split('/')[0]),
          category: r.category || 'general',
          content: (r.content || '').slice(0, 500),
          source: r.url,
          linked_section: 'web-scrape',
          tech_stack: techFilter || [],
          tags: ['auto-scraped'],
        });
        added++;
      } catch (e) { errors.push({ url: r.url, error: e.message }); }
    }
    return { added, errors };
  });
}

const Q2B_DOC_CATEGORY_MAP = {
  architecture_dossier: 'architecture',
  sdlc_playbook:        'process',
  test_strategy:        'testing',
  security_framework:   'security',
  api_specification:    'api',
  deployment_guide:     'deployment',
  data_model:           'database',
  risk_register:        'security',
};

function libImportFromQuiz2Build(projectDir, sessionId, docTypes) {
  const types = Array.isArray(docTypes) ? docTypes : Q2B_DOCUMENT_TYPES;
  const imported = q2bImportDocuments(projectDir, sessionId, types);
  if (imported.error) return imported;
  let added = 0;
  const errors = [];
  for (const doc of (imported.documents || [])) {
    if (doc.error || !doc.data) {
      errors.push({ type: doc.type, error: doc.error || 'No data' });
      continue;
    }
    const category = Q2B_DOC_CATEGORY_MAP[doc.type] || 'general';
    const title = doc.data.title || ('Quiz2Build: ' + doc.type.replace(/_/g, ' '));
    const description = doc.data.summary || doc.data.description || ('Imported from Quiz2Build session ' + sessionId);
    const r = libAddEntry(projectDir, {
      title, category, description,
      content: doc.data.content || description,
      source: 'quiz2build',
      linked_section: 'quiz2build',
      tags: ['quiz2build', doc.type, 'auto-imported'],
      severity: 'info',
      subcategory: doc.type,
    });
    if (r.success === false) errors.push({ type: doc.type, error: r.error || r.reason });
    else added++;
  }
  return { session_id: sessionId, added, errors, total: types.length };
}

// =============================================================================
//  SECTION 7: BP SCHEDULER
// =============================================================================

const BP_FREQUENCIES = ['daily', 'weekly', 'manual'];

function bpParseSimpleYaml(text) {
  const obj = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (val === 'null' || val === '~') { obj[key] = null; }
    else if (val === 'true') { obj[key] = true; }
    else if (val === 'false') { obj[key] = false; }
    else if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      obj[key] = inner ? inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) : [];
    } else if (!isNaN(val) && val !== '') { obj[key] = Number(val); }
    else { obj[key] = val.replace(/^['"]|['"]$/g, ''); }
  }
  return obj;
}

function bpToSimpleYaml(obj) {
  return Object.entries(obj).map(([k, v]) => {
    if (v === null || v === undefined) return `${k}: null`;
    if (typeof v === 'boolean') return `${k}: ${v}`;
    if (Array.isArray(v)) return `${k}: [${v.map(s => `'${s}'`).join(', ')}]`;
    if (typeof v === 'number') return `${k}: ${v}`;
    return `${k}: '${String(v).replace(/'/g, "\\'")}'`;
  }).join('\n') + '\n';
}

function bpUrlToSlug(url) {
  return url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function bpGetSchedulerState(projectDir) {
  const statePath = path.join(projectDir, '.ezra', 'bp-scheduler.yaml');
  try {
    const text = fs.readFileSync(statePath, 'utf8');
    const parsed = bpParseSimpleYaml(text);
    return {
      last_run: parsed.last_run || null,
      frequency: parsed.frequency || 'weekly',
      auto_add: parsed.auto_add === true || parsed.auto_add === 'true',
      tech_filter: Array.isArray(parsed.tech_filter) ? parsed.tech_filter : []
    };
  } catch {
    return { last_run: null, frequency: 'weekly', auto_add: false, tech_filter: [] };
  }
}

function bpSaveSchedulerState(projectDir, state) {
  const dir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, 'bp-scheduler.yaml');
  fs.writeFileSync(statePath, bpToSimpleYaml(state), 'utf8');
}

function bpIsDue(state) {
  if (state.frequency === 'manual') return false;
  if (!state.last_run) return true;
  const last = new Date(state.last_run).getTime();
  if (isNaN(last)) return true;
  const elapsed = Date.now() - last;
  if (state.frequency === 'daily') return elapsed > 24 * 60 * 60 * 1000;
  if (state.frequency === 'weekly') return elapsed > 7 * 24 * 60 * 60 * 1000;
  return false;
}

function bpRunScheduledFetch(projectDir) {
  const state = bpGetSchedulerState(projectDir);
  if (!bpIsDue(state)) {
    return Promise.resolve({ skipped: true, reason: `frequency is '${state.frequency}' and last_run is not due yet` });
  }
  let scraper;
  try { scraper = require('./ezra-scraper.js'); } catch (e) {
    return Promise.resolve({ skipped: true, reason: 'ezra-scraper.js not available: ' + e.message });
  }
  const pendingDir = path.join(projectDir, '.ezra', 'library', 'pending-review');
  if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });
  return scraper.scrapeForTech(state.tech_filter && state.tech_filter.length ? state.tech_filter : null)
    .then(results => {
      let fetched_count = 0;
      let errors = 0;
      for (const result of results) {
        if (result.error) { errors++; continue; }
        fetched_count++;
        const slug = bpUrlToSlug(result.url);
        const entry = Object.assign({ status: 'pending' }, result);
        if (entry.content && entry.content.length > 2000) {
          entry.content = entry.content.slice(0, 2000) + '...';
        }
        const filePath = path.join(pendingDir, slug + '.yaml');
        fs.writeFileSync(filePath, bpToSimpleYaml(entry), 'utf8');
      }
      state.last_run = new Date().toISOString();
      bpSaveSchedulerState(projectDir, state);
      const pending_count = fs.readdirSync(pendingDir).filter(f => f.endsWith('.yaml')).length;
      return { run: true, fetched_count, pending_count, errors };
    });
}

function bpGetPendingEntries(projectDir) {
  const pendingDir = path.join(projectDir, '.ezra', 'library', 'pending-review');
  if (!fs.existsSync(pendingDir)) return [];
  return fs.readdirSync(pendingDir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      try {
        const text = fs.readFileSync(path.join(pendingDir, f), 'utf8');
        return Object.assign({ _filename: f }, bpParseSimpleYaml(text));
      } catch { return null; }
    })
    .filter(Boolean);
}

function bpApproveEntry(projectDir, filename) {
  const pendingDir = path.join(projectDir, '.ezra', 'library', 'pending-review');
  const libraryDir = path.join(projectDir, '.ezra', 'library');
  const src = path.join(pendingDir, filename);
  if (!fs.existsSync(src)) throw new Error(`Pending entry not found: ${filename}`);
  if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir, { recursive: true });
  const text = fs.readFileSync(src, 'utf8');
  const entry = bpParseSimpleYaml(text);
  entry.status = 'approved';
  fs.writeFileSync(path.join(libraryDir, filename), bpToSimpleYaml(entry), 'utf8');
  fs.unlinkSync(src);
  return { approved: true, filename };
}

function bpRejectEntry(projectDir, filename) {
  const pendingDir = path.join(projectDir, '.ezra', 'library', 'pending-review');
  const filePath = path.join(pendingDir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Pending entry not found: ${filename}`);
  fs.unlinkSync(filePath);
  return { rejected: true, filename };
}

// =============================================================================
//  EXPORTS — preserves exact same API surface as all 7 original files
// =============================================================================

module.exports = {
  // --- Section 1: AVIOS Bridge (no public exports in original, but expose internals for wrapper) ---
  AVIOS_CATEGORY_MAP,
  aviosParseYaml,
  aviosReadGovernance,
  aviosEnsurePendingDir,
  aviosWritePendingItem,
  aviosProcessDecisionFile,
  aviosProcessScanFile,
  aviosBridgeHandleStdin,

  // --- Section 2: Cloud Sync ---
  SYNC_DIR,
  MANIFEST_FILE,
  SYNC_STATE_FILE,
  SYNCABLE_PATHS,
  readYaml:              cloudReadYaml,
  writeYaml:             cloudWriteYaml,
  hashFile:              cloudHashFile,
  hashDir:               cloudHashDir,
  generateManifest:      cloudGenerateManifest,
  countFilesInDir:       cloudCountFilesInDir,
  getSyncDir:            cloudGetSyncDir,
  loadSyncState:         cloudLoadSyncState,
  saveSyncState:         cloudSaveSyncState,
  createBackup:          cloudCreateBackup,
  copyDirRecursive:      cloudCopyDirRecursive,
  listBackups:           cloudListBackups,
  restoreFromBackup:     cloudRestoreFromBackup,
  diffManifests:         cloudDiffManifests,
  readCloudSyncSettings: cloudReadCloudSyncSettings,
  pushSync:              cloudPushSync,
  pullSync:              cloudPullSync,

  // --- Section 3: Session Sync (original exports empty {}) ---
  sessionSyncHandleStdin,

  // --- Section 4: Quiz2Build Client ---
  Q2B_DOCUMENT_TYPES,
  Q2B_DIMENSIONS,
  EZRA_DOMAIN_MAP,
  login:                 q2bLogin,
  refreshToken:          q2bRefreshToken,
  getSession:            q2bGetSession,
  importScore:           q2bImportScore,
  importHeatmap:         q2bImportHeatmap,
  importFacts:           q2bImportFacts,
  submitFacts:           q2bSubmitFacts,
  calculateScore:        q2bCalculateScore,
  generateDocument:      q2bGenerateDocument,
  downloadDocument:      q2bDownloadDocument,
  importDocuments:       q2bImportDocuments,
  getNextQuestions:       q2bGetNextQuestions,
  registerGithubAdapter: q2bRegisterGithubAdapter,
  syncAdapter:           q2bSyncAdapter,
  heatmapToRiskRegister: q2bHeatmapToRiskRegister,

  // --- Section 5: License ---
  LICENSE_TIERS,
  FEATURE_TIER_MAP,
  LICENSE_CACHE_FILE,
  CACHE_MAX_DAYS,
  TIER_ORDER,
  validateKey:           licValidateKey,
  checkLicense:          licCheckLicense,
  isFeatureAvailable:    licIsFeatureAvailable,
  getLicenseStatus:      licGetLicenseStatus,
  getCachedLicense:      licGetCachedLicense,
  writeLicenseCache:     licWriteLicenseCache,
  computeCacheHmac:      licComputeCacheHmac,
  refreshLicense:        licRefreshLicense,
  readCloudSettings:     licReadCloudSettings,
  tierRank:              licTierRank,

  // --- Section 6: Library ---
  LIBRARY_CATEGORIES,
  ENTRY_SCHEMA,
  SEVERITY_LEVELS,
  initLibrary:           libInitLibrary,
  getCategories:         libGetCategories,
  getEntries:            libGetEntries,
  addEntry:              libAddEntry,
  removeEntry:           libRemoveEntry,
  searchLibrary:         libSearchLibrary,
  getRelevant:           libGetRelevant,
  importFromUrl:         libImportFromUrl,
  importFromQuiz2Build:  libImportFromQuiz2Build,
  exportLibrary:         libExportLibrary,
  serializeEntry:        libSerializeEntry,
  serializeEntries:      libSerializeEntries,
  parseEntries:          libParseEntries,
  syncFromWeb:           libSyncFromWeb,

  // --- Section 7: BP Scheduler ---
  FREQUENCIES:           BP_FREQUENCIES,
  getSchedulerState:     bpGetSchedulerState,
  saveSchedulerState:    bpSaveSchedulerState,
  isDue:                 bpIsDue,
  runScheduledFetch:     bpRunScheduledFetch,
  getPendingEntries:     bpGetPendingEntries,
  approveEntry:          bpApproveEntry,
  rejectEntry:           bpRejectEntry,
};

// =============================================================================
//  STDIN HANDLER — dispatches by "source" field
// =============================================================================

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    input += d;
    if (input.length > MAX_STDIN) { process.exit(0); }
  });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const source = data._source || 'unknown';

      // Route to the correct handler based on _source
      if (source === 'avios-bridge') {
        const result = aviosBridgeHandleStdin(input);
        if (result) process.stdout.write(JSON.stringify(result));
        process.exit(0);
      }

      if (source === 'cloud-sync') {
        const action = data.action || 'manifest';
        const projectDir = data.project_dir || data.projectDir || process.cwd();
        let result;
        switch (action) {
          case 'manifest': result = cloudGenerateManifest(projectDir); break;
          case 'backup':   result = cloudCreateBackup(projectDir); break;
          case 'list-backups': result = cloudListBackups(projectDir); break;
          case 'restore':  result = cloudRestoreFromBackup(projectDir, data.backup_name || data.backupName); break;
          case 'state':    result = cloudLoadSyncState(projectDir); break;
          default:         result = { error: 'Unknown action: ' + action };
        }
        process.stdout.write(JSON.stringify(result));
        process.exit(0);
      }

      if (source === 'session-sync') {
        sessionSyncHandleStdin(input).then(result => {
          process.stdout.write(JSON.stringify(result));
          process.exit(0);
        }).catch(e => {
          process.stderr.write('EZRA [SYNC]: ' + e.message + '\n');
          process.stdout.write(JSON.stringify({ synced: false, reason: e.message }));
          process.exit(0);
        });
        return; // async — don't exit yet
      }

      if (source === 'quiz2build') {
        const projectDir = data.cwd || process.cwd();
        const action = (data.action || '').toLowerCase();
        let output = {};
        if (action === 'import_heatmap') output = q2bImportHeatmap(projectDir, data.session_id);
        else if (action === 'import_score') output = q2bImportScore(projectDir, data.session_id);
        else if (action === 'import_facts') output = q2bImportFacts(projectDir, data.project_id);
        else if (action === 'submit_facts') output = q2bSubmitFacts(projectDir, data.project_id, data.facts);
        else if (action === 'calculate_score') output = q2bCalculateScore(projectDir, data.session_id);
        else if (action === 'generate_document') output = q2bGenerateDocument(projectDir, data.project_id, data.doc_type);
        else if (action === 'import_documents') output = q2bImportDocuments(projectDir, data.session_id, data.doc_types);
        else if (action === 'heatmap_to_risks') output = { risks: q2bHeatmapToRiskRegister(data.heatmap || {}) };
        else output = { error: 'Unknown action', valid_actions: ['import_heatmap', 'import_score', 'import_facts', 'submit_facts', 'calculate_score', 'generate_document', 'import_documents', 'heatmap_to_risks'] };
        process.stdout.write(JSON.stringify(output) + '\n');
        process.exit(0);
      }

      if (source === 'library') {
        const cwd = data.cwd || process.cwd();
        const action = data.action || 'export';
        if (action === 'init') {
          process.stdout.write(JSON.stringify(libInitLibrary(cwd)));
        } else if (action === 'search') {
          process.stdout.write(JSON.stringify(libSearchLibrary(cwd, data.query || '')));
        } else if (action === 'add') {
          process.stdout.write(JSON.stringify(libAddEntry(cwd, data.entry)));
        } else if (action === 'remove') {
          process.stdout.write(JSON.stringify(libRemoveEntry(cwd, data.category, data.entryId)));
        } else {
          process.stdout.write(JSON.stringify(libExportLibrary(cwd)));
        }
        process.exit(0);
      }

      if (source === 'bp-scheduler') {
        const action = data.action || 'status';
        const projectDir = data.project_dir || process.cwd();
        function respond(result) {
          process.stdout.write(JSON.stringify({ ok: true, action, result }) + '\n');
          process.exit(0);
        }
        function fail(err) {
          process.stdout.write(JSON.stringify({ ok: false, action, error: err.message || String(err) }) + '\n');
          process.exit(0);
        }
        try {
          if (action === 'run') {
            bpRunScheduledFetch(projectDir).then(respond).catch(fail);
          } else if (action === 'status') {
            respond({ state: bpGetSchedulerState(projectDir), is_due: bpIsDue(bpGetSchedulerState(projectDir)) });
          } else if (action === 'pending') {
            respond(bpGetPendingEntries(projectDir));
          } else if (action === 'approve') {
            respond(bpApproveEntry(projectDir, data.filename));
          } else if (action === 'reject') {
            respond(bpRejectEntry(projectDir, data.filename));
          } else {
            respond({ warning: `Unknown action '${action}'. Valid: run, status, pending, approve, reject` });
          }
        } catch (err) { fail(err); }
        return; // may be async
      }

      // Fallback: unknown source
      process.stdout.write(JSON.stringify({ error: 'Unknown _source: ' + source }));
      process.exit(0);
    } catch (err) {
      const msg = _fmt('INTEGRATIONS_001', { detail: err.message });
      process.stderr.write(msg + '\n');
      _log(process.cwd(), 'ezra-integrations', 'warn', msg);
      process.stdout.write(JSON.stringify({ error: err.message }));
      process.exit(0);
    }
  });
}
