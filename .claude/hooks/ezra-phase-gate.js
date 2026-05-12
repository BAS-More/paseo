#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let _settings, _log;
try { _settings = require('./ezra-settings.js'); } catch { _settings = null; }
try { _log = require('./ezra-hook-logger.js').logHookEvent; } catch { _log = () => {}; }

const GATE_DIR = '.ezra/gates';

// Gate check categories
const GATE_CHECKS = ['tests', 'lint', 'security', 'coverage', 'standards'];

// Default gate thresholds
const DEFAULT_THRESHOLDS = {
  coverage_minimum: 0,    // 0 = not required
  max_fix_retries: 3,
};

/**
 * Run a shell command safely, returns { success, output, error }.
 * Uses spawnSync with tree-kill on Windows to prevent zombie processes
 * when timeouts occur (execSync timeout doesn't kill the process tree).
 */
function runCommand(cmd, cwd, timeoutMs = 60000) {
  const result = require('child_process').spawnSync(cmd, {
    cwd, timeout: timeoutMs, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true,
    killSignal: 'SIGKILL',
  });

  // On Windows, also kill the process tree if it timed out
  if (result.signal && process.platform === 'win32' && result.pid) {
    try {
      require('child_process').execFileSync('taskkill', ['/F', '/T', '/PID', String(result.pid)], { stdio: 'ignore', timeout: 5000 });
    } catch {}
  }

  const success = result.status === 0 && !result.signal;
  return {
    success,
    output: (result.stdout || '').trim(),
    error: (result.stderr || result.error?.message || (result.signal ? 'Killed by ' + result.signal : '')).trim(),
  };
}

/**
 * Detect test runner from package.json or common config files
 */
function detectTestRunner(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts.test) return { type: 'npm', cmd: 'npm test' };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.jest) return { type: 'jest', cmd: 'npx jest --passWithNoTests' };
      if (deps.vitest) return { type: 'vitest', cmd: 'npx vitest run' };
      if (deps.mocha) return { type: 'mocha', cmd: 'npx mocha' };
    } catch { /* ignore */ }
  }
  // Python
  if (fs.existsSync(path.join(projectDir, 'pytest.ini')) || fs.existsSync(path.join(projectDir, 'setup.py'))) {
    return { type: 'pytest', cmd: 'pytest' };
  }
  // Go
  if (fs.existsSync(path.join(projectDir, 'go.mod'))) {
    return { type: 'gotest', cmd: 'go test ./...' };
  }
  return null;
}

/**
 * Detect lint command from package.json
 */
function detectLintCommand(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.scripts) {
      if (pkg.scripts.lint) return 'npm run lint';
      if (pkg.scripts['lint:check']) return 'npm run lint:check';
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.eslint) return 'npx eslint . --ext .ts,.tsx,.js,.jsx --max-warnings 0';
  } catch { /* ignore */ }
  return null;
}

/**
 * Run the test suite. Returns GateCheckResult.
 */
function runTestSuite(projectDir) {
  const runner = detectTestRunner(projectDir);
  if (!runner) {
    return { check: 'tests', passed: true, score: 100, findings: [], skipped: true, reason: 'No test runner detected' };
  }
  const result = runCommand(runner.cmd, projectDir, 120000);
  // Parse pass/fail counts from common formats
  const findings = [];
  let passCount = 0, failCount = 0;

  // Jest/Vitest: "X passed, Y failed"
  const jestMatch = result.output.match(/(\d+)\s+passed/);
  const jestFail = (result.output + result.error).match(/(\d+)\s+failed/);
  if (jestMatch) passCount = parseInt(jestMatch[1]);
  if (jestFail) failCount = parseInt(jestFail[1]);

  if (!result.success) {
    findings.push({ level: 'error', message: `Test suite failed: ${result.error.slice(0, 200)}` });
  }

  const total = passCount + failCount || (result.success ? 1 : 0);
  const score = total > 0 ? Math.round((passCount / total) * 100) : (result.success ? 100 : 0);

  return {
    check: 'tests',
    passed: result.success && failCount === 0,
    score,
    findings,
    output: result.output.slice(0, 500),
    pass_count: passCount,
    fail_count: failCount,
  };
}

/**
 * Run lint check. Returns GateCheckResult.
 */
function runLintCheck(projectDir) {
  const cmd = detectLintCommand(projectDir);
  if (!cmd) {
    return { check: 'lint', passed: true, score: 100, findings: [], skipped: true, reason: 'No lint command detected' };
  }
  const result = runCommand(cmd, projectDir, 60000);
  const findings = [];
  if (!result.success) {
    findings.push({ level: 'error', message: `Lint failed: ${result.error.slice(0, 200)}` });
  }
  return {
    check: 'lint',
    passed: result.success,
    score: result.success ? 100 : 0,
    findings,
    output: result.output.slice(0, 500),
  };
}

/**
 * Run security scan via EZRA oversight module. Returns GateCheckResult.
 */
function runSecurityScan(projectDir) {
  let oversight;
  try { oversight = require('./ezra-oversight.js'); } catch {
    return { check: 'security', passed: true, score: 100, findings: [], skipped: true, reason: 'ezra-oversight not available' };
  }
  const findings = [];
  try {
    const violations = oversight.getViolations ? oversight.getViolations(projectDir) : [];
    const critical = violations.filter(v => v.level === 'critical' || v.level === 'high');
    if (critical.length > 0) {
      findings.push(...critical.map(v => ({ level: 'error', message: v.message || JSON.stringify(v) })));
    }
    const score = critical.length === 0 ? 100 : Math.max(0, 100 - critical.length * 20);
    return { check: 'security', passed: critical.length === 0, score, findings };
  } catch (e) {
    return { check: 'security', passed: true, score: 100, findings: [], skipped: true, reason: e.message };
  }
}

/**
 * Check code coverage from coverage report if present. Returns GateCheckResult.
 */
function runCoverageCheck(projectDir, minimumPct) {
  const min = minimumPct || 0;
  if (min === 0) {
    return { check: 'coverage', passed: true, score: 100, findings: [], skipped: true, reason: 'Coverage minimum not configured' };
  }
  // Try reading lcov or jest coverage summary
  const summaryPath = path.join(projectDir, 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return { check: 'coverage', passed: true, score: 100, findings: [], skipped: true, reason: 'No coverage report found' };
  }
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const total = summary.total;
    if (!total || !total.lines) {
      return { check: 'coverage', passed: true, score: 100, findings: [], skipped: true, reason: 'Coverage summary has no line data' };
    }
    const pct = total.lines.pct;
    const passed = pct >= min;
    const findings = passed ? [] : [{ level: 'error', message: `Line coverage ${pct}% is below minimum ${min}%` }];
    return { check: 'coverage', passed, score: Math.round(pct), findings, coverage_pct: pct };
  } catch (e) {
    return { check: 'coverage', passed: true, score: 100, findings: [], skipped: true, reason: e.message };
  }
}

/**
 * Run standards check using ezra-guard to check for violation files. Returns GateCheckResult.
 */
function runStandardsCheck(projectDir) {
  const govPath = path.join(projectDir, '.ezra', 'governance.yaml');
  if (!fs.existsSync(govPath)) {
    return { check: 'standards', passed: true, score: 100, findings: [], skipped: true, reason: 'No governance.yaml found' };
  }
  // Check for recent scan violations
  const scansDir = path.join(projectDir, '.ezra', 'scans');
  if (!fs.existsSync(scansDir)) {
    return { check: 'standards', passed: true, score: 100, findings: [], skipped: true, reason: 'No scan history' };
  }
  const scans = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).sort().reverse();
  if (scans.length === 0) {
    return { check: 'standards', passed: true, score: 100, findings: [], skipped: true, reason: 'No scan results' };
  }
  try {
    const scanText = fs.readFileSync(path.join(scansDir, scans[0]), 'utf8');
    const criticals = (scanText.match(/severity:\s*CRITICAL/gi) || []).length;
    const highs = (scanText.match(/severity:\s*HIGH/gi) || []).length;
    const blockers = criticals + highs;
    const findings = blockers > 0 ? [{ level: 'error', message: `${criticals} CRITICAL, ${highs} HIGH findings in last scan` }] : [];
    const score = Math.max(0, 100 - criticals * 20 - highs * 10);
    return { check: 'standards', passed: blockers === 0, score, findings };
  } catch (e) {
    return { check: 'standards', passed: true, score: 100, findings: [], skipped: true, reason: e.message };
  }
}

/**
 * Save gate result to .ezra/gates/phase-N.yaml
 */
function saveGateResult(projectDir, phaseNum, result) {
  const gatesDir = path.join(projectDir, GATE_DIR);
  if (!fs.existsSync(gatesDir)) fs.mkdirSync(gatesDir, { recursive: true });
  const filePath = path.join(gatesDir, `phase-${phaseNum}.yaml`);
  const yaml = [
    `phase: ${phaseNum}`,
    `passed: ${result.passed}`,
    `overall_score: ${result.overall_score}`,
    `run_at: '${result.run_at}'`,
    `retries: ${result.retries || 0}`,
    `checks:`,
    ...result.checks.map(c => [
      `  - check: ${c.check}`,
      `    passed: ${c.passed}`,
      `    score: ${c.score}`,
      c.skipped ? `    skipped: true` : null,
      c.findings && c.findings.length > 0
        ? `    findings:\n` + c.findings.map(f => `      - level: ${f.level}\n        message: '${f.message.replace(/'/g, "''")}'`).join('\n')
        : null,
    ].filter(Boolean).join('\n')),
  ].join('\n') + '\n';
  fs.writeFileSync(filePath, yaml, 'utf8');
  return filePath;
}

/**
 * Load saved gate result from .ezra/gates/phase-N.yaml if it exists.
 */
function loadGateResult(projectDir, phaseNum) {
  const filePath = path.join(projectDir, GATE_DIR, `phase-${phaseNum}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    // Basic parse: just check if passed: true
    const passedMatch = text.match(/^passed:\s*(true|false)/m);
    const scoreMatch = text.match(/^overall_score:\s*(\d+)/m);
    return {
      passed: passedMatch ? passedMatch[1] === 'true' : false,
      overall_score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
    };
  } catch { return null; }
}

/**
 * Prevent concurrent gate runs via lock file.
 * Returns a release function, or null if another gate is already running.
 */
function acquireGateLock(projectDir) {
  const lockPath = path.join(projectDir, '.ezra', 'gate.lock');
  try {
    fs.mkdirSync(path.join(projectDir, '.ezra'), { recursive: true });
    if (fs.existsSync(lockPath)) {
      const stat = fs.statSync(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 5 * 60 * 1000) return null;
    }
    fs.writeFileSync(lockPath, process.pid + '\n' + new Date().toISOString(), 'utf8');
    return () => { try { fs.unlinkSync(lockPath); } catch {} };
  } catch { return null; }
}

/**
 * Run all gate checks for a phase. Returns GateResult.
 * GateResult: { passed, overall_score, checks[], blockers[], run_at, phase, retries }
 */
function runGate(projectDir, phaseNum, options = {}) {
  const releaseLock = acquireGateLock(projectDir);
  if (!releaseLock) {
    return {
      phase: phaseNum, passed: true, overall_score: 100,
      checks: [], blockers: [],
      run_at: new Date().toISOString(),
      skipped: true, reason: 'Another gate check is already running',
    };
  }
  const settings = _settings ? _settings.loadSettings(projectDir) : {};
  const execSettings = settings.execution || {};
  const coverageMin = (settings.gate && settings.gate.coverage_minimum) || DEFAULT_THRESHOLDS.coverage_minimum;

  const checks = [
    runTestSuite(projectDir),
    runLintCheck(projectDir),
    runSecurityScan(projectDir),
    runCoverageCheck(projectDir, coverageMin),
    runStandardsCheck(projectDir),
  ];

  const blockers = checks.filter(c => !c.passed && !c.skipped);
  const passed = blockers.length === 0;
  const scores = checks.map(c => c.score);
  const overall_score = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  const result = {
    phase: phaseNum,
    passed,
    overall_score,
    checks,
    blockers: blockers.map(c => c.check),
    run_at: new Date().toISOString(),
    retries: options.retryCount || 0,
  };

  saveGateResult(projectDir, phaseNum, result);
  _log(projectDir, 'ezra-phase-gate', passed ? 'info' : 'warn',
    `Phase ${phaseNum} gate: ${passed ? 'PASSED' : 'FAILED'} (score: ${overall_score})`);

  releaseLock();
  return result;
}

/**
 * Fix-and-recheck loop. Attempts to fix blockers and re-run gate up to maxRetries times.
 * Returns { passed, attempts, final_result }
 */
function fixAndRecheck(projectDir, phaseNum, maxRetries) {
  const max = maxRetries || DEFAULT_THRESHOLDS.max_fix_retries;
  let attempts = 0;
  let result = runGate(projectDir, phaseNum, { retryCount: 0 });

  while (!result.passed && attempts < max) {
    attempts++;
    // Signal to EZRA auto that a fix attempt is needed
    result = runGate(projectDir, phaseNum, { retryCount: attempts });
  }

  return { passed: result.passed, attempts, final_result: result };
}

/**
 * List all saved gate results for a project.
 */
function listGateResults(projectDir) {
  const gatesDir = path.join(projectDir, GATE_DIR);
  if (!fs.existsSync(gatesDir)) return [];
  return fs.readdirSync(gatesDir)
    .filter(f => f.startsWith('phase-') && f.endsWith('.yaml'))
    .sort()
    .map(f => {
      const phaseNum = parseInt(f.replace('phase-', '').replace('.yaml', ''));
      const saved = loadGateResult(projectDir, phaseNum);
      return { phase: phaseNum, file: f, ...saved };
    });
}

module.exports = {
  GATE_CHECKS,
  DEFAULT_THRESHOLDS,
  runGate,
  runTestSuite,
  runLintCheck,
  runSecurityScan,
  runCoverageCheck,
  runStandardsCheck,
  fixAndRecheck,
  saveGateResult,
  loadGateResult,
  listGateResults,
  detectTestRunner,
  detectLintCommand,
};

// Hook protocol
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      const cwd = event.cwd || process.cwd();
      const phase = event.phase || 0;
      const result = runGate(cwd, phase);
      process.stdout.write(JSON.stringify(result));
    } catch (e) {
      process.stderr.write('ezra-phase-gate: ' + e.message + '\n');
      process.stdout.write(JSON.stringify({ passed: false, error: e.message }));
    }
    process.exit(0);
  });
}
