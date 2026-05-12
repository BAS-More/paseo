#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

/**
 * EZRA Settings Writer
 *
 * Write-back engine for .ezra/settings.yaml.
 * Companion to ezra-settings.js (read-only parser).
 * Provides set, add-rule, remove-rule, reset, export, diff, init.
 *
 * Zero external dependencies.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ─── Atomic Write ────────────────────────────────────────────────

/**
 * Write file atomically via temp file + rename to prevent data
 * corruption from concurrent hook invocations (GAP-019).
 */
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

const settings = require(path.join(__dirname, 'ezra-settings.js'));

const { loadSettings, getDefault, loadGlobalDefaults, parseYamlSimple, parseValue, DEFAULTS } = settings;

// ─── YAML Serializer ─────────────────────────────────────────────

/**
 * Serialize a scalar value to YAML-safe string.
 */
function serializeScalar(val) {
  if (val === null || val === undefined) return "null";
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (val === 'true' || val === 'false' || val === 'null' || val === '~' || val === '') {
      return '"' + val + '"';
    }
    if (/^-?\d+(\.\d+)?$/.test(val)) {
      return '"' + val + '"';
    }
    if (/[:#{}\[\],&*?|>!%@]/.test(val)) {
      return '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return val;
  }
  return String(val);
}
/**
 * Serialize a JS object to simple YAML string.
 * Inverse of parseYamlSimple.
 */
function serializeYaml(obj) {
  if (obj === null || obj === undefined) return "";
  const lines = [];

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (val === null || val === undefined) {
      lines.push(key + ': null');
    } else if (Array.isArray(val)) {
      lines.push(key + ':');
      if (val.length === 0) {
        lines.push('  # (empty)');
      }
      for (const item of val) {
        lines.push('  - ' + serializeScalar(item));
      }
    } else if (typeof val === "object") {
      lines.push(key + ':');
      for (const subKey of Object.keys(val)) {
        const subVal = val[subKey];
        if (subVal === null || subVal === undefined) {
          lines.push('  ' + subKey + ': null');
        } else if (Array.isArray(subVal)) {
          const items = subVal.map(i => serializeScalar(i)).join(', ');
          lines.push('  ' + subKey + ': [' + items + ']');
        } else if (typeof subVal === "object") {
          lines.push('  ' + subKey + ':');
          for (const deepKey of Object.keys(subVal)) {
            const deepVal = subVal[deepKey];
            if (deepVal === null || deepVal === undefined) {
              lines.push('    ' + deepKey + ': null');
            } else if (Array.isArray(deepVal)) {
              const deepItems = deepVal.map(i => serializeScalar(i)).join(', ');
              lines.push('    ' + deepKey + ': [' + deepItems + ']');
            } else if (typeof deepVal === "object") {
              lines.push('    ' + deepKey + ':');
              for (const l4Key of Object.keys(deepVal)) {
                const l4Val = deepVal[l4Key];
                if (l4Val === null || l4Val === undefined) {
                  lines.push('      ' + l4Key + ': null');
                } else if (Array.isArray(l4Val)) {
                  const l4Items = l4Val.map(i => serializeScalar(i)).join(', ');
                  lines.push('      ' + l4Key + ': [' + l4Items + ']');
                } else {
                  lines.push('      ' + l4Key + ': ' + serializeScalar(l4Val));
                }
              }
            } else {
              lines.push('    ' + deepKey + ': ' + serializeScalar(deepVal));
            }
          }
        } else {
          lines.push('  ' + subKey + ': ' + serializeScalar(subVal));
        }
      }
    } else {
      lines.push(key + ': ' + serializeScalar(val));
    }
    lines.push('');
  }

  return lines.join('\n');
}
// ─── Path Utilities ──────────────────────────────────────────────

function validateProjectDir(projectDir) {
  if (!projectDir || typeof projectDir !== 'string') return false;
  const normalized = path.normalize(projectDir);
  if (normalized.includes('..')) return false;
  return true;
}

function settingsPath(projectDir) {
  if (!validateProjectDir(projectDir)) throw new Error('Invalid project directory: path traversal detected');
  return path.join(projectDir, '.ezra', 'settings.yaml');
}

function ensureEzraDir(projectDir) {
  const dir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Core API ────────────────────────────────────────────────────

/**
 * Set a single setting by dotted path (e.g., 'oversight.level', 'strict').
 */
function setSetting(projectDir, settingPath, value) {
  const current = loadSettings(projectDir);
  const parts = settingPath.split('.');
  const BLOCKED = /^(__proto__|constructor|prototype)$/;
  if (parts.some(p => BLOCKED.test(p))) {
    return { success: false, error: 'Blocked property name in path' };
  }

  if (parts.length === 1) {
    current[parts[0]] = value;
  } else if (parts.length === 2) {
    if (!current[parts[0]] || typeof current[parts[0]] !== 'object') {
      current[parts[0]] = {};
    }
    current[parts[0]][parts[1]] = value;
  } else if (parts.length === 3) {
    if (!current[parts[0]] || typeof current[parts[0]] !== 'object') {
      current[parts[0]] = {};
    }
    if (!current[parts[0]][parts[1]] || typeof current[parts[0]][parts[1]] !== 'object') {
      current[parts[0]][parts[1]] = {};
    }
    current[parts[0]][parts[1]][parts[2]] = value;
  } else {
    return { success: false, error: 'Path too deep (max 3 levels)' };
  }

  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(current), 'utf8');
  if (settings._invalidateCache) settings._invalidateCache();
  return { success: true, path: settingPath, value };
}

/**
 * Add a custom rule to a section's custom_rules array.
 */
function addRule(projectDir, section, rule) {
  const current = loadSettings(projectDir);
  if (!current[section]) {
    return { success: false, error: 'Section not found: ' + section };
  }
  if (!Array.isArray(current[section].custom_rules)) {
    current[section].custom_rules = [];
  }
  if (current[section].custom_rules.includes(rule)) {
    return { success: false, error: 'Rule already exists: ' + rule };
  }
  current[section].custom_rules.push(rule);
  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(current), 'utf8');
  if (settings._invalidateCache) settings._invalidateCache();
  return { success: true, section, rule };
}

/**
 * Remove a rule by ID (index) from a section's custom_rules.
 */
function removeRule(projectDir, section, ruleId) {
  const current = loadSettings(projectDir);
  if (!current[section]) {
    return { success: false, error: 'Section not found: ' + section };
  }
  if (!Array.isArray(current[section].custom_rules)) {
    return { success: false, error: 'No custom_rules in section: ' + section };
  }
  const idx = typeof ruleId === 'number' ? ruleId : parseInt(ruleId, 10);
  if (isNaN(idx) || idx < 0 || idx >= current[section].custom_rules.length) {
    return { success: false, error: 'Invalid rule index: ' + ruleId };
  }
  const removed = current[section].custom_rules.splice(idx, 1)[0];
  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(current), 'utf8');
  if (settings._invalidateCache) settings._invalidateCache();
  return { success: true, section, removed };
}
/**
 * Reset a section to its defaults.
 */
function resetSection(projectDir, section) {
  const defaults = getDefault();
  if (!defaults[section]) {
    return { success: false, error: 'Unknown section: ' + section };
  }
  const current = loadSettings(projectDir);
  current[section] = JSON.parse(JSON.stringify(defaults[section]));
  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(current), 'utf8');
  if (settings._invalidateCache) settings._invalidateCache();
  return { success: true, section };
}

/**
 * Reset all settings to defaults.
 */
function resetAll(projectDir) {
  const defaults = loadGlobalDefaults();
  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(defaults), 'utf8');
  if (settings._invalidateCache) settings._invalidateCache();
  return { success: true };
}

/**
 * Export settings as formatted YAML string.
 */
function exportSettings(projectDir) {
  const current = loadSettings(projectDir);
  return serializeYaml(current);
}

/**
 * Compare current settings against defaults, return differences.
 */
function diffSettings(projectDir) {
  const current = loadSettings(projectDir);
  const defaults = loadGlobalDefaults();
  const diffs = [];

  function compare(cur, def, prefix) {
    const allKeys = new Set([...Object.keys(cur || {}), ...Object.keys(def || {})]);
    for (const key of allKeys) {
      const fullPath = prefix ? prefix + '.' + key : key;
      const curVal = cur ? cur[key] : undefined;
      const defVal = def ? def[key] : undefined;

      if (curVal === undefined && defVal !== undefined) {
        diffs.push({ path: fullPath, current: undefined, default: defVal, type: 'missing' });
      } else if (defVal === undefined && curVal !== undefined) {
        diffs.push({ path: fullPath, current: curVal, default: undefined, type: 'added' });
      } else if (typeof curVal === "object" && curVal !== null && !Array.isArray(curVal) &&
                 typeof defVal === "object" && defVal !== null && !Array.isArray(defVal)) {
        compare(curVal, defVal, fullPath);
      } else if (JSON.stringify(curVal) !== JSON.stringify(defVal)) {
        diffs.push({ path: fullPath, current: curVal, default: defVal, type: 'changed' });
      }
    }
  }

  compare(current, defaults, '');
  return diffs;
}

/**
 * Create .ezra/settings.yaml with defaults if not exists.
 */
function initSettings(projectDir) {
  ensureEzraDir(projectDir);
  const fp = settingsPath(projectDir);
  if (fs.existsSync(fp)) {
    return { created: false, reason: 'settings.yaml already exists' };
  }
  const defaults = getDefault();
  atomicWriteFileSync(fp, serializeYaml(defaults), 'utf8');
  if (settings._invalidateCache) settings._invalidateCache();
  return { created: true, path: fp };
}
// ─── Exports ─────────────────────────────────────────────────────

module.exports = {
  setSetting,
  addRule,
  removeRule,
  resetSection,
  resetAll,
  exportSettings,
  diffSettings,
  initSettings,
  serializeYaml,
  serializeScalar,
};

// ─── Hook Protocol (stdin → stdout) ──────────────────────────────

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
      const action = event.action || 'export';

      let result;
      switch (action) {
        case 'set':
          result = setSetting(cwd, event.path, event.value);
          break;
        case 'add-rule':
          result = addRule(cwd, event.section, event.rule);
          break;
        case 'remove-rule':
          result = removeRule(cwd, event.section, event.ruleId);
          break;
        case 'reset-section':
          result = resetSection(cwd, event.section);
          break;
        case 'reset-all':
          result = resetAll(cwd);
          break;
        case 'export':
          result = { yaml: exportSettings(cwd) };
          break;
        case 'diff':
          result = { diffs: diffSettings(cwd) };
          break;
        case 'init':
          result = initSettings(cwd);
          break;
        default:
          result = { error: 'Unknown action: ' + action };
      }
      process.stdout.write(JSON.stringify(result));
    } catch {
      const msg = _fmt('SETTINGS_002', { detail: 'Hook protocol error' });
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-settings-writer', 'warn', msg);
      process.stdout.write('{}');
    }
    process.exit(0);
  });
}
