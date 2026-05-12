#!/usr/bin/env node
/**
 * disk-secret-sweep
 *
 * Event: SessionStart (runs opportunistically, max once per 24h)
 *
 * Sweeps known-risky on-disk locations for hardcoded secrets using gitleaks.
 * Complements secret-scanner.js (which only guards prompts, not files on disk).
 *
 * Scan targets:
 *   - ~/.claude/                           (settings.json, .mcp.json, etc.)
 *   - %APPDATA%/Claude/                    (Claude Desktop config)
 *   - C:/Dev/tools/                        (vault-adjacent scripts)
 *
 * Output: writes findings to ~/.claude/_logs/tool-health-incidents.jsonl
 *         and prints a SessionStart warning if any hits.
 *
 * Fail-open — errors let the session continue.
 * Zero deps. Uses gitleaks (from PATH) + secret-scanner.toml config.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const STATE_FILE = path.join(CLAUDE_DIR, 'disk-sweep-state.json');
const INCIDENT_LOG = path.join(CLAUDE_DIR, '_logs', 'tool-health-incidents.jsonl');
const CONFIG = path.join(CLAUDE_DIR, 'hooks', 'secret-scanner.toml');
const GITLEAKS = process.env.GITLEAKS_BIN || 'gitleaks';

const TARGETS = [
  CLAUDE_DIR,
  path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Claude'),
  'C:/Dev/tools',
];

// Known false-positive paths (normalized forward-slash, lowercase)
// Excludes Claude's own auth artifacts, plugin marketplace metadata, caches,
// and transcript/tool-result files that commonly quote example tokens.
const FALSE_POSITIVE_PATTERNS = [
  '/.credentials.json',
  '/plugins/marketplaces/',
  '/plugins/cache/',
  '/projects/',        // session transcripts, tool results
  '/backups/',
  '/shell-snapshots/',
  '/session-logs/',
  '/sessions/',
  '/tool-results/',
  '/node_modules/',
  '/.git/',
  '/dist/',
  '/build/',
  '/ide/',             // IDE lock files with session IDs
  '/hooks-manifest.json', // SHA256 hashes trigger generic-api-key
  '/.manifest.sha256',
  '/fact/docs/',       // FACT project documentation examples
  '/crawler-ninja/docs/', // crawler-ninja docs with example tokens
  '/.cache/',
  '/cache/',
  '/.next/',
];

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const SCAN_TIMEOUT_MS = 20000;

// ─── Read SessionStart payload (ignored; we just need the trigger) ─────

let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { stdinData += c; if (stdinData.length > 1024 * 128) process.exit(0); });
process.stdin.on('end', () => run());

function run() {
  try {
    if (!dueForSweep()) { process.exit(0); return; }
    const findings = scanAll();
    recordState();

    // High-signal rules = provider-specific, not heuristic
    const HIGH_SIGNAL = new Set([
      'github-pat', 'github-oauth', 'github-fine-grained-pat', 'github-app-token',
      'aws-access-token', 'aws-secret-key',
      'cloudflare-api-key', 'cloudflare-user-api-token', 'cloudflare-global-api-key',
      'anthropic-api-key', 'openai-api-key', 'stripe-access-token',
      'slack-bot-token', 'slack-user-token', 'slack-webhook',
      'private-key', 'ssh-dsa-private-key', 'ssh-ec-private-key', 'ssh-rsa-private-key',
      'gcp-api-key', 'gcp-service-account',
      'supabase-service-role-jwt', 'sbp-token',
      'twilio-api-key', 'sendgrid-api-key',
    ]);

    const highSignal = findings.filter(f => HIGH_SIGNAL.has(String(f.rule).toLowerCase()));
    const lowSignal = findings.filter(f => !HIGH_SIGNAL.has(String(f.rule).toLowerCase()));

    if (findings.length > 0) writeIncident(findings, highSignal.length, lowSignal.length);
    if (highSignal.length > 0) emitWarning(highSignal, lowSignal.length);
  } catch (_err) {
    // Fail-open: never block a session
  }
  process.exit(0);
}

function dueForSweep() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return (Date.now() - (s.lastRun || 0)) >= SWEEP_INTERVAL_MS;
  } catch {
    return true;
  }
}

function recordState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ lastRun: Date.now() })); } catch {}
}

function scanAll() {
  const hits = [];
  for (const target of TARGETS) {
    if (!fs.existsSync(target)) continue;
    const report = path.join(os.tmpdir(), `disk-sweep-${randomUUID()}.json`);
    const args = [
      'detect',
      '--no-git',
      `--source=${target}`,
      `--report-format=json`,
      `--report-path=${report}`,
      '--exit-code=0',
      '--no-banner',
      '--log-level=error',
      '--redact',
    ];
    if (fs.existsSync(CONFIG)) args.push(`--config=${CONFIG}`);

    const res = spawnSync(GITLEAKS, args, { encoding: 'utf8', timeout: SCAN_TIMEOUT_MS });
    if (res.error) continue;

    try {
      if (fs.existsSync(report)) {
        const raw = fs.readFileSync(report, 'utf8');
        const parsed = JSON.parse(raw) || [];
        for (const h of parsed) {
          const normalized = String(h.File || '').replace(/\\/g, '/').toLowerCase();
          if (FALSE_POSITIVE_PATTERNS.some(p => normalized.includes(p))) continue;
          hits.push({
            target,
            file: h.File,
            rule: h.RuleID,
            description: h.Description,
            line: h.StartLine,
          });
        }
      }
    } catch {} finally {
      try { fs.unlinkSync(report); } catch {}
    }
  }
  return hits;
}

function writeIncident(findings, highCount, lowCount) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    severity: highCount > 0 ? 'high' : 'low',
    source: 'disk-secret-sweep',
    count: findings.length,
    highSignal: highCount,
    lowSignal: lowCount,
    findings: findings.slice(0, 30),
  });
  try { fs.appendFileSync(INCIDENT_LOG, line + '\n'); } catch {}
}

function emitWarning(findings, lowCount) {
  const grouped = {};
  for (const f of findings) {
    const k = f.rule || 'unknown';
    grouped[k] = (grouped[k] || 0) + 1;
  }
  const summary = Object.entries(grouped).map(([r, n]) => `${r}×${n}`).join(', ');
  const msg = [
    '',
    '[disk-secret-sweep] WARNING: high-signal secrets detected on disk',
    `  ${findings.length} finding(s): ${summary}`,
    lowCount > 0 ? `  (${lowCount} additional low-signal hits logged, not shown)` : '',
    `  Details: ${INCIDENT_LOG}`,
    `  First file: ${findings[0].file}:${findings[0].line}`,
    '  Rotate affected secrets and move to vault immediately.',
    '',
  ].filter(Boolean).join('\n');
  process.stdout.write(msg);
}
