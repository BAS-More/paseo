#!/usr/bin/env node
/**
 * lint-edited — Phase 2 T2.1
 *
 * Event:   PostToolUse
 * Matcher: Write|Edit|MultiEdit
 *
 * After every edit/write, run the project's lint command on the touched
 * file (or whole project if file-level lint not supported). Surfaces
 * findings to stdout so Claude sees them on the next turn.
 *
 * Detection order:
 *   1. package.json scripts: prefer `lint:fix`, then `lint`
 *   2. biome (biome.json[c]?) — `biome lint <file>`
 *   3. eslint flat config (eslint.config.*) — `eslint <file>`
 *   4. ruff (.py) — `ruff check <file>`
 *
 * Skips when no lint config is found. Cheap (1-3s); single-file scope.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SUPPORTED_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts', '.py']);
const ESLINT_CONFIG = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'];
const BIOME_CONFIG = ['biome.json', 'biome.jsonc'];
const TIMEOUT_MS = 10000; // file-level lint only; project-scope deferred to project scripts

let _log;
try { _log = require('./ezra-hook-logger').log; } catch { _log = () => {}; }

function readStdinSync() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function extractFilePath(input) {
  try {
    const p = JSON.parse(input || '{}');
    return p.tool_input?.file_path || p.tool_input?.path || p.tool_input?.filePath || '';
  } catch { return ''; }
}

function findUp(startDir, names) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    for (const n of names) {
      const c = path.join(dir, n);
      if (fs.existsSync(c)) return { dir, found: c };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findPackageJson(startFile) {
  return findUp(path.dirname(startFile), ['package.json']);
}

function readPkgScripts(pkgPath) {
  try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {}; }
  catch { return {}; }
}

function pickLintCmd(filePath) {
  const ext = path.extname(filePath);
  if (!SUPPORTED_EXT.has(ext)) return null;

  const startDir = path.dirname(filePath);

  // QAL-006: project-level npm script lint NOT used here on purpose —
  // it runs whole-repo lint on every Edit which is too slow (10s+ on big repos).
  // File-scoped tools below give actionable feedback in 1-3s.

  // 1) biome
  const biome = findUp(startDir, BIOME_CONFIG);
  if (biome) {
    return { cwd: biome.dir, file: 'npx', args: ['--no', '--', 'biome', 'lint', '--max-diagnostics=20', filePath] };
  }

  // 3) eslint
  const eslint = findUp(startDir, ESLINT_CONFIG);
  if (eslint) {
    return { cwd: eslint.dir, file: 'npx', args: ['--no', '--', 'eslint', '--max-warnings', '0', filePath] };
  }

  // 4) ruff (Python)
  if (ext === '.py') {
    const ruff = findUp(startDir, ['pyproject.toml', 'ruff.toml', '.ruff.toml']);
    if (ruff) return { cwd: ruff.dir, file: 'ruff', args: ['check', filePath] };
  }

  return null;
}

function main() {
  const filePath = extractFilePath(readStdinSync());
  if (!filePath) process.exit(0);
  const choice = pickLintCmd(filePath);
  if (!choice) process.exit(0);

  try {
    execFileSync(choice.file, choice.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
      cwd: choice.cwd,
      shell: false, // explicit — no shell interpretation of args
    });
    process.stdout.write(`[lint-edited] ✓ ${path.basename(filePath)} clean.\n`);
  } catch (err) {
    const out = (err.stdout?.toString() || err.stderr?.toString() || '').slice(0, 2500);
    process.stdout.write(
      `[lint-edited] ✗ lint findings in ${path.basename(filePath)}:\n${out}\n`
    );
    _log('lint-edited', 'findings', { file: filePath });
  }
  process.exit(0);
}

try { main(); } catch (err) {
  process.stderr.write(`[lint-edited] soft fail: ${err.message}\n`);
  process.exit(0);
}
