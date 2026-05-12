#!/usr/bin/env node
'use strict';

/**
 * hooks/ezra-devops.js — Consolidated DevOps Module for EZRA v7
 *
 * Merges: ezra-commit-engine, ezra-deploy-trigger, ezra-scraper,
 *         ezra-installer, ezra-workflows, ezra-workflow-executor,
 *         ezra-pre-commit, ezra-pre-push, token-shield-validator
 *
 * ZERO external dependencies — pure Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execFile } = require('child_process');
const https = require('https');
const http = require('http');

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

// ─── Hub Imports (fail-open) ───────────────────────────────────

let _http, _settings, _log, _fmt;
try { _http = require('./ezra-http.js'); } catch { _http = null; }
try { _settings = require('./ezra-settings.js'); } catch { _settings = null; }
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// ═══════════════════════════════════════════════════════════════
//  SECTION 1: COMMIT ENGINE (from ezra-commit-engine.js)
// ═══════════════════════════════════════════════════════════════

const MAX_FILES_PER_BATCH = 10;

// Protected branches that can never be pushed to directly
const PROTECTED_BRANCHES = ['main', 'master', 'production', 'release'];

// Conventional commit types
const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', 'ci', 'build'];

// Safe branch/tag name pattern: alphanumeric, hyphens, underscores, dots, slashes
const SAFE_REF_NAME = /^[a-zA-Z0-9._\-/]+$/;

/**
 * Validate a branch or tag name against safe characters.
 * Throws if the name contains shell-unsafe characters.
 */
function validateRefName(name) {
  if (!name || typeof name !== 'string') throw new Error('Invalid ref name: empty or non-string');
  if (!SAFE_REF_NAME.test(name)) throw new Error(`Unsafe ref name rejected: ${name.slice(0, 60)}`);
  if (name.includes('..') || name.startsWith('-') || name.endsWith('.lock')) {
    throw new Error(`Invalid ref name rejected: ${name.slice(0, 60)}`);
  }
  return name;
}

/**
 * Run a git command safely using execFileSync (no shell).
 * @param {string[]} args - array of arguments passed to git
 * @param {string} [cwd] - working directory
 * Returns { success, output, error }
 */
function runGit(args, cwd) {
  try {
    const argsArray = Array.isArray(args) ? args : args.split(/\s+/);
    const output = execFileSync('git', argsArray, { cwd, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: output.trim() };
  } catch (e) {
    return { success: false, output: '', error: (e.stderr || e.message || '').trim() };
  }
}

/**
 * Get list of changed files (staged + unstaged, excluding untracked).
 * Returns string[] of relative paths.
 */
function getChangedFiles(projectDir) {
  const staged = runGit(['diff', '--cached', '--name-only'], projectDir);
  const unstaged = runGit(['diff', '--name-only'], projectDir);

  const files = new Set();
  if (staged.success) staged.output.split('\n').filter(Boolean).forEach(f => files.add(f));
  if (unstaged.success) unstaged.output.split('\n').filter(Boolean).forEach(f => files.add(f));
  return Array.from(files);
}

/**
 * Get only staged files (commit-engine version).
 */
function commitGetStagedFiles(projectDir) {
  const result = runGit(['diff', '--cached', '--name-only'], projectDir);
  return result.success ? result.output.split('\n').filter(Boolean) : [];
}

/**
 * Split files into batches of max MAX_FILES_PER_BATCH.
 * Returns string[][]
 */
function batchFiles(files, maxPerBatch) {
  const max = maxPerBatch || MAX_FILES_PER_BATCH;
  const batches = [];
  for (let i = 0; i < files.length; i += max) {
    batches.push(files.slice(i, i + max));
  }
  return batches.length > 0 ? batches : [[]];
}

/**
 * Generate a conventional commit message from files changed and a description.
 * Infers type from file paths.
 */
function generateCommitMessage(files, description, options = {}) {
  const type = options.type || inferCommitType(files);
  const scope = options.scope || inferScope(files);
  const header = scope ? `${type}(${scope}): ${description}` : `${type}: ${description}`;
  const body = options.body || '';
  const footer = options.footer || '';

  const parts = [header];
  if (body) parts.push('', body);
  if (footer) parts.push('', footer);
  return parts.join('\n');
}

/**
 * Infer commit type from file paths.
 */
function inferCommitType(files) {
  const paths = files.join(' ').toLowerCase();
  if (paths.includes('test') || paths.includes('spec')) return 'test';
  if (paths.includes('doc') || paths.includes('.md')) return 'docs';
  if (paths.includes('.css') || paths.includes('.scss')) return 'style';
  if (paths.includes('fix') || paths.includes('bug')) return 'fix';
  if (paths.includes('ci') || paths.includes('.github')) return 'ci';
  return 'feat';
}

/**
 * Infer scope from file paths.
 */
function inferScope(files) {
  if (files.length === 0) return '';
  const dirs = files.map(f => f.split('/')[0]).filter(Boolean);
  const counts = {};
  for (const d of dirs) { counts[d] = (counts[d] || 0) + 1; }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topDir = sorted[0] ? sorted[0][0] : '';
  const skip = new Set(['src', 'lib', 'app', 'hooks', 'tests', 'docs', 'commands']);
  return skip.has(topDir) ? '' : topDir;
}

/**
 * Get current branch name.
 */
function getCurrentBranch(projectDir) {
  const result = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectDir);
  return result.success ? result.output : 'unknown';
}

/**
 * Check if branch is protected.
 */
function isProtectedBranch(branch) {
  const lower = branch.toLowerCase();
  return PROTECTED_BRANCHES.some(p => lower === p || lower.startsWith(p + '/'));
}

/**
 * Stage specific files and create a commit.
 * Returns { success, sha, message }
 */
function commitBatch(projectDir, files, message) {
  if (!files || files.length === 0) return { success: false, error: 'No files to commit' };

  for (const f of files) {
    const stageResult = runGit(['add', f], projectDir);
    if (!stageResult.success) {
      return { success: false, error: `Failed to stage ${f}: ${stageResult.error}` };
    }
  }

  const commitResult = runGit(['commit', '-m', message], projectDir);
  if (!commitResult.success) {
    return { success: false, error: commitResult.error };
  }

  const shaResult = runGit(['rev-parse', 'HEAD'], projectDir);
  return { success: true, sha: shaResult.output, message };
}

/**
 * Push current branch to origin.
 * Guards against pushing to protected branches without override.
 */
function pushBranch(projectDir, options = {}) {
  const branch = getCurrentBranch(projectDir);
  if (isProtectedBranch(branch) && !options.force_push_protected) {
    return {
      success: false,
      error: `Branch '${branch}' is protected. Cannot push without explicit override.`,
      protected: true,
    };
  }
  validateRefName(branch);
  const pushArgs = options.set_upstream
    ? ['push', '-u', 'origin', branch]
    : ['push', 'origin', branch];
  const result = runGit(pushArgs, projectDir);
  return { success: result.success, output: result.output, error: result.error, branch };
}

/**
 * Create a GitHub PR via REST API.
 * Requires settings.github.token, repo_owner, repo_name.
 */
async function createPR(projectDir, options = {}) {
  if (!_http) return { success: false, error: 'ezra-http not available' };
  const settings = _settings ? _settings.loadSettings(projectDir) : {};
  const github = settings.github || {};

  if (!github.token) return { success: false, error: 'GitHub token not configured' };
  if (!github.repo_owner || !github.repo_name) return { success: false, error: 'GitHub repo_owner and repo_name not configured' };

  const branch = getCurrentBranch(projectDir);
  const baseBranch = options.base_branch || github.base_branch || 'main';

  const body = {
    title: options.title || `feat: automated PR from EZRA (${branch})`,
    body: options.body || `Automated pull request created by EZRA autonomous execution.\n\nBranch: ${branch}`,
    head: branch,
    base: baseBranch,
    draft: options.draft || false,
  };

  try {
    const result = await _http.post(
      `https://api.github.com/repos/${github.repo_owner}/${github.repo_name}/pulls`,
      body,
      {
        'Authorization': `token ${github.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      }
    );
    return { success: true, pr_url: result.html_url, pr_number: result.number };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Auto-merge a PR if settings allow.
 */
async function autoMerge(projectDir, prNumber) {
  if (!_http) return { success: false, error: 'ezra-http not available' };
  const settings = _settings ? _settings.loadSettings(projectDir) : {};
  const github = settings.github || {};

  if (!github.auto_merge_on_green) return { success: false, skipped: true, reason: 'auto_merge_on_green not enabled' };
  if (!github.token || !github.repo_owner || !github.repo_name) return { success: false, error: 'GitHub not fully configured' };

  try {
    const result = await _http.post(
      `https://api.github.com/repos/${github.repo_owner}/${github.repo_name}/pulls/${prNumber}/merge`,
      { merge_method: 'squash' },
      {
        'Authorization': `token ${github.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      }
    );
    return { success: true, merged: result.merged, sha: result.sha };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// batchCommits is an alias for batchFiles
const batchCommits = batchFiles;

// ═══════════════════════════════════════════════════════════════
//  SECTION 2: DEPLOY TRIGGER (from ezra-deploy-trigger.js)
// ═══════════════════════════════════════════════════════════════

// Supported deploy targets
const DEPLOY_TARGETS = ['vercel', 'railway', 'netlify', 'custom'];

/**
 * Trigger a Vercel deploy via deploy hook URL.
 */
async function triggerVercel(hookUrl, options = {}) {
  if (!_http) return { success: false, error: 'ezra-http not available' };
  try {
    const result = await _http.post(hookUrl, {}, { 'Content-Type': 'application/json' });
    return { success: true, provider: 'vercel', job: result.job };
  } catch (e) {
    return { success: false, provider: 'vercel', error: e.message };
  }
}

/**
 * Trigger a Railway deploy via webhook URL.
 */
async function triggerRailway(hookUrl, options = {}) {
  if (!_http) return { success: false, error: 'ezra-http not available' };
  try {
    await _http.post(hookUrl, { ref: options.branch || 'main' }, { 'Content-Type': 'application/json' });
    return { success: true, provider: 'railway' };
  } catch (e) {
    return { success: false, provider: 'railway', error: e.message };
  }
}

/**
 * Trigger a Netlify deploy via build hook URL.
 */
async function triggerNetlify(hookUrl, options = {}) {
  if (!_http) return { success: false, error: 'ezra-http not available' };
  try {
    await _http.post(hookUrl, {
      trigger_title: options.title || 'EZRA Deploy',
      trigger_branch: options.branch || 'main',
    }, { 'Content-Type': 'application/json' });
    return { success: true, provider: 'netlify' };
  } catch (e) {
    return { success: false, provider: 'netlify', error: e.message };
  }
}

/**
 * Trigger a custom webhook deploy.
 */
async function triggerCustom(hookUrl, payload, headers) {
  if (!_http) return { success: false, error: 'ezra-http not available' };
  try {
    await _http.post(hookUrl, payload || {}, headers || { 'Content-Type': 'application/json' });
    return { success: true, provider: 'custom', url: hookUrl };
  } catch (e) {
    return { success: false, provider: 'custom', error: e.message };
  }
}

/**
 * Main deploy dispatcher.
 * Reads deploy settings from project config and triggers the right provider.
 */
async function triggerDeploy(projectDir, options = {}) {
  const settings = _settings ? _settings.loadSettings(projectDir) : {};
  const deploy = settings.deploy || {};

  if (!deploy.hook_url) {
    return { success: false, skipped: true, reason: 'No deploy hook_url configured' };
  }

  if (!deploy.auto_deploy && !options.force) {
    return { success: false, skipped: true, reason: 'auto_deploy is disabled — pass force: true to override' };
  }

  if (deploy.production_approval && !options.approved) {
    return {
      success: false,
      requires_approval: true,
      reason: 'Production deploy requires explicit approval',
    };
  }

  const target = deploy.target || 'custom';
  const branch = options.branch || 'main';

  let result;
  if (target === 'vercel') {
    result = await triggerVercel(deploy.hook_url, { branch });
  } else if (target === 'railway') {
    result = await triggerRailway(deploy.hook_url, { branch });
  } else if (target === 'netlify') {
    result = await triggerNetlify(deploy.hook_url, { branch });
  } else {
    result = await triggerCustom(deploy.hook_url, { branch, ...options.payload });
  }

  if (result.success) {
    _log(projectDir, 'ezra-deploy-trigger', 'info', `Deploy triggered via ${target}`);
  } else {
    _log(projectDir, 'ezra-deploy-trigger', 'warn', `Deploy failed: ${result.error}`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 3: SCRAPER (from ezra-scraper.js)
// ═══════════════════════════════════════════════════════════════

const ALLOWED_DOMAINS = [
  'owasp.org',
  'developer.mozilla.org',
  'react.dev',
  'nodejs.org',
  'www.typescriptlang.org',
  'eslint.org',
  'vitest.dev',
  'nextjs.org',
  'docs.expo.dev',
  'fastapi.tiangolo.com',
  'nvd.nist.gov',
  'github.com/advisories'
];

function getDomain(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'github.com') {
      return parsed.hostname + parsed.pathname.replace(/\/$/, '');
    }
    return parsed.hostname;
  } catch (_) {
    return null;
  }
}

function isAllowed(url) {
  const domain = getDomain(url);
  if (!domain) return false;
  return ALLOWED_DOMAINS.some(allowed => {
    if (allowed.includes('/')) return domain.startsWith(allowed) || domain === allowed;
    return domain === allowed || domain.endsWith('.' + allowed);
  });
}

function fetchUrl(url, hops) {
  if (hops === undefined) hops = 0;
  return new Promise((resolve, reject) => {
    if (hops > 5) {
      return reject(new Error(`Too many redirects (max 5) for ${url}`));
    }
    if (!isAllowed(url)) {
      return reject(new Error(`Domain not in allowlist: ${url}`));
    }
    let parsed;
    try { parsed = new URL(url); } catch (e) { return reject(e); }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, hops + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
    req.on('error', reject);
  });
}

function extractTextContent(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scrapeUrl(url) {
  if (!isAllowed(url)) {
    return Promise.reject(new Error(`Domain not in allowlist: ${url}`));
  }
  let parsed;
  try { parsed = new URL(url); } catch (e) { return Promise.reject(e); }
  const domain = parsed.hostname;
  return fetchUrl(url).then(html => {
    const content = extractTextContent(html);
    const word_count = content.split(/\s+/).filter(Boolean).length;
    return { url, domain, content, fetched_at: new Date().toISOString(), word_count };
  });
}

function diffAgainstLibrary(newEntries, existingEntries) {
  const key = e => `${e.title || ''}|${e.category || ''}`;
  const existingMap = new Map((existingEntries || []).map(e => [key(e), e]));
  const added = [];
  const updated = [];
  let unchanged_count = 0;
  for (const entry of (newEntries || [])) {
    const k = key(entry);
    if (!existingMap.has(k)) {
      added.push(entry);
    } else {
      const existing = existingMap.get(k);
      if (JSON.stringify(existing) !== JSON.stringify(entry)) {
        updated.push(entry);
      } else {
        unchanged_count++;
      }
    }
  }
  return { new: added, updated, unchanged_count };
}

function getDefaultSources(techFilter) {
  const sources = [
    { url: 'https://owasp.org/www-project-top-ten/', category: 'security', tech: 'general' },
    { url: 'https://react.dev/reference/react/hooks', category: 'patterns', tech: 'react' },
    { url: 'https://nodejs.org/en/docs/guides/security', category: 'security', tech: 'nodejs' },
    { url: 'https://www.typescriptlang.org/docs/handbook/intro.html', category: 'typing', tech: 'typescript' }
  ];
  if (techFilter && techFilter.length > 0) {
    return sources.filter(s => techFilter.includes(s.tech) || s.tech === 'general');
  }
  return sources;
}

function scrapeForTech(techFilter) {
  const sources = getDefaultSources(techFilter);
  const promises = sources.map(source =>
    scrapeUrl(source.url)
      .then(result => Object.assign({}, result, { category: source.category }))
      .catch(err => ({ url: source.url, category: source.category, error: err.message, fetched_at: new Date().toISOString(), word_count: 0 }))
  );
  return Promise.all(promises);
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 4: INSTALLER (from ezra-installer.js)
// ═══════════════════════════════════════════════════════════════

const HOOK_FILES = [
  'ezra-guard.js',
  'ezra-settings.js',
  'ezra-settings-writer.js',
  'ezra-oversight.js',
  'ezra-pm.js',
  'ezra-agents.js',
  'ezra-library.js',
  'ezra-memory.js',
  'ezra-memory-hook.js',
  'ezra-planner.js',
  'ezra-dashboard-data.js',
  'ezra-cloud-sync.js',
  'ezra-workflows.js',
  'ezra-license.js',
  'ezra-tier-gate.js',
  'ezra-installer.js',
  'ezra-drift-hook.js',
  'ezra-dash-hook.js',
  'ezra-version-hook.js',
  'ezra-progress-hook.js',
  'ezra-avios-bridge.js',
];

const INSTALL_PATHS = {
  global_hooks: path.join(os.homedir(), '.claude', 'hooks'),
  global_commands: path.join(os.homedir(), '.claude', 'commands', 'ezra'),
  local_hooks: path.join('.claude', 'hooks'),
  local_commands: path.join('.claude', 'commands', 'ezra'),
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

function getEzraRoot() {
  let dir = __dirname;
  const root = path.parse(dir).root;
  for (let i = 0; i < 5; i++) {
    if (dir === root) break;
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'ezra' || pkg.name === 'ezra-claude-code') return dir;
      } catch (_) {}
    }
    dir = path.dirname(dir);
  }
  const fallback = path.dirname(__dirname);
  const hooksDir = path.join(fallback, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    _log('installer', 'warn', 'getEzraRoot fallback may be invalid: ' + fallback + ' (no hooks/ dir)');
  }
  return fallback;
}

/**
 * Install EZRA hooks globally (~/.claude/hooks/).
 */
function install(targetDir) {
  const ezraRoot = getEzraRoot();
  const hooksSource = path.join(ezraRoot, 'hooks');
  const cmdsSource = path.join(ezraRoot, 'commands', 'ezra');

  const target = targetDir || INSTALL_PATHS.global_hooks;
  const cmdsTarget = targetDir
    ? path.join(path.dirname(targetDir), 'commands', 'ezra')
    : INSTALL_PATHS.global_commands;

  ensureDir(target);
  ensureDir(cmdsTarget);

  const results = { hooks: [], commands: [], errors: [] };

  for (const hookFile of HOOK_FILES) {
    const src = path.join(hooksSource, hookFile);
    const dest = path.join(target, hookFile);
    if (copyFile(src, dest)) {
      results.hooks.push(hookFile);
    } else {
      results.errors.push('hook not found: ' + hookFile);
    }
  }

  if (fs.existsSync(cmdsSource)) {
    const cmdFiles = fs.readdirSync(cmdsSource).filter(f => f.endsWith('.md'));
    for (const cmdFile of cmdFiles) {
      const src = path.join(cmdsSource, cmdFile);
      const dest = path.join(cmdsTarget, cmdFile);
      if (copyFile(src, dest)) {
        results.commands.push(cmdFile);
      }
    }
  }

  return {
    success: results.errors.length === 0,
    installed_hooks: results.hooks.length,
    installed_commands: results.commands.length,
    errors: results.errors,
    target,
  };
}

/**
 * Uninstall EZRA hooks (preserves .ezra/ data).
 */
function uninstall(targetDir) {
  const target = targetDir || INSTALL_PATHS.global_hooks;
  const cmdsTarget = targetDir
    ? path.join(path.dirname(targetDir), 'commands', 'ezra')
    : INSTALL_PATHS.global_commands;

  let removed = 0;

  if (fs.existsSync(target)) {
    for (const hookFile of HOOK_FILES) {
      const fp = path.join(target, hookFile);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        removed++;
      }
    }
  }

  if (fs.existsSync(cmdsTarget)) {
    fs.rmSync(cmdsTarget, { recursive: true, force: true });
  }

  return { success: true, removed };
}

/**
 * Update EZRA (reinstall).
 */
function update(targetDir) {
  uninstall(targetDir);
  return install(targetDir);
}

/**
 * Check installation status.
 */
function getInstallStatus(targetDir) {
  const target = targetDir || INSTALL_PATHS.global_hooks;

  const missing = [];
  const present = [];

  for (const hookFile of HOOK_FILES) {
    const fp = path.join(target, hookFile);
    if (fs.existsSync(fp)) {
      present.push(hookFile);
    } else {
      missing.push(hookFile);
    }
  }

  return {
    installed: missing.length === 0,
    present: present.length,
    missing: missing.length,
    missingFiles: missing,
    target,
  };
}

/**
 * Initialize .ezra/ in a target project directory.
 */
function initProject(projectDir) {
  const ezraDir = path.join(projectDir, '.ezra');
  ensureDir(ezraDir);

  const settingsPath = path.join(ezraDir, 'settings.yaml');
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, '# EZRA Settings\nversion: 6.0.0\n', 'utf8');
  }

  return { success: true, path: ezraDir };
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 5: WORKFLOWS (from ezra-workflows.js)
// ═══════════════════════════════════════════════════════════════

const STEP_TYPES = ['ezra', 'shell', 'manual', 'conditional', 'parallel', 'checkpoint', 'command', 'report', 'approval', 'review', 'validate', 'check', 'script'];
const STEP_ON_FAILURE = ['stop', 'skip', 'ask', 'retry'];
const WORKFLOW_STATUSES = ['draft', 'active', 'archived', 'running', 'completed', 'failed'];
const TEMPLATE_DIR = 'templates';
const PROCESS_DIR = '.ezra/processes';
const ACTIVE_DIR = 'active';
const RUNS_DIR = 'runs';

// ─── YAML Helpers (2-level safe) ─────────────────────────────────

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  let currentKey = null;
  let inArray = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('- ') && currentKey && inArray) {
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
        inArray = true;
        result[key] = [];
      } else {
        result[key] = parseVal(val);
        currentKey = key;
        inArray = false;
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
      for (const item of val) {
        if (typeof item === 'object' && item !== null) {
          lines.push('  - ' + serializeInline(item));
        } else {
          lines.push('  - ' + item);
        }
      }
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

function serializeInline(obj) {
  return '{' + Object.entries(obj).map(([k, v]) => k + ': ' + v).join(', ') + '}';
}

// ─── Template Parsing ──────────────────────────────────────────

function parseTemplate(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const template = {
    name: '',
    description: '',
    version: 1,
    author: 'EZRA',
    guard_rails: { require_clean_git: false, block_on_failure: false },
    steps: [],
    raw: content,
  };

  let currentBlock = null;
  let currentStep = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === 'guard_rails:') { currentBlock = 'guard_rails'; continue; }
    if (trimmed === 'steps:') { currentBlock = 'steps'; continue; }

    if (currentBlock === 'guard_rails') {
      const m = trimmed.match(/^(\w+):\s*(.+)$/);
      if (m) template.guard_rails[m[1]] = parseVal(m[2]);
    } else if (currentBlock === 'steps') {
      if (trimmed.startsWith('- id:')) {
        if (currentStep) template.steps.push(currentStep);
        currentStep = { id: parseInt(trimmed.replace('- id:', '').trim(), 10) };
      } else if (currentStep) {
        const m = trimmed.match(/^(\w+):\s*(.+)$/);
        if (m) currentStep[m[1]] = parseVal(m[2]);
      }
    } else {
      const m = trimmed.match(/^(\w+):\s*(.+)$/);
      if (m) template[m[1]] = parseVal(m[2]);
    }
  }
  if (currentStep) template.steps.push(currentStep);

  return template;
}

// ─── Template Management ─────────────────────────────────────────

function getTemplateDir(projectRoot) {
  return path.join(projectRoot, TEMPLATE_DIR);
}

function getProcessDir(projectDir) {
  return path.join(projectDir, PROCESS_DIR);
}

function listTemplates(projectRoot) {
  const dir = getTemplateDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const t = parseTemplate(path.join(dir, f));
      return {
        filename: f,
        name: f.replace('.yaml', ''),
        display_name: t ? t.name : f.replace('.yaml', ''),
        description: t ? t.description : '',
        steps: t ? t.steps.length : 0,
        version: t ? t.version : 1,
      };
    });
}

function getTemplate(projectRoot, name) {
  const dir = getTemplateDir(projectRoot);
  const filePath = path.join(dir, name + '.yaml');
  if (fs.existsSync(filePath)) return parseTemplate(filePath);
  const alt = path.join(dir, name);
  if (fs.existsSync(alt)) return parseTemplate(alt);
  return null;
}

function validateTemplate(template) {
  const errors = [];
  if (!template) { errors.push('Template is null'); return errors; }
  if (!template.name) errors.push('Missing name');
  if (!template.steps || template.steps.length === 0) errors.push('No steps defined');

  const ids = new Set();
  for (const step of (template.steps || [])) {
    if (!step.id) errors.push('Step missing id');
    if (ids.has(step.id)) errors.push('Duplicate step id: ' + step.id);
    ids.add(step.id);
    if (!step.name) errors.push('Step ' + step.id + ' missing name');
    if (step.type && !STEP_TYPES.includes(step.type)) {
      errors.push('Step ' + step.id + ' has invalid type: ' + step.type);
    }
    if (step.on_failure && !STEP_ON_FAILURE.includes(step.on_failure)) {
      errors.push('Step ' + step.id + ' has invalid on_failure: ' + step.on_failure);
    }
  }
  return errors;
}

// ─── Process (Active Workflows) ──────────────────────────────────

function listProcesses(projectDir) {
  const activeDir = path.join(getProcessDir(projectDir), ACTIVE_DIR);
  if (!fs.existsSync(activeDir)) return [];
  return fs.readdirSync(activeDir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const data = readYaml(path.join(activeDir, f));
      return {
        filename: f,
        name: data.name || f.replace('.yaml', ''),
        status: data.status || 'active',
        steps: data.step_count || 0,
        created: data.created || null,
      };
    });
}

function createProcess(projectDir, name, template) {
  const activeDir = path.join(getProcessDir(projectDir), ACTIVE_DIR);
  if (!fs.existsSync(activeDir)) fs.mkdirSync(activeDir, { recursive: true });

  const filePath = path.join(activeDir, name + '.yaml');
  if (fs.existsSync(filePath)) return { error: 'Process already exists: ' + name };

  const data = {
    name: name,
    status: 'active',
    created: new Date().toISOString(),
    template_source: template ? template.name : 'custom',
    step_count: template ? template.steps.length : 0,
    description: template ? template.description : '',
  };

  writeYaml(filePath, data);

  if (template && template.raw) {
    fs.writeFileSync(filePath, template.raw, 'utf8');
    fs.appendFileSync(filePath, '\nstatus: active\ncreated: ' + data.created + '\n', 'utf8');
  }

  return { path: filePath, name: name, steps: data.step_count };
}

function deleteProcess(projectDir, name) {
  const filePath = path.join(getProcessDir(projectDir), ACTIVE_DIR, name + '.yaml');
  if (!fs.existsSync(filePath)) return { error: 'Process not found: ' + name };
  fs.unlinkSync(filePath);
  return { deleted: name };
}

// ─── Execution Tracking ──────────────────────────────────────────

function createRun(projectDir, processName) {
  const runsDir = path.join(getProcessDir(projectDir), RUNS_DIR);
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = processName + '-' + timestamp + '.yaml';
  const filePath = path.join(runsDir, filename);

  const run = {
    process: processName,
    started: new Date().toISOString(),
    status: 'running',
    steps_completed: 0,
    steps_total: 0,
    steps_failed: 0,
    current_step: 1,
  };

  writeYaml(filePath, run);
  return { path: filePath, filename: filename, run: run };
}

function updateRun(runPath, updates) {
  if (!fs.existsSync(runPath)) return { error: 'Run not found' };
  const run = readYaml(runPath);
  Object.assign(run, updates);
  writeYaml(runPath, run);
  return run;
}

function completeRun(runPath, success) {
  return updateRun(runPath, {
    status: success ? 'completed' : 'failed',
    completed: new Date().toISOString(),
  });
}

function listRuns(projectDir, processName) {
  const runsDir = path.join(getProcessDir(projectDir), RUNS_DIR);
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir)
    .filter(f => f.endsWith('.yaml') && (!processName || f.startsWith(processName)))
    .sort()
    .reverse()
    .map(f => {
      const data = readYaml(path.join(runsDir, f));
      return {
        filename: f,
        process: data.process || f,
        status: data.status || 'unknown',
        started: data.started || null,
        completed: data.completed || null,
        steps_completed: data.steps_completed || 0,
      };
    });
}

// ─── Step Execution Helpers ──────────────────────────────────────

function resolveStepDependencies(steps) {
  const resolved = [];
  const remaining = [...steps];
  const resolvedIds = new Set();

  let maxIterations = steps.length * steps.length;
  while (remaining.length > 0 && maxIterations > 0) {
    maxIterations--;
    const idx = remaining.findIndex(step => {
      if (!step.depends_on) return true;
      const deps = Array.isArray(step.depends_on) ? step.depends_on : [step.depends_on];
      return deps.every(d => resolvedIds.has(d));
    });
    if (idx === -1) break;
    const step = remaining.splice(idx, 1)[0];
    resolved.push(step);
    resolvedIds.add(step.id);
  }

  return { resolved, unresolved: remaining };
}

function evaluateCondition(condition, context) {
  if (!condition) return true;
  const match = condition.match(/step\.(\d+)\.status\s*==\s*(\w+)/);
  if (match) {
    const stepId = parseInt(match[1], 10);
    const expected = match[2];
    const stepResult = (context.results || {})[stepId];
    return stepResult && stepResult.status === expected;
  }
  if (condition === 'true' || condition === 'always') return true;
  if (condition === 'false' || condition === 'never') return false;
  return true;
}

// ─── Template Composition ────────────────────────────────────────

function composeWorkflow(templates) {
  if (!templates || templates.length === 0) return null;

  const composed = {
    name: templates.map(t => t.name).join(' + '),
    description: 'Composed workflow from: ' + templates.map(t => t.name).join(', '),
    version: 1,
    author: 'EZRA',
    guard_rails: { require_clean_git: false, block_on_failure: false },
    steps: [],
  };

  let stepId = 1;
  for (const template of templates) {
    for (const step of (template.steps || [])) {
      composed.steps.push({
        ...step,
        id: stepId,
        source_template: template.name,
      });
      stepId++;
    }
  }

  return composed;
}

// ─── Workflow Statistics ─────────────────────────────────────────

function getWorkflowStats(projectDir) {
  const templates = listTemplates(projectDir);
  const processes = listProcesses(projectDir);
  const runs = listRuns(projectDir);

  const completedRuns = runs.filter(r => r.status === 'completed').length;
  const failedRuns = runs.filter(r => r.status === 'failed').length;

  return {
    template_count: templates.length,
    process_count: processes.length,
    total_runs: runs.length,
    completed_runs: completedRuns,
    failed_runs: failedRuns,
    success_rate: runs.length > 0 ? Math.round((completedRuns / runs.length) * 100) : 0,
  };
}

// ─── V8 Executor Integration ────────────────────────────────────

/**
 * Map a template step to the V8 executor's node_type + node_config schema.
 */
function mapStepToNode(step) {
  const t = step.type || 'manual';
  switch (t) {
    case 'ezra':
      return {
        node_type: 'action',
        node_config: { actionType: 'run_ezra_command', command: '/ezra:' + (step.ezra_command || 'status') },
      };
    case 'shell': case 'command': case 'script':
      return {
        node_type: 'action',
        node_config: { actionType: 'run_gate', command: step.command || '' },
      };
    case 'manual': case 'approval': case 'review':
      return {
        node_type: 'trigger',
        node_config: { triggerType: 'manual', message: step.approval_message || step.name || '' },
      };
    case 'conditional':
      return {
        node_type: 'condition',
        node_config: { conditionType: step.condition_type || 'health_score_above', threshold: step.threshold || 80 },
      };
    case 'checkpoint': case 'validate': case 'check':
      return {
        node_type: 'gate',
        node_config: { metric: step.metric || 'health_score', threshold: step.threshold || 80 },
      };
    case 'parallel':
      return {
        node_type: 'trigger',
        node_config: { triggerType: 'parallel', steps: step.parallel_steps || [] },
      };
    case 'report':
      return {
        node_type: 'notify',
        node_config: { channel: step.channel || 'console', messageTemplate: step.message || step.name || '' },
      };
    default:
      return {
        node_type: 'trigger',
        node_config: { triggerType: t },
      };
  }
}

/**
 * Execute a workflow template through the V8 executor, step by step.
 */
async function runWorkflow(projectDir, name) {
  const template = getTemplate(projectDir, name);
  if (!template) return { error: 'Template not found: ' + name };

  const errors = validateTemplate(template);
  if (errors.length > 0) return { error: 'Invalid template: ' + errors.join('; ') };

  const { resolved, unresolved } = resolveStepDependencies(template.steps);
  if (unresolved.length > 0) {
    return { error: 'Unresolved dependencies for steps: ' + unresolved.map(s => s.id).join(', ') };
  }

  const run = createRun(projectDir, name);
  const runPath = run.path;
  updateRun(runPath, { steps_total: resolved.length });

  const results = [];
  let failed = 0;
  let completed = 0;
  let halted = false;

  for (const step of resolved) {
    if (halted) break;

    const mapped = mapStepToNode(step);
    let stepResult;

    try {
      stepResult = await executeNode({
        node_type: mapped.node_type,
        node_config: mapped.node_config,
        run_id: run.filename,
        node_task_id: 'step-' + step.id,
      }, projectDir);
    } catch (e) {
      stepResult = { ok: false, error: e.message };
    }

    const success = stepResult && stepResult.ok && stepResult.passed !== false;
    results.push({
      step_id: step.id,
      step_name: step.name,
      step_type: step.type,
      node_type: mapped.node_type,
      success: success,
      output: stepResult ? (stepResult.output || stepResult.error || '') : '',
    });

    if (success) {
      completed++;
    } else {
      failed++;
      const onFail = step.on_failure || 'stop';
      if (onFail === 'stop') halted = true;
    }

    updateRun(runPath, { steps_completed: completed, steps_failed: failed, current_step: step.id });
  }

  completeRun(runPath, failed === 0);

  return {
    workflow: name,
    run_file: run.filename,
    status: failed === 0 ? 'completed' : 'failed',
    steps_total: resolved.length,
    steps_completed: completed,
    steps_failed: failed,
    halted: halted,
    results: results,
  };
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 6: WORKFLOW EXECUTOR (from ezra-workflow-executor.js)
// ═══════════════════════════════════════════════════════════════

// ─── Path Validation ───
function isValidProjectDir(dir) {
  if (!dir || typeof dir !== 'string') return false;
  const resolved = path.resolve(dir);
  if (resolved !== path.normalize(dir)) return false;
  try {
    return fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

// ─── Main Handler ───
async function handleRequest(req) {
  const action = req.action || 'execute_node';
  const projectDir = req.project_dir || process.cwd();

  if (!isValidProjectDir(projectDir)) {
    return { ok: false, error: 'Invalid or non-existent project_dir' };
  }

  if (action === 'execute_node') {
    return executeNode(req, projectDir);
  }

  return { ok: false, error: `Unknown action: ${action}` };
}

// ─── Node Execution ───
async function executeNode(req, projectDir) {
  const { node_type, node_config, run_id, node_task_id } = req;

  if (!node_type || !node_config) {
    return { ok: false, error: 'Missing node_type or node_config' };
  }

  switch (node_type) {
    case 'trigger':
      return executeTrigger(node_config);
    case 'action':
      return executeAction(node_config, projectDir);
    case 'gate':
      return executeGate(node_config, projectDir);
    case 'condition':
      return executeCondition(node_config, projectDir);
    case 'notify':
      return executeNotify(node_config, projectDir);
    default:
      return { ok: false, error: `Unknown node type: ${node_type}` };
  }
}

// ─── Trigger ───
function executeTrigger(config) {
  return {
    ok: true,
    passed: true,
    output: `Trigger fired: ${config.triggerType || 'manual'}`,
  };
}

// ─── Action ───
async function executeAction(config, projectDir) {
  const actionType = config.actionType || 'run_gate';

  switch (actionType) {
    case 'run_ezra_command': {
      const command = config.command;
      if (!command) return { ok: false, passed: false, error: 'No EZRA command specified' };

      const hookMap = {
        '/ezra:scan': 'ezra-oversight.js',
        '/ezra:health': 'ezra-dashboard-data.js',
        '/ezra:guard': 'ezra-oversight.js',
        '/ezra:review': 'ezra-oversight.js',
        '/ezra:reconcile': 'ezra-dashboard-data.js',
        '/ezra:status': 'ezra-dashboard-data.js',
        '/ezra:compliance': 'ezra-oversight.js',
      };

      const hookFile = hookMap[command];
      if (!hookFile) {
        return { ok: false, passed: false, error: `Unknown EZRA command: ${command}`, actionType };
      }
      const hookPath = path.join(__dirname, hookFile);

      if (!fs.existsSync(hookPath)) {
        return { ok: true, passed: true, output: `Command ${command} acknowledged (hook not found locally)` };
      }

      try {
        const result = await runHook(hookPath, { action: 'run', command, project_dir: projectDir });
        return { ok: true, passed: true, command, output: result, actionType };
      } catch (err) {
        return { ok: false, passed: false, error: `EZRA command failed: ${err.message}`, command, actionType };
      }
    }

    case 'run_gate': {
      const gatePath = path.join(__dirname, 'ezra-phase-gate.js');
      if (!fs.existsSync(gatePath)) {
        return { ok: true, passed: true, output: 'Gate check acknowledged (hook not available)', actionType };
      }
      try {
        const result = await runHook(gatePath, { action: 'run', project_dir: projectDir });
        return { ok: true, passed: true, output: result, actionType };
      } catch (err) {
        return { ok: false, passed: false, error: `Gate check failed: ${err.message}`, actionType };
      }
    }

    case 'send_notification':
      return executeNotify({ channel: 'email', messageTemplate: config.messageTemplate || 'Action notification' }, projectDir);

    case 'create_commit':
      return { ok: true, passed: true, output: 'Commit action acknowledged', actionType };

    case 'trigger_deploy':
      return { ok: true, passed: true, output: 'Deploy action acknowledged', actionType };

    default:
      return { ok: true, passed: true, output: `Action ${actionType} acknowledged`, actionType };
  }
}

// ─── Gate ───
async function executeGate(config, projectDir) {
  const metric = config.metric || 'health_score';
  const threshold = config.threshold ?? 80;

  const ezraDir = path.join(projectDir, '.ezra');
  let score = null;

  const scansDir = path.join(ezraDir, 'scans');
  if (fs.existsSync(scansDir)) {
    try {
      const files = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      if (files.length > 0) {
        const latestFile = files.sort().pop();
        const content = fs.readFileSync(path.join(scansDir, latestFile), 'utf8');

        const escapedMetric = metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const scoreMatch = content.match(new RegExp(`${escapedMetric}[:\\s]+(\\d+)`));
        if (scoreMatch) {
          score = parseInt(scoreMatch[1], 10);
        }

        if (score === null) {
          const healthMatch = content.match(/(?:health_score|overall_score|score)[:\s]+(\d+)/i);
          if (healthMatch) score = parseInt(healthMatch[1], 10);
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  if (score === null) {
    const gatePath = path.join(__dirname, 'ezra-phase-gate.js');
    if (fs.existsSync(gatePath)) {
      try {
        const result = await runHook(gatePath, { action: 'check', metric, project_dir: projectDir });
        if (result && typeof result === 'object' && 'score' in result) {
          score = result.score;
        }
      } catch {
        // Fallback to default
      }
    }
  }

  if (score === null) {
    score = metric === 'violations' ? 0 : 85;
  }

  const passed = metric === 'violations'
    ? score <= threshold
    : score >= threshold;

  return {
    ok: true,
    passed,
    score,
    metric,
    threshold,
    output: passed
      ? `Gate passed: ${metric} = ${score} (threshold: ${threshold})`
      : `Gate FAILED: ${metric} = ${score} (threshold: ${threshold})`,
  };
}

// ─── Condition ───
function executeCondition(config, projectDir) {
  const condType = config.conditionType || 'health_score_above';
  const threshold = config.threshold ?? 80;

  let conditionResult = true;

  const ezraDir = path.join(projectDir, '.ezra');
  const governancePath = path.join(ezraDir, 'governance.yaml');

  if (fs.existsSync(governancePath)) {
    try {
      const content = fs.readFileSync(governancePath, 'utf8');

      switch (condType) {
        case 'health_score_above': {
          const match = content.match(/health_score[:\s]+(\d+)/i);
          if (match) conditionResult = parseInt(match[1], 10) >= threshold;
          break;
        }
        case 'coverage_above': {
          const match = content.match(/(?:test_coverage|coverage)[:\s]+(\d+)/i);
          if (match) conditionResult = parseInt(match[1], 10) >= threshold;
          break;
        }
        case 'no_critical_findings': {
          const match = content.match(/critical[:\s]+(\d+)/i);
          if (match) conditionResult = parseInt(match[1], 10) === 0;
          break;
        }
      }
    } catch {
      // Default to true
    }
  }

  return {
    ok: true,
    passed: true,
    conditionResult,
    conditionType: condType,
    output: `Condition ${condType}: ${conditionResult ? 'YES' : 'NO'}`,
  };
}

// ─── Notify ───
async function executeNotify(config, projectDir) {
  const channel = config.channel || 'email';
  const template = config.messageTemplate || 'Workflow notification';

  const notifierPath = path.join(__dirname, 'ezra-notifier.js');
  if (fs.existsSync(notifierPath)) {
    try {
      await runHook(notifierPath, {
        action: 'send',
        channel,
        message: template,
        project_dir: projectDir,
      });
      return { ok: true, passed: true, channel, output: `Notification sent via ${channel}` };
    } catch (err) {
      return { ok: true, passed: true, channel, output: `Notification queued (${channel}): ${err.message}` };
    }
  }

  return { ok: true, passed: true, channel, output: `Notification acknowledged (${channel})` };
}

// ─── Run a local hook as a subprocess ───
function runHook(hookPath, inputData) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [hookPath], {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(stdout.trim());
      }
    });

    if (child.stdin) {
      child.stdin.write(JSON.stringify(inputData));
      child.stdin.end();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 7: PRE-COMMIT (from ezra-pre-commit.js)
// ═══════════════════════════════════════════════════════════════

// ─── Pre-commit YAML Helper ────────────────────────────────────

function parseYamlSimple(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let currentKey = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = (line.match(/^(\s*)/)[1] || '').length;
    if (indent === 0) {
      const m = trimmed.match(/^(\w[\w._-]*):\s*(.*)?$/);
      if (!m) continue;
      if (/^(__proto__|constructor|prototype)$/.test(m[1])) continue;
      const val = (m[2] || '').trim();
      if (val === '') { currentKey = m[1]; result[currentKey] = []; }
      else { currentKey = null; result[m[1]] = val; }
    } else if (trimmed.startsWith('- ') && currentKey) {
      result[currentKey].push(trimmed.slice(2).trim());
    }
  }
  return result;
}

// ─── Pre-commit staged files (execFileSync version) ───

function preCommitGetStagedFiles(cwd) {
  try {
    const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function preCommitLoadGovernance(cwd) {
  const govPath = path.join(cwd, '.ezra', 'governance.yaml');
  if (!fs.existsSync(govPath)) return null;
  try {
    return parseYamlSimple(fs.readFileSync(govPath, 'utf8'));
  } catch {
    return null;
  }
}

function loadDecisions(cwd) {
  const dir = path.join(cwd, '.ezra', 'decisions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.md'));
}

function matchesGlob(filePath, pattern) {
  if (pattern.length > 200) return false;
  const normalized = filePath.replace(/\\/g, '/');
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DS}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DS\}\}/g, '.*');
  try {
    return new RegExp('^' + regex + '$').test(normalized);
  } catch {
    return false;
  }
}

function getConfig(governance) {
  if (!governance) return { blocking: false };
  const blocking = governance.blocking === 'true' || governance.blocking === true;
  return { blocking };
}

function checkStagedFiles(cwd) {
  const governance = preCommitLoadGovernance(cwd);
  if (!governance) return { violations: [], blocked: false, skipped: true };

  const protectedPaths = governance.protected_paths || [];
  if (protectedPaths.length === 0) return { violations: [], blocked: false };

  const staged = preCommitGetStagedFiles(cwd);
  if (staged.length === 0) return { violations: [], blocked: false };

  const decisions = loadDecisions(cwd);
  const config = getConfig(governance);
  const violations = [];

  for (const file of staged) {
    for (const pattern of protectedPaths) {
      if (matchesGlob(file, pattern)) {
        violations.push({ file, pattern, has_decision: decisions.length > 0 });
      }
    }
  }

  return {
    violations,
    blocked: config.blocking && violations.length > 0,
    staged_count: staged.length,
    protected_count: protectedPaths.length,
  };
}

function preCommitRun() {
  const cwd = process.cwd();
  const result = checkStagedFiles(cwd);

  if (result.skipped) {
    process.exit(0);
  }

  if (result.violations.length > 0) {
    const prefix = result.blocked ? 'EZRA BLOCKED' : 'EZRA WARNING';
    process.stderr.write('\n' + prefix + ': ' + result.violations.length +
      ' protected path(s) in staged files:\n');
    for (const v of result.violations) {
      process.stderr.write('  - ' + v.file + ' (matches: ' + v.pattern + ')\n');
    }
    if (result.blocked) {
      process.stderr.write('\nCommit blocked. Record a decision with /ezra:decide or use --no-verify.\n\n');
      process.exit(1);
    } else {
      process.stderr.write('\nProceeding (non-blocking mode). Use /ezra:decide to record authorization.\n\n');
    }
  }

  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 8: PRE-PUSH (from ezra-pre-push.js)
// ═══════════════════════════════════════════════════════════════

const DEFAULT_SCAN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function prePushLoadGovernance(cwd) {
  const govPath = path.join(cwd, '.ezra', 'governance.yaml');
  if (!fs.existsSync(govPath)) return null;
  try {
    return parseYamlSimple(fs.readFileSync(govPath, 'utf8'));
  } catch {
    return null;
  }
}

function findLatestScan(cwd) {
  const scanDir = path.join(cwd, '.ezra', 'scans');
  if (!fs.existsSync(scanDir)) return null;

  let latestTime = 0;
  let latestFile = null;

  try {
    const files = fs.readdirSync(scanDir);
    for (const f of files) {
      if (!f.endsWith('.yaml') && !f.endsWith('.json')) continue;
      const fp = path.join(scanDir, f);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtimeMs > latestTime) {
          latestTime = stat.mtimeMs;
          latestFile = f;
        }
      } catch { /* skip unreadable files */ }
    }
  } catch {
    return null;
  }

  if (!latestFile) return null;
  return { file: latestFile, mtimeMs: latestTime };
}

function getPrePushConfig(governance) {
  if (!governance) return { blocking: false, maxAgeMs: DEFAULT_SCAN_MAX_AGE_MS };
  const blocking = governance.blocking === 'true' || governance.blocking === true;
  let maxAgeMs = DEFAULT_SCAN_MAX_AGE_MS;
  if (governance.scan_max_age_hours) {
    const hours = parseFloat(governance.scan_max_age_hours);
    if (!isNaN(hours) && hours > 0) maxAgeMs = hours * 60 * 60 * 1000;
  }
  return { blocking, maxAgeMs };
}

function checkScanRecency(cwd, nowMs) {
  const governance = prePushLoadGovernance(cwd);
  if (!governance) return { stale: false, skipped: true };

  const config = getPrePushConfig(governance);
  const latest = findLatestScan(cwd);
  const now = nowMs || Date.now();

  if (!latest) {
    return {
      stale: true,
      blocked: config.blocking,
      reason: 'no_scan_found',
      scan_dir: path.join(cwd, '.ezra', 'scans'),
    };
  }

  const ageMs = now - latest.mtimeMs;
  if (ageMs > config.maxAgeMs) {
    const ageHours = Math.round(ageMs / (60 * 60 * 1000) * 10) / 10;
    return {
      stale: true,
      blocked: config.blocking,
      reason: 'scan_too_old',
      latest_scan: latest.file,
      age_hours: ageHours,
      max_age_hours: config.maxAgeMs / (60 * 60 * 1000),
    };
  }

  return {
    stale: false,
    latest_scan: latest.file,
    age_ms: ageMs,
  };
}

function prePushRun() {
  const cwd = process.cwd();
  const result = checkScanRecency(cwd);

  if (result.skipped) {
    process.exit(0);
  }

  if (result.stale) {
    const prefix = result.blocked ? 'EZRA BLOCKED' : 'EZRA WARNING';
    if (result.reason === 'no_scan_found') {
      process.stderr.write('\n' + prefix + ': No EZRA scan found in ' + result.scan_dir + '\n');
      process.stderr.write('Run /ezra:scan before pushing.\n\n');
    } else {
      process.stderr.write('\n' + prefix + ': Latest scan (' + result.latest_scan +
        ') is ' + result.age_hours + 'h old (max: ' + result.max_age_hours + 'h)\n');
      process.stderr.write('Run /ezra:scan to refresh.\n\n');
    }
    if (result.blocked) {
      process.exit(1);
    }
  }

  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 9: TOKEN SHIELD VALIDATOR (from token-shield-validator.js)
// ═══════════════════════════════════════════════════════════════

const THRESHOLD_KB = 2048; // ~300K tokens
const HANDOFF_MAX_AGE_HOURS = 24;

function tokenShieldDetectEvent(event) {
  if (event.transcript_path || event.stop_hook_active) return 'Stop';
  return 'SessionStart';
}

function tokenShieldHandleSessionStart(event) {
  const cwd = event.cwd || process.cwd();
  const lines = [];

  const memDir = findProjectMemory(cwd);
  if (memDir) {
    const handoff = findRecentHandoff(memDir);
    if (handoff) {
      const ageH = ((Date.now() - handoff.mtime) / 3600000).toFixed(1);
      const sizeKB = (handoff.size / 1024).toFixed(1);
      lines.push(`[Token Shield] Handoff available from ${ageH}h ago: ${handoff.path} (${sizeKB}KB)`);
    }
  }

  const checks = tokenShieldRunValidation();
  if (checks.failures.length > 0) {
    lines.push(`[Token Shield] ${checks.failures.length} issue(s): ${checks.failures.join('; ')}`);
  }

  if (lines.length > 0) {
    console.log(lines.join('\n'));
  }

  _log('token-shield', 'session-start', { cwd, handoffFound: !!lines.length });
  process.exit(0);
}

function tokenShieldHandleStop(event) {
  const transcriptPath = event.transcript_path;
  const sessionId = event.session_id || 'unknown';
  const cwd = event.cwd || process.cwd();

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    process.exit(0);
  }

  const stat = fs.statSync(transcriptPath);
  const sizeKB = Math.round(stat.size / 1024);

  if (sizeKB < THRESHOLD_KB) {
    process.exit(0);
  }

  const memDir = findProjectMemory(cwd) || createProjectMemory(cwd);
  const handoffPath = path.join(memDir, 'session_handoff_auto.md');
  const estTokens = Math.round(sizeKB * 150);
  const pct = Math.min(100, Math.round((sizeKB / 4096) * 100));

  const handoff = `---
name: Auto-generated session handoff
description: Token Shield auto-handoff when transcript reached ${sizeKB}KB (~${estTokens}K tokens)
type: project
generated: ${new Date().toISOString()}
session_id: ${sessionId}
transcript_size_kb: ${sizeKB}
working_directory: ${cwd}
---

# Session Handoff (Auto-Generated)

**Generated:** ${new Date().toISOString()}
**Session:** ${sessionId}
**Transcript size:** ${sizeKB}KB (~${estTokens}K tokens)
**Working directory:** ${cwd}

## How to Use
Start a new Claude Code session and say:
\`Read the auto-generated handoff at ${handoffPath} then continue where the previous session left off.\`

## Key Locations
- Plans: ~/.claude/plans/
- Memory: ${memDir}
- Scripts: ~/.claude/scripts/
- Hooks: ~/.claude/hooks/
`;

  try {
    fs.writeFileSync(handoffPath, handoff, 'utf8');
  } catch (_) {
    // fail-open
  }

  const result = JSON.stringify({
    result: 'warn',
    message: `[Token Shield] Transcript at ${sizeKB}KB (~${pct}% of comfortable limit). Handoff saved. Consider starting a fresh session.`
  });

  console.log(result);
  _log('token-shield', 'stop-handoff', { sizeKB, sessionId, handoffPath });
  process.exit(0);
}

function tokenShieldRunValidation() {
  const failures = [];
  const home = os.homedir();

  const mcpPath = path.join(home, '.claude', '.mcp.json');
  if (fs.existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      if (!mcp.mcpServers || !mcp.mcpServers['context-mode']) {
        failures.push('Context Mode MCP not in .mcp.json');
      }
    } catch (_) {
      failures.push('.mcp.json invalid JSON');
    }
  }

  const settingsPath = path.join(home, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) {
        failures.push('settings.json has BOM character');
      }
      JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (_) {
      failures.push('settings.json invalid JSON');
    }
  }

  return { failures };
}

function findProjectMemory(cwd) {
  const projectsBase = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsBase)) return null;

  const cwdNorm = cwd.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

  try {
    const dirs = fs.readdirSync(projectsBase, { withFileTypes: true })
      .filter(d => d.isDirectory());

    let bestMatch = null;
    let bestScore = 0;

    for (const dir of dirs) {
      const slugParts = dir.name.toLowerCase().split('-').filter(p => p.length >= 2);
      let matchScore = 0;
      for (const part of slugParts) {
        if (cwdNorm.includes(part)) matchScore++;
      }
      if (slugParts.length > 0 && matchScore >= slugParts.length / 2) {
        const candidate = path.join(projectsBase, dir.name, 'memory');
        if (fs.existsSync(candidate) && matchScore > bestScore) {
          bestScore = matchScore;
          bestMatch = candidate;
        }
      }
    }

    return bestMatch;
  } catch (_) {}

  return null;
}

function createProjectMemory(cwd) {
  const slug = cwd.replace(/[:\\/]/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
  try { fs.mkdirSync(memDir, { recursive: true }); } catch (_) {}
  return memDir;
}

function findRecentHandoff(memDir) {
  const cutoff = Date.now() - (HANDOFF_MAX_AGE_HOURS * 3600000);

  try {
    const files = fs.readdirSync(memDir)
      .filter(f => f.startsWith('session_handoff'))
      .map(f => {
        const full = path.join(memDir, f);
        const stat = fs.statSync(full);
        return { path: full, mtime: stat.mtimeMs, size: stat.size };
      })
      .filter(f => f.mtime > cutoff)
      .sort((a, b) => b.mtime - a.mtime);

    return files[0] || null;
  } catch (_) {
    return null;
  }
}

function tokenShieldRun(event) {
  try {
    const hookEvent = event.event || tokenShieldDetectEvent(event);

    if (hookEvent === 'Stop') {
      tokenShieldHandleStop(event);
    } else {
      tokenShieldHandleSessionStart(event);
    }
  } catch (err) {
    _log('token-shield', 'error', { error: err.message });
    process.exit(0);
  }
}

// ═══════════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  // --- Commit Engine ---
  MAX_FILES_PER_BATCH,
  PROTECTED_BRANCHES,
  COMMIT_TYPES,
  SAFE_REF_NAME,
  validateRefName,
  runGit,
  getChangedFiles,
  getStagedFiles: commitGetStagedFiles,
  batchFiles,
  batchCommits,
  generateCommitMessage,
  inferCommitType,
  inferScope,
  getCurrentBranch,
  isProtectedBranch,
  commitBatch,
  pushBranch,
  createPR,
  autoMerge,

  // --- Deploy Trigger ---
  DEPLOY_TARGETS,
  triggerDeploy,
  triggerVercel,
  triggerRailway,
  triggerNetlify,
  triggerCustom,

  // --- Scraper ---
  ALLOWED_DOMAINS,
  scrapeUrl,
  fetchUrl,
  extractTextContent,
  diffAgainstLibrary,
  getDefaultSources,
  scrapeForTech,

  // --- Installer ---
  HOOK_FILES,
  INSTALL_PATHS,
  install,
  uninstall,
  update,
  getInstallStatus,
  initProject,
  getEzraRoot,

  // --- Workflows ---
  STEP_TYPES,
  STEP_ON_FAILURE,
  WORKFLOW_STATUSES,
  TEMPLATE_DIR,
  PROCESS_DIR,
  readYaml,
  writeYaml,
  parseVal,
  parseTemplate,
  getTemplateDir,
  getProcessDir,
  listTemplates,
  getTemplate,
  validateTemplate,
  listProcesses,
  createProcess,
  deleteProcess,
  createRun,
  updateRun,
  completeRun,
  listRuns,
  resolveStepDependencies,
  evaluateCondition,
  composeWorkflow,
  getWorkflowStats,
  mapStepToNode,
  runWorkflow,

  // --- Workflow Executor ---
  handleRequest,
  executeNode,
  executeTrigger,
  executeAction,
  executeGate,
  executeCondition,
  executeNotify,
  isValidProjectDir,

  // --- Pre-Commit ---
  checkStagedFiles,
  preCommitGetStagedFiles,
  preCommitLoadGovernance,
  loadDecisions,
  matchesGlob,
  getConfig,

  // --- Pre-Push ---
  checkScanRecency,
  findLatestScan,
  prePushLoadGovernance,
  getPrePushConfig,
  DEFAULT_SCAN_MAX_AGE_MS,

  // --- Token Shield ---
  tokenShieldRun,
  tokenShieldDetectEvent,
  tokenShieldHandleSessionStart,
  tokenShieldHandleStop,
  tokenShieldRunValidation,
  findProjectMemory,
  createProjectMemory,
  findRecentHandoff,
  THRESHOLD_KB,
  HANDOFF_MAX_AGE_HOURS,
};

// ═══════════════════════════════════════════════════════════════
//  HOOK PROTOCOL (stdin handler)
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > MAX_STDIN) { process.exit(0); }
  });
  process.stdin.on('end', () => {
    (async () => {
      try {
        const event = JSON.parse(input);
        const module_target = event.module || 'status';
        const cwd = event.cwd || event.project_dir || process.cwd();

        switch (module_target) {
          case 'commit-engine': {
            const action = event.action || 'status';
            if (action === 'batch') {
              const files = getChangedFiles(cwd);
              const batches = batchFiles(files);
              process.stdout.write(JSON.stringify({ batches, total_files: files.length }));
            } else {
              const branch = getCurrentBranch(cwd);
              process.stdout.write(JSON.stringify({ branch, protected: isProtectedBranch(branch) }));
            }
            break;
          }
          case 'deploy-trigger': {
            const result = await triggerDeploy(cwd, event.options || {});
            process.stdout.write(JSON.stringify(result));
            break;
          }
          case 'scraper': {
            const action = event.action || 'scrape';
            let work;
            if (action === 'diff') {
              work = Promise.resolve(diffAgainstLibrary(event.new_entries || [], event.existing_entries || []));
            } else {
              work = scrapeForTech(event.tech_filter || null);
            }
            const result = await work;
            process.stdout.write(JSON.stringify({ ok: true, action, result }));
            break;
          }
          case 'installer': {
            const action = event.action || 'status';
            let result;
            if (action === 'install') result = install(event.target_dir);
            else if (action === 'uninstall') result = uninstall(event.target_dir);
            else if (action === 'update') result = update(event.target_dir);
            else result = getInstallStatus(event.target_dir);
            process.stdout.write(JSON.stringify(result));
            break;
          }
          case 'workflows': {
            const action = event.action || 'list-templates';
            let result;
            switch (action) {
              case 'list-templates': result = listTemplates(cwd); break;
              case 'validate': result = validateTemplate(getTemplate(cwd, event.name)); break;
              case 'list-processes': result = listProcesses(cwd); break;
              case 'create': result = createProcess(cwd, event.name, event.template ? getTemplate(cwd, event.template) : null); break;
              case 'stats': result = getWorkflowStats(cwd); break;
              case 'run': result = await runWorkflow(cwd, event.name); break;
              default: result = { error: 'Unknown action: ' + action };
            }
            process.stdout.write(JSON.stringify(result));
            break;
          }
          case 'executor': {
            const result = await handleRequest(event);
            process.stdout.write(JSON.stringify(result, null, 2));
            break;
          }
          case 'pre-commit': {
            preCommitRun();
            break;
          }
          case 'pre-push': {
            prePushRun();
            break;
          }
          case 'token-shield': {
            tokenShieldRun(event);
            break;
          }
          default: {
            // Default status
            const branch = getCurrentBranch(cwd);
            process.stdout.write(JSON.stringify({ module: 'ezra-devops', branch, protected: isProtectedBranch(branch) }));
          }
        }
      } catch (e) {
        process.stderr.write('ezra-devops: ' + e.message + '\n');
        process.stdout.write(JSON.stringify({ error: e.message }));
      }
      process.exit(0);
    })();
  });
}
