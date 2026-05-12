#!/usr/bin/env node
'use strict';

/**
 * EZRA Shared YAML Utilities
 *
 * Provides the shared inline YAML parser and deep-merge helper
 * used by ezra-settings.js and all v7 hooks that read/write
 * .ezra/*.yaml files. Zero external dependencies.
 *
 * Exported: parseValue, parseYamlSimple, deepMerge, stringifyYaml
 */

// ─── Value Parser ────────────────────────────────────────────────

/**
 * Parse a single YAML value string into a JS value.
 * Handles: booleans, null, integers, floats, quoted strings,
 * inline arrays [a, b], inline objects {k: v}.
 */
function parseValue(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Quoted strings
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Inline array: [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map(s => parseValue(s.trim()));
  }

  // Inline object: {k: v, k2: v2}
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return {};
    const obj = {};
    const pairs = inner.split(',');
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const k = pair.slice(0, colonIdx).trim();
        const v = pair.slice(colonIdx + 1).trim();
        if (/^(__proto__|constructor|prototype)$/.test(k)) continue;
        obj[k] = parseValue(v);
      }
    }
    return obj;
  }

  // Integer
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  // Float
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);

  // Plain string
  return trimmed;
}

// ─── YAML Parser ─────────────────────────────────────────────────

/**
 * Parse simple YAML text into a JS object.
 * Supports: top-level keys, one-level nested sections (indented),
 * two-level sub-sections, list items (- value), comments (#), blank lines.
 */
function parseYamlSimple(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let section = null;    // level-0 key (e.g. "self_learning")
  let subSection = null; // level-1 key (e.g. "domains")

  for (const line of lines) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;

    const indent = (line.match(/^(\s*)/)[1] || '').length;
    const trimmed = line.trim();

    // Level 0 — top-level key
    if (indent === 0) {
      subSection = null;
      const m = trimmed.match(/^(\w[\w_-]*):\s*(.*)?$/);
      if (!m) continue;
      const key = m[1];
      if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
      const val = (m[2] || '').trim();
      if (val === '' || val === undefined) {
        section = key;
        result[key] = {};
      } else {
        section = null;
        result[key] = parseValue(val);
      }
      continue;
    }

    if (!section) continue;

    // Level 1 — inside a section (indent 2)
    if (indent <= 2 || (indent <= 4 && !subSection)) {
      subSection = null;
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(result[section])) result[section] = [];
        result[section].push(parseValue(trimmed.slice(2).trim()));
        continue;
      }
      const m = trimmed.match(/^(\w[\w_-]*):\s*(.*)?$/);
      if (m) {
        const key = m[1];
        if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
        const val = (m[2] || '').trim();
        if (typeof result[section] !== 'object' || Array.isArray(result[section])) {
          result[section] = {};
        }
        if (val === '' || val === undefined) {
          subSection = key;
          result[section][key] = {};
        } else {
          result[section][key] = parseValue(val);
        }
      }
      continue;
    }

    // Level 2 — inside a sub-section (indent 4+)
    if (subSection && indent >= 4) {
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(result[section][subSection])) result[section][subSection] = [];
        result[section][subSection].push(parseValue(trimmed.slice(2).trim()));
        continue;
      }
      const m = trimmed.match(/^(\w[\w_-]*):\s*(.*)?$/);
      if (m) {
        const key = m[1];
        if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
        const val = (m[2] || '').trim();
        if (typeof result[section][subSection] !== 'object' || Array.isArray(result[section][subSection])) {
          result[section][subSection] = {};
        }
        result[section][subSection][key] = parseValue(val);
      }
    }
  }

  return result;
}

// ─── Deep Merge ──────────────────────────────────────────────────

/**
 * Deep merge source into target. Arrays are replaced, not merged.
 * Returns a new object. Prototype-pollution safe.
 */
function deepMerge(target, source) {
  const output = {};
  const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

  for (const key of Object.keys(target)) {
    if (BLOCKED.has(key)) continue;
    if (target[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      output[key] = deepMerge(target[key], {});
    } else if (Array.isArray(target[key])) {
      output[key] = target[key].slice();
    } else {
      output[key] = target[key];
    }
  }

  for (const key of Object.keys(source)) {
    if (BLOCKED.has(key)) continue;
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(output[key] || {}, source[key]);
    } else if (Array.isArray(source[key])) {
      output[key] = source[key].slice();
    } else {
      output[key] = source[key];
    }
  }

  return output;
}

// ─── YAML Serialiser ─────────────────────────────────────────────

/**
 * Serialise a JS object to simple YAML text.
 * Handles: primitives, arrays (inline for short, block for long),
 * nested objects up to 2 levels deep.
 * Used for writing .ezra/*.yaml files.
 */
function stringifyYaml(obj, indent) {
  indent = indent || 0;
  const pad = '  '.repeat(indent);
  const lines = [];

  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      lines.push(`${pad}${key}: null`);
    } else if (typeof val === 'boolean' || typeof val === 'number') {
      lines.push(`${pad}${key}: ${val}`);
    } else if (typeof val === 'string') {
      // Quote strings that contain special chars or look like booleans/numbers
      const needsQuote = /[:#\[\]{},]/.test(val) || /^(true|false|null|~|\d)/.test(val);
      lines.push(`${pad}${key}: ${needsQuote ? `"${val.replace(/"/g, '\\"')}"` : val}`);
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else if (val.every(v => typeof v !== 'object' || v === null) && val.length <= 5) {
        lines.push(`${pad}${key}: [${val.map(v => (v === null ? 'null' : String(v))).join(', ')}]`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of val) {
          if (item === null) {
            lines.push(`${pad}  - null`);
          } else if (typeof item === 'object') {
            lines.push(`${pad}  -`);
            lines.push(stringifyYaml(item, indent + 2).replace(/^/gm, '  '));
          } else {
            lines.push(`${pad}  - ${item}`);
          }
        }
      }
    } else if (typeof val === 'object') {
      if (Object.keys(val).length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(stringifyYaml(val, indent + 1));
      }
    }
  }

  return lines.join('\n');
}

// ─── Exports ─────────────────────────────────────────────────────

module.exports = { parseValue, parseYamlSimple, deepMerge, stringifyYaml };
