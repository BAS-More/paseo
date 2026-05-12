#!/usr/bin/env node
/**
 * reflect-drain — Phase 4 T4.5b
 *
 * Event:   Stop
 * Matcher: (none)
 *
 * Drains the reflect-queue (populated by reflect-detect.js) into
 * per-project staging files for the user / claude-reflect:reflect skill
 * to promote into durable MEMORY.md entries.
 *
 * Lightweight: NO LLM call inside the hook. Just writes stub candidate
 * files to projects/<slug>/memory/_staging/<ts>-<phrase-slug>.md.
 * Avoids cost runaway and matches existing claude-reflect skill flow.
 *
 * Bypass: stop_hook_active === true → no-op (recursion guard).
 *         env CLAUDE_REFLECT_DISABLE=1 → no-op.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, '.claude', 'state');
const QUEUE_FILE = path.join(STATE_DIR, 'reflect-queue.jsonl');
const PROJECTS_BASE = path.join(HOME, '.claude', 'projects');
const MAX_STDIN = 1024 * 1024;
const MAX_PER_DRAIN = 5; // cost guard

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

function safeReadJsonl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// QAL-002: tightened from score>=slug.length/2 to score==slug.length (ALL parts must match).
// Prevents wrong-project writes when projects share path tokens (e.g. 'dev', 'tools').
function findProjectMemory(cwd) {
  if (!cwd || !fs.existsSync(PROJECTS_BASE)) return null;
  const cwdNorm = cwd.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  try {
    const dirs = fs.readdirSync(PROJECTS_BASE, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'));
    let best = null;
    let bestScore = 0;
    for (const dir of dirs) {
      const slug = dir.name.toLowerCase().split('-').filter(p => p.length >= 2);
      if (slug.length === 0) continue;
      let score = 0;
      for (const part of slug) if (cwdNorm.includes(part)) score++;
      // Strict: ALL slug parts must appear in cwd
      if (score === slug.length && score > bestScore) {
        bestScore = score;
        best = path.join(PROJECTS_BASE, dir.name, 'memory');
      }
    }
    if (!best) {
      _log('reflect-drain', 'project-resolve-miss', { cwd });
    }
    return best;
  } catch { return null; }
}

// SEC-003: redact secret-shaped tokens from user message before persisting.
// Reflect candidates can land in disk/git/sync — must not contain pasted secrets.
function redact(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\b(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/g, '[REDACTED-JWT]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED-AWS-KEY]')
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, '[REDACTED-GH-PAT]')
    .replace(/\bsk-[A-Za-z0-9_\-]{40,}\b/g, '[REDACTED-LLM-KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{20,}/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, '[REDACTED-HEX]')
    .replace(/(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, m => m.split(/[:=]/)[0] + '=[REDACTED]');
}

function slugifyPhrase(phrase) {
  return phrase.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'correction';
}

function writeCandidate(memDir, entry) {
  const stagingDir = path.join(memDir, '_staging');
  try { fs.mkdirSync(stagingDir, { recursive: true }); } catch {}
  const ts = entry.ts.replace(/[:.]/g, '-');
  const fname = `${ts}-${slugifyPhrase(entry.phrase)}.md`;
  const body = `---
name: Reflect candidate (auto-drained)
description: User correction detected; promote via /claude-reflect:reflect or hand-edit
type: candidate
ts: ${entry.ts}
session_id: ${entry.session_id || 'unknown'}
phrase: ${JSON.stringify(entry.phrase)}
cwd: ${entry.cwd || ''}
---

# Correction candidate

**Phrase detected:** \`${entry.phrase}\`

**User message excerpt:**

> ${redact(entry.user_msg).replace(/\n/g, '\n> ')}

## How to promote

1. Review the message + assistant response from this session
2. Distill the correction into a durable rule (1-3 sentences)
3. If durable, move to \`feedback_<topic>.md\` or \`learning_<topic>.md\` in this dir
4. Add link to MEMORY.md index
5. Delete this candidate file

If transient / not durable: just delete this file.
`;
  try { fs.writeFileSync(path.join(stagingDir, fname), body, 'utf8'); return fname; }
  catch (err) { _log('reflect-drain', 'write-failed', { error: err.message }); return null; }
}

function rewriteQueueWithoutDrained(remaining) {
  try {
    if (remaining.length === 0) {
      try { fs.unlinkSync(QUEUE_FILE); } catch {}
      return;
    }
    const tmp = QUEUE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, remaining.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (err) {
    _log('reflect-drain', 'queue-rewrite-failed', { error: err.message });
  }
}

function main() {
  if (process.env.CLAUDE_REFLECT_DISABLE === '1') return;

  const raw = readStdinSync();
  let event = {};
  try { event = JSON.parse(raw); } catch {}

  if (event.stop_hook_active === true) return; // recursion guard

  const queue = safeReadJsonl(QUEUE_FILE);
  if (queue.length === 0) return;

  const sessionId = event.session_id || null;
  // Process up to MAX_PER_DRAIN entries scoped to this session if possible
  const eligible = sessionId
    ? queue.filter(e => e.session_id === sessionId).slice(0, MAX_PER_DRAIN)
    : queue.slice(0, MAX_PER_DRAIN);
  if (eligible.length === 0) return;

  let drained = 0;
  for (const entry of eligible) {
    const memDir = findProjectMemory(entry.cwd);
    if (!memDir) continue;
    if (writeCandidate(memDir, entry)) drained++;
  }

  // Remove drained from queue (keep eligible-but-not-drained items for next pass)
  if (drained > 0) {
    const drainedSet = new Set(eligible.slice(0, drained).map(e => e.ts + '|' + (e.session_id || '')));
    const remaining = queue.filter(e => !drainedSet.has(e.ts + '|' + (e.session_id || '')));
    rewriteQueueWithoutDrained(remaining);
    _log('reflect-drain', 'drained', { count: drained });
  }
}

try { main(); } catch (err) {
  _log('reflect-drain', 'error', { error: err.message });
}
process.exit(0);
