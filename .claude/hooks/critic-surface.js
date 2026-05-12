#!/usr/bin/env node
/**
 * critic-surface — Phase 3 T3.2 companion
 *
 * Event:   UserPromptSubmit
 * Matcher: (none)
 *
 * Reads the marker file written by critic-suggest.js (Stop hook). If a
 * fresh marker exists (< 24h old), surface a 1-line suggestion in
 * additionalContext on the next user prompt. User decides whether to
 * invoke the critic / ezra-reviewer agent.
 *
 * Marker is consumed (not deleted) — only deleted by critic-suggest when
 * diff drops below threshold or by user via `~/.claude/.critic-disabled`.
 *
 * Bypass: env CLAUDE_CRITIC_DISABLE=1 → no-op.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const MARKER_FILE = path.join(HOME, '.claude', 'state', 'critic-needed.json');
const MAX_AGE_HOURS = 24;
const MAX_STDIN = 1024 * 1024;

function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    return buf.length > MAX_STDIN ? '' : buf.toString('utf8');
  } catch { return ''; }
}

function main() {
  if (process.env.CLAUDE_CRITIC_DISABLE === '1') return;
  if (fs.existsSync(path.join(HOME, '.claude', '.critic-disabled'))) return;
  readStdinSync(); // drain

  if (!fs.existsSync(MARKER_FILE)) return;

  let payload;
  try { payload = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8')); } catch { return; }

  // QAL-001: validate required fields before string interpolation —
  // schema drift between critic-suggest and critic-surface would otherwise
  // emit `undefined` strings into Claude's additionalContext on every prompt.
  if (
    typeof payload.ts !== 'string' ||
    typeof payload.total !== 'number' ||
    typeof payload.insertions !== 'number' ||
    typeof payload.deletions !== 'number' ||
    typeof payload.files_changed !== 'number' ||
    typeof payload.repo !== 'string' ||
    typeof payload.base !== 'string'
  ) {
    // Malformed marker — delete it so we don't keep emitting partial data
    try { fs.unlinkSync(MARKER_FILE); } catch {}
    return;
  }

  const ageMs = Date.now() - new Date(payload.ts).getTime();
  if (ageMs > MAX_AGE_HOURS * 3600 * 1000) {
    try { fs.unlinkSync(MARKER_FILE); } catch {}
    return;
  }

  const repoName = path.basename(payload.repo);
  const ageH = (ageMs / 3600000).toFixed(1);
  console.log(
    `[critic-suggest] ${repoName}: diff ${payload.total} LOC (${payload.insertions}+/${payload.deletions}-) across ${payload.files_changed} files vs ${payload.base}, ${ageH}h ago. Consider running the critic agent before merge. Disable: \`touch ~/.claude/.critic-disabled\``
  );
}

try { main(); } catch (_) { /* fail-open */ }
process.exit(0);
