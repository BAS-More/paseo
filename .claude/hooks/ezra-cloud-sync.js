#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit
const MAX_SCAN_DEPTH = 5; // Safety limit for recursive directory scans
const MAX_SCAN_FILES = 10000; // Safety limit for total files scanned (GAP-029)

/**
 * EZRA Cloud Sync Foundation
 * Local state backup/restore + sync manifest for future cloud integration.
 * Zero external dependencies.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// ─── Constants ───────────────────────────────────────────────────

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

// ─── YAML Helpers ────────────────────────────────────────────────

function readYaml(filePath) {
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

function writeYaml(filePath, data) {
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

// ─── Hashing ─────────────────────────────────────────────────────

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function hashDir(dirPath, depth, _fileCount) {
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
    if (stat.isDirectory()) return hashDir(fp, depth + 1, _fileCount);
    _fileCount.count++;
    return hashFile(fp);
  }).filter(Boolean);
  if (hashes.length === 0) return null;
  return crypto.createHash('sha256').update(hashes.join(',')).digest('hex').slice(0, 16);
}

// ─── Manifest ────────────────────────────────────────────────────

function generateManifest(projectDir) {
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
      hash: stat.isDirectory() ? hashDir(fullPath) : hashFile(fullPath),
      size: stat.isDirectory() ? countFilesInDir(fullPath) : stat.size,
      modified: stat.mtime.toISOString(),
    };
    entries.push(entry);
  }

  return {
    generated: now,
    project: path.basename(projectDir),
    entries: entries,
    total_entries: entries.length,
  };
}

function countFilesInDir(dirPath, depth, _counter) {
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
      count += countFilesInDir(fp, depth + 1, _counter);
    } else {
      count++;
      _counter.total++;
    }
  }
  return count;
}

// ─── Sync State ──────────────────────────────────────────────────

function getSyncDir(projectDir) {
  return path.join(projectDir, '.ezra', SYNC_DIR);
}

function loadSyncState(projectDir) {
  const statePath = path.join(getSyncDir(projectDir), SYNC_STATE_FILE);
  return readYaml(statePath);
}

function saveSyncState(projectDir, state) {
  const syncDir = getSyncDir(projectDir);
  if (!fs.existsSync(syncDir)) fs.mkdirSync(syncDir, { recursive: true });
  writeYaml(path.join(syncDir, SYNC_STATE_FILE), state);
}

// ─── Backup / Restore ────────────────────────────────────────────

function createBackup(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(ezraDir)) return { error: 'EZRA not initialized' };

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const backupDir = path.join(getSyncDir(projectDir), 'backups', timestamp);
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
      copyDirRecursive(srcPath, destPath, 0, copyCounter);
      filesCopied += countFilesInDir(srcPath);
      if (copyCounter.total >= MAX_SCAN_FILES) truncated = true;
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      filesCopied++;
    }
  }

  // GAP-022: Manifest written AFTER all copies — acts as completion marker
  const manifest = generateManifest(projectDir);
  writeYaml(path.join(backupDir, MANIFEST_FILE), {
    backup_date: new Date().toISOString(),
    files_copied: filesCopied,
    total_entries: manifest.total_entries,
    truncated: truncated,
    complete: true,
  });

  saveSyncState(projectDir, {
    last_backup: new Date().toISOString(),
    last_backup_dir: backupDir,
    files_backed_up: filesCopied,
  });

  return {
    backup_dir: backupDir,
    files_copied: filesCopied,
    timestamp: timestamp,
  };
}

function copyDirRecursive(src, dest, depth, _counter) {
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
      copyDirRecursive(srcItem, destItem, depth + 1, _counter);
    } else {
      fs.copyFileSync(srcItem, destItem);
      _counter.total++;
    }
  }
}

function listBackups(projectDir) {
  const backupsDir = path.join(getSyncDir(projectDir), 'backups');
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
      manifest: readYaml(path.join(backupsDir, d, MANIFEST_FILE)),
    }));
}

function restoreFromBackup(projectDir, backupName) {
  // SEC-002: Sanitise backupName to prevent path traversal
  if (path.basename(backupName) !== backupName) {
    return { error: 'Invalid backup name: ' + backupName };
  }
  const backupDir = path.join(getSyncDir(projectDir), 'backups', backupName);
  if (!fs.existsSync(backupDir)) return { error: 'Backup not found: ' + backupName };

  // GAP-022: Check backup completeness via manifest marker
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
      copyDirRecursive(srcPath, destPath);
      filesRestored += countFilesInDir(srcPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      filesRestored++;
    }
  }

  saveSyncState(projectDir, {
    last_restore: new Date().toISOString(),
    restored_from: backupName,
    files_restored: filesRestored,
  });

  return {
    files_restored: filesRestored,
    restored_from: backupName,
  };
}

// ─── Diff ────────────────────────────────────────────────────────

function diffManifests(manifest1, manifest2) {
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

// ─── Cloud Sync Settings Helper ─────────────────────────────────

function readCloudSyncSettings(projectDir) {
  const settingsPath = path.join(projectDir, '.ezra', 'settings.yaml');
  if (!fs.existsSync(settingsPath)) return {};
  // F-002: Use structured YAML parsing instead of regex to avoid credential leakage
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
    // Fallback: minimal parsing without credentials
    const content = fs.readFileSync(settingsPath, 'utf8');
    const result = {};
    const enabledMatch = content.match(/cloud_sync[\s\S]*?enabled:\s*(true|false)/);
    if (enabledMatch) result.enabled = enabledMatch[1] === 'true';
    return result;
  }
}

// ─── Push Sync ──────────────────────────────────────────────────

function pushSync(projectDir) {
  const settings = readCloudSyncSettings(projectDir);
  if (settings.enabled !== true) {
    return { skipped: true, reason: 'cloud_sync_disabled' };
  }

  if (!settings.endpoint) {
    return { skipped: true, reason: 'no_endpoint' };
  }

  // Collect sync payload
  const ezraDir = path.join(projectDir, '.ezra');
  const payload = { project_id: settings.project_id || path.basename(projectDir) };

  // Decisions
  const decisionsDir = path.join(ezraDir, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    payload.decisions = fs.readdirSync(decisionsDir)
      .filter(f => f.endsWith('.yaml'))
      .map(f => {
        const content = fs.readFileSync(path.join(decisionsDir, f), 'utf8');
        return { file: f, content };
      });
  }

  // Latest health score from scans
  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) {
    const scanFiles = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).sort().reverse();
    if (scanFiles.length > 0) {
      payload.latest_scan = fs.readFileSync(path.join(scansDir, scanFiles[0]), 'utf8');
    }
  }

  // Settings
  const settingsPath = path.join(ezraDir, 'settings.yaml');
  if (fs.existsSync(settingsPath)) {
    payload.settings = fs.readFileSync(settingsPath, 'utf8');
  }

  const { httpsPost } = require(path.join(__dirname, 'ezra-http.js'));
  const url = settings.endpoint.replace(/\/+$/, '') + '/functions/v1/sync-push';
  const headers = {};
  if (settings.auth_token) {
    headers['Authorization'] = 'Bearer ' + settings.auth_token;
  }

  return httpsPost(url, payload, headers)
    .then((response) => {
      saveSyncState(projectDir, {
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

// ─── Pull Sync ──────────────────────────────────────────────────

function pullSync(projectDir) {
  const settings = readCloudSyncSettings(projectDir);
  if (settings.enabled !== true) {
    return { skipped: true, reason: 'cloud_sync_disabled' };
  }

  if (!settings.endpoint) {
    return { skipped: true, reason: 'no_endpoint' };
  }

  const state = loadSyncState(projectDir);
  const since = state.last_pull || '1970-01-01T00:00:00Z';
  const projectId = settings.project_id || path.basename(projectDir);

  const { httpsGet } = require(path.join(__dirname, 'ezra-http.js'));
  const url = settings.endpoint.replace(/\/+$/, '') + '/functions/v1/sync-pull?project_id=' + encodeURIComponent(projectId) + '&since=' + encodeURIComponent(since);
  const headers = {};
  if (settings.auth_token) {
    headers['Authorization'] = 'Bearer ' + settings.auth_token;
  }

  return httpsGet(url, headers)
    .then((response) => {
      if (response.statusCode !== 200) {
        return { success: false, statusCode: response.statusCode };
      }

      const data = typeof response.body === 'object' ? response.body : {};
      let mergedCount = 0;
      const ezraDir = path.join(projectDir, '.ezra');

      // Merge decisions
      if (data.decisions && Array.isArray(data.decisions)) {
        const decisionsDir = path.join(ezraDir, 'decisions');
        if (!fs.existsSync(decisionsDir)) fs.mkdirSync(decisionsDir, { recursive: true });
        for (const d of data.decisions) {
          if (d.file && d.content) {
            // F-001: Validate filename — reject path traversal attempts
            const safe = path.basename(d.file);
            if (safe !== d.file || d.file.includes('..') || d.file.includes('/') || d.file.includes('\\')) continue;
            if (!safe.endsWith('.yaml') && !safe.endsWith('.yml')) continue;
            fs.writeFileSync(path.join(decisionsDir, safe), d.content, 'utf8');
            mergedCount++;
          }
        }
      }

      saveSyncState(projectDir, {
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

// ─── Exports ─────────────────────────────────────────────────────

module.exports = {
  SYNC_DIR,
  MANIFEST_FILE,
  SYNC_STATE_FILE,
  SYNCABLE_PATHS,
  readYaml,
  writeYaml,
  hashFile,
  hashDir,
  generateManifest,
  countFilesInDir,
  getSyncDir,
  loadSyncState,
  saveSyncState,
  createBackup,
  copyDirRecursive,
  listBackups,
  restoreFromBackup,
  diffManifests,
  readCloudSyncSettings,
  pushSync,
  pullSync,
};

// ─── Hook Protocol ───────────────────────────────────────────────

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
      const action = data.action || 'manifest';
      const projectDir = data.project_dir || data.projectDir || process.cwd();
      let result;
      switch (action) {
        case 'manifest':
          result = generateManifest(projectDir);
          break;
        case 'backup':
          result = createBackup(projectDir);
          break;
        case 'list-backups':
          result = listBackups(projectDir);
          break;
        case 'restore':
          result = restoreFromBackup(projectDir, data.backup_name || data.backupName);
          break;
        case 'state':
          result = loadSyncState(projectDir);
          break;
        default:
          result = { error: 'Unknown action: ' + action };
      }
      process.stdout.write(JSON.stringify(result));
    } catch (e) {
      const msg = _fmt('CLOUD_001', { detail: e.message });
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-cloud-sync', 'warn', msg);
      process.stdout.write(JSON.stringify({ error: e.message }));
    }
    process.exit(0);
  });
}
