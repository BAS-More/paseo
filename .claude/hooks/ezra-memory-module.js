#!/usr/bin/env node
'use strict';

/**
 * EZRA Consolidated Memory Module (v7.0.0)
 * Merges: ezra-memory.js, ezra-memory-hook.js, ezra-doc-ingester.js
 * Zero external dependencies.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// ==========================================================================
// Sub-module: ezra-memory (Agent Memory System)
// ==========================================================================

// ─── Constants ───────────────────────────────────────────────────

const MEMORY_DIR = '.ezra/memory';
const MEMORY_INDEX = 'index.yaml';
const MEMORY_TYPES = ['pattern', 'anti-pattern', 'lesson', 'decision-context', 'preference', 'fact', 'warning'];
const MEMORY_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const MAX_ENTRIES_PER_TYPE = 500;

// ─── YAML Helpers ────────────────────────────────────────────────

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  let currentKey = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('- ') && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(trimmed.slice(2).trim());
      continue;
    }
    const match = trimmed.match(/^([\w.-]+):\s*(.*)$/);
    if (match) {
      const [, key, val] = match;
      if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
      if (val === '' || val === '|' || val === '>') {
        currentKey = key;
        result[key] = [];
      } else {
        result[key] = parseVal(val);
        currentKey = key;
      }
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
    return val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
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
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// ─── Memory Directory ────────────────────────────────────────────

function getMemoryDir(projectDir) {
  return path.join(projectDir, MEMORY_DIR);
}

function initMemory(projectDir) {
  const memDir = getMemoryDir(projectDir);
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  
  // Create type subdirectories
  for (const type of MEMORY_TYPES) {
    const typeDir = path.join(memDir, type);
    if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });
  }
  
  // Create index if missing
  const indexPath = path.join(memDir, MEMORY_INDEX);
  if (!fs.existsSync(indexPath)) {
    writeYaml(indexPath, {
      created: new Date().toISOString(),
      total_entries: 0,
      last_updated: new Date().toISOString(),
    });
  }
  
  return {
    memory_dir: memDir,
    types: MEMORY_TYPES.length,
    initialized: true,
  };
}

// ─── Entry Management ────────────────────────────────────────────

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

function addMemory(projectDir, entry) {
  if (!entry || !entry.type || !entry.content) {
    return { error: 'Entry must have type and content' };
  }
  if (!MEMORY_TYPES.includes(entry.type)) {
    return { error: 'Invalid type: ' + entry.type + '. Valid: ' + MEMORY_TYPES.join(', ') };
  }
  
  const memDir = getMemoryDir(projectDir);
  if (!fs.existsSync(memDir)) initMemory(projectDir);
  
  const id = entry.id || generateId();
  const typeDir = path.join(memDir, entry.type);
  if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });
  
  const filePath = path.join(typeDir, id + '.yaml');
  const now = new Date().toISOString();
  
  const record = {
    id: id,
    type: entry.type,
    content: entry.content,
    context: entry.context || '',
    tags: entry.tags || [],
    priority: entry.priority || 'medium',
    created: now,
    updated: now,
    source: entry.source || 'manual',
    active: true,
  };
  
  writeYaml(filePath, record);
  
  // Auto-prune: enforce MAX_ENTRIES_PER_TYPE
  pruneType(projectDir, entry.type);
  
  updateIndex(projectDir);
  
  return { id: id, path: filePath, type: entry.type };
}

function getMemory(projectDir, type, id) {
  const filePath = path.join(getMemoryDir(projectDir), type, id + '.yaml');
  if (!fs.existsSync(filePath)) return null;
  return readYaml(filePath);
}

function updateMemory(projectDir, type, id, updates) {
  const filePath = path.join(getMemoryDir(projectDir), type, id + '.yaml');
  if (!fs.existsSync(filePath)) return { error: 'Memory not found: ' + type + '/' + id };
  
  const record = readYaml(filePath);
  Object.assign(record, updates);
  record.updated = new Date().toISOString();
  writeYaml(filePath, record);
  
  return record;
}

function deleteMemory(projectDir, type, id) {
  const filePath = path.join(getMemoryDir(projectDir), type, id + '.yaml');
  if (!fs.existsSync(filePath)) return { error: 'Memory not found' };
  fs.unlinkSync(filePath);
  updateIndex(projectDir);
  return { deleted: type + '/' + id };
}

/**
 * Prune oldest low-priority entries when a type exceeds MAX_ENTRIES_PER_TYPE.
 */
function pruneType(projectDir, type) {
  const typeDir = path.join(getMemoryDir(projectDir), type);
  if (!fs.existsSync(typeDir)) return;
  const files = fs.readdirSync(typeDir).filter(f => f.endsWith('.yaml'));
  if (files.length <= MAX_ENTRIES_PER_TYPE) return;
  
  // Read all entries with their created timestamps
  const entries = files.map(f => {
    const data = readYaml(path.join(typeDir, f));
    return { file: f, created: data.created || '', priority: data.priority || 'medium' };
  });
  
  // Sort: low priority first, then oldest first
  const priorityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
  entries.sort((a, b) => {
    const pa = priorityOrder[a.priority] || 1;
    const pb = priorityOrder[b.priority] || 1;
    if (pa !== pb) return pa - pb;
    return String(a.created).localeCompare(String(b.created));
  });
  
  // Remove excess entries
  const excess = entries.length - MAX_ENTRIES_PER_TYPE;
  for (let i = 0; i < excess; i++) {
    try { fs.unlinkSync(path.join(typeDir, entries[i].file)); } catch { /* skip */ }
  }
}

// ─── Listing & Search ────────────────────────────────────────────

function listMemories(projectDir, type) {
  const memDir = getMemoryDir(projectDir);
  const entries = [];
  
  const types = type ? [type] : MEMORY_TYPES;
  for (const t of types) {
    const typeDir = path.join(memDir, t);
    if (!fs.existsSync(typeDir)) continue;
    const files = fs.readdirSync(typeDir).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      const data = readYaml(path.join(typeDir, f));
      if (data.active !== false) {
        entries.push({
          id: data.id || f.replace('.yaml', ''),
          type: t,
          content: data.content || '',
          priority: data.priority || 'medium',
          tags: data.tags || [],
          created: data.created || null,
        });
      }
    }
  }
  
  return entries;
}

function searchMemory(projectDir, query) {
  if (!query) return [];
  const queryLower = query.toLowerCase();
  const all = listMemories(projectDir);
  
  return all.filter(entry => {
    const content = String(entry.content || '').toLowerCase();
    const tags = (entry.tags || []).join(' ').toLowerCase();
    return content.includes(queryLower) || tags.includes(queryLower);
  });
}

function getRelevantMemories(projectDir, context) {
  if (!context) return [];
  const contextLower = context.toLowerCase();
  const words = contextLower.split(/\s+/).filter(w => w.length > 3);
  
  const all = listMemories(projectDir);
  const scored = all.map(entry => {
    const content = String(entry.content || '').toLowerCase();
    const tags = (entry.tags || []).join(' ').toLowerCase();
    let score = 0;
    for (const word of words) {
      if (content.includes(word)) score += 2;
      if (tags.includes(word)) score += 3;
    }
    // Priority boost
    const priorityBoost = { critical: 4, high: 3, medium: 2, low: 1 };
    score += priorityBoost[entry.priority] || 0;
    return { ...entry, relevance: score };
  }).filter(e => e.relevance > 0);
  
  scored.sort((a, b) => b.relevance - a.relevance);
  return scored.slice(0, 10);
}

// ─── Index Management ────────────────────────────────────────────

function updateIndex(projectDir) {
  const memDir = getMemoryDir(projectDir);
  const indexPath = path.join(memDir, MEMORY_INDEX);
  
  let total = 0;
  const typeCounts = {};
  for (const type of MEMORY_TYPES) {
    const typeDir = path.join(memDir, type);
    if (fs.existsSync(typeDir)) {
      const count = fs.readdirSync(typeDir).filter(f => f.endsWith('.yaml')).length;
      typeCounts[type] = count;
      total += count;
    } else {
      typeCounts[type] = 0;
    }
  }
  
  writeYaml(indexPath, {
    total_entries: total,
    last_updated: new Date().toISOString(),
    types: JSON.stringify(typeCounts),
  });
  
  return { total, types: typeCounts };
}

function getMemoryStats(projectDir) {
  const memDir = getMemoryDir(projectDir);
  if (!fs.existsSync(memDir)) {
    return {
      initialized: false,
      total_entries: 0,
      types: {},
    };
  }
  
  const index = updateIndex(projectDir);
  const entries = listMemories(projectDir);
  
  const byPriority = {};
  for (const e of entries) {
    byPriority[e.priority] = (byPriority[e.priority] || 0) + 1;
  }
  
  return {
    initialized: true,
    total_entries: index.total,
    types: index.types,
    by_priority: byPriority,
    oldest: entries.length > 0 ? entries.sort((a,b) => String(a.created || '').localeCompare(String(b.created || '')))[0].created : null,
    newest: entries.length > 0 ? entries.sort((a,b) => String(b.created || '').localeCompare(String(a.created || '')))[0].created : null,
  };
}

// ─── Archiving ───────────────────────────────────────────────────

function archiveMemory(projectDir, type, id) {
  return updateMemory(projectDir, type, id, { active: false, archived: new Date().toISOString() });
}

function getArchivedMemories(projectDir) {
  const memDir = getMemoryDir(projectDir);
  const entries = [];
  
  for (const t of MEMORY_TYPES) {
    const typeDir = path.join(memDir, t);
    if (!fs.existsSync(typeDir)) continue;
    const files = fs.readdirSync(typeDir).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      const data = readYaml(path.join(typeDir, f));
      if (data.active === false) {
        entries.push({
          id: data.id || f.replace('.yaml', ''),
          type: t,
          content: data.content || '',
          archived: data.archived || null,
        });
      }
    }
  }
  
  return entries;
}

// ─── Export / Import ─────────────────────────────────────────────

function exportMemories(projectDir) {
  const entries = listMemories(projectDir);
  return {
    exported: new Date().toISOString(),
    count: entries.length,
    entries: entries,
  };
}

function importMemories(projectDir, exported) {
  if (!exported || !exported.entries) return { error: 'Invalid export data' };
  
  let imported = 0;
  let skipped = 0;
  
  for (const entry of exported.entries) {
    if (!entry.type || !entry.content) { skipped++; continue; }
    if (!MEMORY_TYPES.includes(entry.type)) { skipped++; continue; }
    const existing = getMemory(projectDir, entry.type, entry.id);
    if (existing) { skipped++; continue; }
    addMemory(projectDir, entry);
    imported++;
  }
  
  return { imported, skipped };
}


// ==========================================================================
// Sub-module: ezra-memory-hook (Memory Auto-Capture)
// ==========================================================================

// ─── Pattern Detection ───────────────────────────────────────────

const CAPTURE_TRIGGERS = [
  { pattern: /always use/i, type: 'pattern', priority: 'high' },
  { pattern: /never use/i, type: 'anti-pattern', priority: 'high' },
  { pattern: /prefer .+ over/i, type: 'preference', priority: 'medium' },
  { pattern: /lesson learned/i, type: 'lesson', priority: 'high' },
  { pattern: /important:/i, type: 'fact', priority: 'high' },
  { pattern: /warning:/i, type: 'warning', priority: 'high' },
  { pattern: /best practice/i, type: 'pattern', priority: 'medium' },
  { pattern: /avoid .+ because/i, type: 'anti-pattern', priority: 'medium' },
  { pattern: /decided to/i, type: 'decision-context', priority: 'medium' },
  { pattern: /changed .+ from .+ to/i, type: 'decision-context', priority: 'medium' },
];

const MAX_CONTENT_LENGTH = 500;
const MIN_CONTENT_LENGTH = 10;

// ─── Detection Engine ────────────────────────────────────────────

function detectPatterns(text) {
  if (!text || typeof text !== 'string') return [];
  if (text.length < MIN_CONTENT_LENGTH) return [];
  
  const detections = [];
  for (const trigger of CAPTURE_TRIGGERS) {
    const match = text.match(trigger.pattern);
    if (match) {
      // Extract a relevant sentence around the match
      const idx = match.index || 0;
      const start = Math.max(0, text.lastIndexOf('.', idx) + 1);
      const end = Math.min(text.length, text.indexOf('.', idx + match[0].length) + 1 || text.length);
      const content = text.slice(start, end).trim().slice(0, MAX_CONTENT_LENGTH);
      
      if (content.length >= MIN_CONTENT_LENGTH) {
        detections.push({
          type: trigger.type,
          priority: trigger.priority,
          content: content,
          trigger: trigger.pattern.source,
        });
      }
    }
  }
  
  return detections;
}

function extractTags(content) {
  if (!content) return [];
  const tags = [];
  // Extract technology keywords
  const techPatterns = [
    /\b(react|vue|angular|node|python|typescript|javascript|docker|kubernetes|aws|azure|gcp)\b/gi,
    /\b(api|rest|graphql|sql|nosql|redis|mongodb|postgres)\b/gi,
    /\b(testing|security|performance|deployment|ci|cd|lint|format)\b/gi,
  ];
  for (const pat of techPatterns) {
    const matches = content.match(pat);
    if (matches) {
      for (const m of matches) {
        const tag = m.toLowerCase();
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
  }
  return tags.slice(0, 10);
}

// ─── Auto-Capture Handler ────────────────────────────────────────

function processToolOutput(toolOutput, projectDir) {
  if (!toolOutput || typeof toolOutput !== 'string') return { captured: 0, entries: [] };
  
  const detections = detectPatterns(toolOutput);
  if (detections.length === 0) return { captured: 0, entries: [] };
  
  // Try to require memory module for storing
  let memory;
  try {
    memory = require(path.join(__dirname, 'ezra-memory.js'));
  } catch (e) {
    return { captured: 0, entries: [], error: 'Memory module not available' };
  }
  
  const entries = [];
  for (const detection of detections) {
    const tags = extractTags(detection.content);
    const result = memory.addMemory(projectDir, {
      type: detection.type,
      content: detection.content,
      tags: tags,
      priority: detection.priority,
      source: 'auto-capture',
    });
    if (!result.error) {
      entries.push(result);
    }
  }
  
  return { captured: entries.length, entries: entries };
}

// ─── Deduplication ───────────────────────────────────────────────

function isDuplicate(projectDir, content) {
  let memory;
  try {
    memory = require(path.join(__dirname, 'ezra-memory.js'));
  } catch (e) {
    return false;
  }
  
  const existing = memory.searchMemory(projectDir, content.slice(0, 50));
  return existing.some(e => {
    const similarity = calculateSimilarity(String(e.content || ''), content);
    return similarity > 0.8;
  });
}

function calculateSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.length / union.size : 0;
}


// ==========================================================================
// Sub-module: ezra-doc-ingester (Document Ingestion Engine)
// ==========================================================================

const TECH_PATTERNS = {
  languages: [
    { re: /\bTypeScript\b/i, name: 'TypeScript' }, { re: /\bJavaScript\b/i, name: 'JavaScript' },
    { re: /\bPython\b/i, name: 'Python' }, { re: /\bGolang\b/i, name: 'Go' },
    { re: /\bRust\b/i, name: 'Rust' }, { re: /\bSwift\b/i, name: 'Swift' },
    { re: /\bKotlin\b/i, name: 'Kotlin' }, { re: /\bC#\b/i, name: 'C#' },
  ],
  frameworks: [
    { re: /\bNext\.js\b/i, name: 'Next.js' }, { re: /\bReact Native\b|\bExpo\b/i, name: 'React Native' },
    { re: /\bReact\b/i, name: 'React' }, { re: /\bVue\b/i, name: 'Vue.js' },
    { re: /\bFastAPI\b/i, name: 'FastAPI' }, { re: /\bDjango\b/i, name: 'Django' },
    { re: /\bExpress\b/i, name: 'Express' }, { re: /\bNestJS\b/i, name: 'NestJS' },
    { re: /\bAngular\b/i, name: 'Angular' }, { re: /\bFlask\b/i, name: 'Flask' },
  ],
  databases: [
    { re: /\bPostgreSQL\b|\bSupabase\b/i, name: 'PostgreSQL' },
    { re: /\bMySQL\b/i, name: 'MySQL' }, { re: /\bMongoDB\b/i, name: 'MongoDB' },
    { re: /\bRedis\b/i, name: 'Redis' }, { re: /\bSQLite\b/i, name: 'SQLite' },
    { re: /\bPrisma\b/i, name: 'Prisma' }, { re: /\bDrizzle\b/i, name: 'Drizzle' },
    { re: /\bFirebase\b/i, name: 'Firebase' },
  ],
  cloud: [
    { re: /\bVercel\b/i, name: 'Vercel' }, { re: /\bRailway\b/i, name: 'Railway' },
    { re: /\bAWS\b/i, name: 'AWS' }, { re: /\bGCP\b/i, name: 'GCP' },
    { re: /\bAzure\b/i, name: 'Azure' }, { re: /\bDocker\b/i, name: 'Docker' },
    { re: /\bNetlify\b/i, name: 'Netlify' }, { re: /\bFly\.io\b/i, name: 'Fly.io' },
  ],
  testing: [
    { re: /\bJest\b/i, name: 'Jest' }, { re: /\bVitest\b/i, name: 'Vitest' },
    { re: /\bPytest\b/i, name: 'Pytest' }, { re: /\bCypress\b/i, name: 'Cypress' },
    { re: /\bPlaywright\b/i, name: 'Playwright' },
  ],
};

const CONSTRAINT_PATTERNS = [
  { re: /\b(\d+)\s*ms\b/i, type: 'performance', extract: (m) => m[1] + 'ms target' },
  { re: /\bGDPR\b|\bHIPAA\b|\bSOC\s*2\b|\bPCI\b/i, type: 'compliance', extract: (m) => m[0] },
  { re: /\bMVP\b/i, type: 'scope', extract: () => 'MVP scope' },
  { re: /\bmobile.?first\b/i, type: 'ux', extract: () => 'mobile-first' },
  { re: /\breal.?time\b/i, type: 'architecture', extract: () => 'real-time' },
  { re: /\bmulti.?tenant\b|\bSaaS\b/i, type: 'architecture', extract: () => 'multi-tenant SaaS' },
];

function extractSignals(text, filename) {
  function addUnique(arr, val) { if (val && !arr.includes(val)) arr.push(val); }
  const signals = {
    tech_stack: { languages: [], frameworks: [], databases: [], cloud: [], testing: [] },
    features: [], constraints: [], existing_decisions: [], phases: [],
    word_count: text.split(/\s+/).filter(Boolean).length,
    source_file: filename || 'unknown',
  };
  for (const [cat, pats] of Object.entries(TECH_PATTERNS)) {
    for (const { re, name } of pats) { if (re.test(text)) addUnique(signals.tech_stack[cat], name); }
  }
  for (const { re, type, extract } of CONSTRAINT_PATTERNS) {
    const m = text.match(re);
    if (m && !signals.constraints.find(c => c.type === type)) signals.constraints.push({ type, value: extract(m) });
  }
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (/^[-*]\s+\w/.test(t) && t.length > 20 && t.length < 200) {
      addUnique(signals.features, t.replace(/^[-*]\s+/, ''));
      if (signals.features.length >= 30) break;
    }
  }
  const phaseRe = /(?:phase|milestone|sprint)\s+(\d+|[a-z]+)[:\s-]+([^\n]{5,80})/gi;
  let pm;
  while ((pm = phaseRe.exec(text)) !== null && signals.phases.length < 10) {
    if (!signals.phases.find(x => x.id === pm[1])) signals.phases.push({ id: pm[1], description: pm[2].trim() });
  }
  return signals;
}

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.json', '.ts', '.js', '.py']);
const BINARY_EXTENSIONS    = new Set(['.pdf', '.docx', '.doc', '.pptx', '.xlsx']);

function ingestFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    const empty = { languages: [], frameworks: [], databases: [], cloud: [], testing: [] };
    return { signals: { tech_stack: empty, features: [], constraints: [], existing_decisions: [], phases: [],
      word_count: 0, source_file: path.basename(filePath), needs_manual_review: true,
      format: ext.slice(1).toUpperCase() }, error: null };
  }
  if (!SUPPORTED_EXTENSIONS.has(ext)) return { signals: null, error: 'Unsupported: ' + ext };
  try {
    const MAX_BYTES = 500 * 1024;
    const stat = fs.statSync(filePath);
    let text;
    if (stat.size > MAX_BYTES) {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(MAX_BYTES);
      fs.readSync(fd, buf, 0, MAX_BYTES, 0);
      fs.closeSync(fd);
      text = buf.toString('utf8');
    } else {
      text = fs.readFileSync(filePath, 'utf8');
    }
    return { signals: extractSignals(text, path.basename(filePath)), error: null };
  } catch (e) {
    return { signals: null, error: e.message };
  }
}

function ingestPaths(paths) {
  function addUnique(arr, val) { if (val && !arr.includes(val)) arr.push(val); }
  const merged = { tech_stack: { languages: [], frameworks: [], databases: [], cloud: [], testing: [] },
    features: [], constraints: [], existing_decisions: [], phases: [],
    files_processed: [], files_skipped: [], needs_manual_review: [], total_words: 0 };
  for (const p of paths) {
    if (!fs.existsSync(p)) { merged.files_skipped.push(p); continue; }
    const stat = fs.statSync(p);
    const files = stat.isDirectory()
      ? fs.readdirSync(p).map(f => path.join(p, f)).filter(f => fs.statSync(f).isFile())
      : [p];
    for (const fp of files) {
      const { signals, error } = ingestFile(fp);
      if (error || !signals) { merged.files_skipped.push(fp); continue; }
      merged.files_processed.push(path.basename(fp));
      merged.total_words += signals.word_count || 0;
      if (signals.needs_manual_review) { merged.needs_manual_review.push(path.basename(fp)); continue; }
      for (const cat of Object.keys(merged.tech_stack)) {
        for (const item of (signals.tech_stack[cat] || [])) addUnique(merged.tech_stack[cat], item);
      }
      for (const f of (signals.features || [])) addUnique(merged.features, f);
      for (const c of (signals.constraints || [])) {
        if (!merged.constraints.find(x => x.type === c.type)) merged.constraints.push(c);
      }
      for (const ph of (signals.phases || [])) {
        if (!merged.phases.find(x => x.id === ph.id)) merged.phases.push(ph);
      }
    }
  }
  return merged;
}


// ==========================================================================
// Sub-module Router
// ==========================================================================

/**
 * Route a stdin event to the appropriate sub-module handler.
 * Called by thin wrappers when invoked as main.
 */
function _handleSubModule(submodule, data) {
  let result;
  try {
    switch (submodule) {
      case 'ezra-memory': {
        const action = data.action || 'stats';
        const projectDir = data.project_dir || data.projectDir || process.cwd();
        switch (action) {
          case 'init': result = initMemory(projectDir); break;
          case 'add': result = addMemory(projectDir, data.entry || data); break;
          case 'get': result = getMemory(projectDir, data.type, data.id); break;
          case 'list': result = listMemories(projectDir, data.type); break;
          case 'search': result = searchMemory(projectDir, data.query); break;
          case 'relevant': result = getRelevantMemories(projectDir, data.context); break;
          case 'stats': result = getMemoryStats(projectDir); break;
          case 'delete': result = deleteMemory(projectDir, data.type, data.id); break;
          case 'export': result = exportMemories(projectDir); break;
          case 'import': result = importMemories(projectDir, data.data); break;
          default: result = { error: 'Unknown action: ' + action };
        }
        break;
      }
      case 'ezra-memory-hook': {
        const projectDir = data.project_dir || data.projectDir || process.cwd();
        const resolved = path.resolve(projectDir);
        if (resolved !== projectDir && !fs.existsSync(path.join(resolved, '.ezra'))) {
          result = { error: 'invalid project directory' };
        } else {
          result = processToolOutput(data.tool_output || data.output || '', resolved);
        }
        break;
      }
      case 'ezra-doc-ingester': {
        result = ingestPaths(data.files || []);
        break;
      }
      default:
        result = { error: 'Unknown sub-module: ' + submodule };
    }
  } catch (e) {
    const msg = _fmt('MEMORY_001', { detail: e.message });
    process.stderr.write(msg + '\n');
    _log(process.cwd(), 'ezra-memory-module', 'warn', msg);
    result = { error: e.message };
  }
  process.stdout.write(JSON.stringify(result || {}));
}

// ==========================================================================
// Exports -- union of all 3 sub-modules
// ==========================================================================

module.exports = {
  // ezra-memory exports
  MEMORY_DIR, MEMORY_INDEX, MEMORY_TYPES, MEMORY_PRIORITIES, MAX_ENTRIES_PER_TYPE,
  getMemoryDir, initMemory, generateId, addMemory, getMemory, updateMemory,
  deleteMemory, pruneType, listMemories, searchMemory, getRelevantMemories,
  updateIndex, getMemoryStats, archiveMemory, getArchivedMemories,
  exportMemories, importMemories, readYaml, writeYaml,
  // ezra-memory-hook exports
  CAPTURE_TRIGGERS, MAX_CONTENT_LENGTH, MIN_CONTENT_LENGTH,
  detectPatterns, extractTags, processToolOutput, isDuplicate, calculateSimilarity,
  // ezra-doc-ingester exports
  extractSignals, ingestFile, ingestPaths, SUPPORTED_EXTENSIONS, BINARY_EXTENSIONS, TECH_PATTERNS,
  // internal router
  _handleSubModule,
};

// ==========================================================================
// Hook Protocol (stdin handler when run directly)
// ==========================================================================

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
      // Route based on context clues in the event payload
      if (data.tool_output || data.output) {
        _handleSubModule('ezra-memory-hook', data);
      } else if (data.files) {
        _handleSubModule('ezra-doc-ingester', data);
      } else {
        _handleSubModule('ezra-memory', data);
      }
    } catch (e) {
      const msg = _fmt('MEMORY_001', { detail: e.message });
      process.stderr.write(msg + '\n');
      _log(process.cwd(), 'ezra-memory-module', 'warn', msg);
      process.stdout.write(JSON.stringify({ error: e.message }));
    }
    process.exit(0);
  });
}
