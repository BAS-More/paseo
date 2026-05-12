#!/usr/bin/env node
'use strict';

/**
 * EZRA Real-Time Agent Oversight Hook
 *
 * PreToolUse hook for Write/Edit operations.
 * Checks code changes against standards, security patterns,
 * and governance rules BEFORE they are applied.
 *
 * 4 intervention levels (from settings.yaml oversight.level):
 *   monitor — logs issues, never blocks
 *   warn    — shows warnings, doesn't block
 *   gate    — blocks critical/high violations
 *   strict  — blocks ANY violation
 *
 * Install: Add to .claude/settings.json under hooks.PreToolUse
 * { "matcher": "Write|Edit|MultiEdit",
 *   "hooks": [{ "type": "command",
 *     "command": "node <path>/ezra-oversight.js", "timeout": 5 }] }
 */

const fs = require('fs');
const path = require('path');

// EZRA feedback helpers (non-blocking)
let _log, _fmt, _eventBus;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }
try { _eventBus = require('./ezra-event-bus'); } catch { _eventBus = null; }

// ─── Settings Loader (inline, no external deps) ─────────────────

let settingsModule;
try {
  settingsModule = require(path.join(__dirname, 'ezra-settings.js'));
} catch {
  settingsModule = null;
}

function loadOversightSettings(cwd) {
  if (settingsModule) {
    return settingsModule.getOversight(cwd);
  }
  _log('oversight', 'warn', 'Settings module unavailable — using default oversight settings');
  // Fallback defaults if settings module unavailable
  //
  // CONFIG-ONLY settings (stored for dashboard/compliance reporting, not PreToolUse-enforceable):
  //   health_threshold    — requires cross-session health score aggregation
  //   auto_pause_on_critical — requires session-level state management
  //   review_every_n_files   — requires stateful file counter across hook calls
  //   notify_on              — requires notification infrastructure (ezra-notifier.js)
  //
  // Similarly, these security settings are config-only:
  //   security.sast_engine        — selects external tool, not pattern-enforceable
  //   security.encryption_at_rest — DB/infra configuration
  //   security.data_retention_days — runtime behavior
  //   security.mfa_enforcement    — auth infrastructure
  //   security.password_rotation_days — auth infrastructure
  //   security.anomaly_detection  — runtime monitoring
  //   security.anomaly_sensitivity — runtime monitoring
  //
  return {
    enabled: true,
    level: 'warn',
    health_threshold: 75,
    auto_pause_on_critical: true,
    review_every_n_files: 5,
    excluded_paths: ['*.test.ts', '*.spec.ts', 'docs/*'],
    notify_on: ['critical', 'high'],
  };
}

function loadGovernance(cwd) {
  const govPath = path.join(cwd, '.ezra', 'governance.yaml');
  if (!fs.existsSync(govPath)) return null;
  try {
    const text = fs.readFileSync(govPath, 'utf8');
    if (settingsModule) {
      return settingsModule.parseYamlSimple(text);
    }
    // Minimal fallback: extract protected_paths
    const result = { protected_paths: [] };
    const lines = text.split(/\r?\n/);
    let inProtected = false;
    for (const line of lines) {
      if (/^protected_paths:/.test(line)) { inProtected = true; continue; }
      if (inProtected && line.trim().startsWith('- ')) {
        result.protected_paths.push(line.trim().slice(2).trim());
      } else if (inProtected && !/^\s/.test(line)) {
        inProtected = false;
      }
    }
    return result;
  } catch {
    return null;
  }
}

function loadStandards(cwd) {
  if (settingsModule) {
    return settingsModule.getStandards(cwd);
  }
  return { no_any: true, naming: 'camelCase', max_complexity: 10 };
}

function loadSecuritySettings(cwd) {
  if (settingsModule) {
    return settingsModule.getSecurity(cwd);
  }
  return { secrets_scanning: true, custom_rules: [] };
}

function loadCompliance(cwd) {
  if (settingsModule && typeof settingsModule.getCompliance === 'function') {
    return settingsModule.getCompliance(cwd);
  }
  return { enabled: false, standards: {}, enforcement_mode: 'advisory' };
}

// ─── Glob Matching ───────────────────────────────────────────────

function matchGlob(filePath, pattern) {
  if (!pattern) return false;
  if (pattern.length > 200) {
    _log('oversight', 'warn', 'Excluded path pattern rejected (>200 chars): ' + pattern.slice(0, 40) + '...');
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/');
  let regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{DS}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DS\}\}/g, '.*');
  try {
    return new RegExp(`^${regex}$`).test(normalized) ||
           new RegExp(regex).test(normalized);
  } catch {
    return false;
  }
}

// ─── ReDoS Guard ─────────────────────────────────────────────────

function isSafeRegex(pattern) {
  if (pattern.length > 200) return false;
  // Reject nested quantifiers: (a+)+, (a*)+, (a{1,})*
  if (/(\+|\*|\})\s*\)(\+|\*|\{)/.test(pattern)) return false;
  return true;
}

// ─── Violation Checks ────────────────────────────────────────────

/**
 * Run all checks against the file content being written/edited.
 * Returns array of { code, severity, message, line? }
 */
function runChecks(content, filePath, cwd) {
  const violations = [];
  const standards = loadStandards(cwd);
  const security = loadSecuritySettings(cwd);
  const governance = loadGovernance(cwd);
  const lines = content.split(/\r?\n/);

  // GAP-002/013: Warn when governance.yaml is missing (fresh/uninitialized project)
  if (!governance) {
    _log('oversight', 'warn', 'governance.yaml not found — protected path enforcement disabled');
  }

  // ── Standards Checks ────────────────────────────────────

  // STD-ANY: Detect 'any' type usage
  if (standards.no_any !== false) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match ': any', 'as any', '<any>', ': any[]', ': any,' patterns
      if (/:\s*any\b|as\s+any\b|<any>/.test(line)) {
        violations.push({
          code: 'STD-ANY',
          severity: 'high',
          message: `'any' type detected at line ${i + 1}`,
          line: i + 1,
        });
      }
    }
  }

  // STD-NAMING: Check file naming convention
  const baseName = path.basename(filePath, path.extname(filePath));
  const naming = standards.naming || 'camelCase';
  if (naming === 'camelCase' && /^[A-Z]/.test(baseName) && !/^[A-Z][A-Z_]+$/.test(baseName)) {
    // PascalCase when camelCase is expected (but allow ALL_CAPS constants)
    violations.push({
      code: 'STD-NAMING',
      severity: 'low',
      message: `File "${path.basename(filePath)}" uses PascalCase, expected camelCase`,
    });
  }

  // STD-COMPLEXITY: Nesting depth check (skip pure data lines)
  const maxComplexity = standards.max_complexity || 10;
  let maxNesting = 0;
  let currentNesting = 0;
  var controlFlowRe = /\b(if|else|for|while|switch|function|catch|try)\b/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    // Only count lines with control flow keywords or standalone braces toward nesting
    if (opens > 0 && !controlFlowRe.test(line) && !/^\s*[\{\}]\s*$/.test(line)) {
      // Pure data line (object literal, config) — count closes but not opens
      currentNesting -= closes;
    } else {
      currentNesting += opens - closes;
    }
    if (currentNesting < 0) currentNesting = 0;
    if (currentNesting > maxNesting) maxNesting = currentNesting;
  }
  if (maxNesting > maxComplexity) {
    violations.push({
      code: 'STD-COMPLEXITY',
      severity: 'medium',
      message: `Nesting depth ${maxNesting} exceeds max complexity ${maxComplexity}`,
    });
  }

  // Standards custom rules
  if (Array.isArray(standards.custom_rules)) {
    for (const rule of standards.custom_rules) {
      if (typeof rule === 'string' && rule.trim() && isSafeRegex(rule)) {
        try {
          const re = new RegExp(rule);
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              violations.push({
                code: 'STD-CUSTOM',
                severity: 'medium',
                message: `Custom rule "${rule}" matched at line ${i + 1}`,
                line: i + 1,
              });
            }
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }
  }

  // STD-TSSTRICT: TypeScript strict mode in tsconfig.json
  if (standards.typescript_strict !== false && path.basename(filePath) === 'tsconfig.json') {
    try {
      const tsconfig = JSON.parse(content);
      if (!tsconfig.compilerOptions || tsconfig.compilerOptions.strict !== true) {
        violations.push({
          code: 'STD-TSSTRICT',
          severity: 'high',
          message: 'tsconfig.json must have compilerOptions.strict set to true',
        });
      }
    } catch {
      // Not valid JSON, skip tsconfig check
    }
  }

  // STD-REQTESTS: Require test files for new source files
  if (standards.require_tests === true) {
    const ext = path.extname(filePath);
    const isSource = /\.[jt]sx?$/.test(ext);
    const isTestF = /\.(test|spec)\.[jt]sx?$/.test(filePath) || /tests?\//i.test(filePath) || /__tests__\//i.test(filePath);
    const isInSrc = /\bsrc\b/i.test(filePath);
    if (isSource && !isTestF && isInSrc) {
      const absPath = path.resolve(cwd, filePath);
      const srcDir = path.resolve(cwd, 'src');
      const srcDirExists = (() => { try { return fs.existsSync(srcDir); } catch { return false; } })();
      const fileAlreadyExists = (() => { try { return fs.existsSync(absPath); } catch { return false; } })();
      if (!fileAlreadyExists && srcDirExists) {
        const dir = path.dirname(absPath);
        const base = path.basename(filePath, ext);
        const testVariants = [
          path.join(dir, base + '.test' + ext),
          path.join(dir, base + '.spec' + ext),
          path.join(dir, '__tests__', base + ext),
          path.join(dir, '__tests__', base + '.test' + ext),
        ];
        const hasTest = testVariants.some(function(t) { try { return fs.existsSync(t); } catch { return false; } });
        if (!hasTest) {
          violations.push({
            code: 'STD-REQTESTS',
            severity: 'medium',
            message: 'New source file "' + path.basename(filePath) + '" has no corresponding test file',
          });
        }
      }
    }
  }

  // STD-COVERAGE: Test coverage config threshold check
  if (standards.test_coverage_minimum > 0) {
    const cfgBase = path.basename(filePath);
    const isCovCfg = /^(jest|vitest)\.config\.[jt]s$/.test(cfgBase) || cfgBase === '.nycrc' || cfgBase === '.nycrc.json';
    if (isCovCfg) {
      const thresholdMatch = content.match(/(?:coverageThreshold|lines)\s*[:=]\s*(\d+)/);
      if (thresholdMatch) {
        const configuredThreshold = parseInt(thresholdMatch[1], 10);
        if (configuredThreshold < standards.test_coverage_minimum) {
          violations.push({
            code: 'STD-COVERAGE',
            severity: 'medium',
            message: 'Coverage threshold ' + configuredThreshold + '% is below minimum ' + standards.test_coverage_minimum + '%',
          });
        }
      }
    }
  }

  // STD-ERRHANDLING: Empty catch blocks
  if (standards.error_handling === 'explicit') {
    const emptyCatchRe = /catch\s*\([^)]*\)\s*\{\s*\}/g;
    let emMatch;
    while ((emMatch = emptyCatchRe.exec(content)) !== null) {
      const lineNum = content.substring(0, emMatch.index).split('\n').length;
      violations.push({
        code: 'STD-ERRHANDLING',
        severity: 'medium',
        message: 'Empty catch block at line ' + lineNum + ' — errors should be handled explicitly',
        line: lineNum,
      });
    }
    const commentCatchRe = /catch\s*\([^)]*\)\s*\{\s*\/\/[^\n]*\s*\}/g;
    let cmMatch;
    while ((cmMatch = commentCatchRe.exec(content)) !== null) {
      const lineNum2 = content.substring(0, cmMatch.index).split('\n').length;
      violations.push({
        code: 'STD-ERRHANDLING',
        severity: 'medium',
        message: 'Catch block with only a comment at line ' + lineNum2 + ' — errors should be handled explicitly',
        line: lineNum2,
      });
    }
  }

  // ── Security Checks ─────────────────────────────────────

  if (security.secrets_scanning !== false) {
    // SEC-SECRETS: Hardcoded secrets patterns
    const secretPatterns = [
      { re: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{16,}['"]/i, name: 'API key' },
      { re: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i, name: 'secret/password' },
      { re: /(?:aws_access_key_id|aws_secret)\s*[:=]\s*['"][A-Za-z0-9+/=]{16,}['"]/i, name: 'AWS key' },
      { re: /(?:-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----)/, name: 'private key' },
      { re: /ghp_[A-Za-z0-9]{36,}/, name: 'GitHub token' },
      { re: /sk-[A-Za-z0-9]{20,}/, name: 'secret key token' },
    ];

    for (let i = 0; i < lines.length; i++) {
      for (const pat of secretPatterns) {
        if (pat.re.test(lines[i])) {
          violations.push({
            code: 'SEC-SECRETS',
            severity: 'critical',
            message: `Possible ${pat.name} at line ${i + 1}`,
            line: i + 1,
          });
          break; // One violation per line is enough
        }
      }
    }
  }

  // SEC-SQLI: SQL injection patterns (gated by security.input_validation)
  if (security.input_validation !== false) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // String concatenation in SQL-like context
      if (/(?:query|sql|execute)\s*\(\s*['"`].*\$\{|['"`]\s*\+\s*\w+.*(?:WHERE|SELECT|INSERT|DELETE|UPDATE)/i.test(line)) {
        violations.push({
          code: 'SEC-SQLI',
          severity: 'critical',
          message: `Potential SQL injection via string concatenation at line ${i + 1}`,
          line: i + 1,
        });
      }
    }
  }

  // SEC-LOG: console.log in production code
  const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(filePath) || /tests?\//i.test(filePath);
  if (!isTestFile) {
    for (let i = 0; i < lines.length; i++) {
      if (/\bconsole\.(log|debug)\s*\(/.test(lines[i])) {
        violations.push({
          code: 'SEC-LOG',
          severity: 'low',
          message: `console.log/debug in production code at line ${i + 1}`,
          line: i + 1,
        });
      }
    }
  }

  // Security custom rules
  if (Array.isArray(security.custom_rules)) {
    for (const rule of security.custom_rules) {
      if (typeof rule === 'string' && rule.trim() && isSafeRegex(rule)) {
        try {
          const re = new RegExp(rule);
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              violations.push({
                code: 'SEC-CUSTOM',
                severity: 'high',
                message: `Custom security rule "${rule}" matched at line ${i + 1}`,
                line: i + 1,
              });
            }
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }
  }

  // ── Sprint 3: High-Impact Security Enforcement ──────────

  // SEC-SAST: Static analysis patterns
  if (security.sast === true) {
    var sastPatterns = [
      { re: /\beval\s*\(/, name: 'eval() usage' },
      { re: /\beval\.(call|apply)\s*\(/, name: 'eval.call/apply() usage' },
      { re: /\(\s*0\s*,\s*eval\s*\)\s*\(/, name: 'indirect eval (0, eval)()' },
      { re: new RegExp('\\bnew\\s+Fun' + 'ction\\s*\\('), name: 'new Fun' + 'ction() constructor' },
      { re: /\.innerHTML\s*=/, name: 'innerHTML assignment' },
      { re: /dangerouslySetInnerHTML/, name: 'dangerouslySetInnerHTML' },
      { re: /\bdocument\.write\s*\(/, name: 'document.write()' },
      { re: /\bsetTimeout\s*\(\s*['"`]/, name: 'setTimeout with string argument' },
      { re: /\bsetTimeout\s*\(\s*`/, name: 'setTimeout with template literal' },
      { re: /\bsetInterval\s*\(\s*['"`]/, name: 'setInterval with string argument' },
      { re: /\bsetInterval\s*\(\s*`/, name: 'setInterval with template literal' },
    ];
    for (var si = 0; si < lines.length; si++) {
      for (var sp = 0; sp < sastPatterns.length; sp++) {
        if (sastPatterns[sp].re.test(lines[si])) {
          violations.push({
            code: 'SEC-SAST',
            severity: 'high',
            message: sastPatterns[sp].name + ' at line ' + (si + 1),
            line: si + 1,
          });
        }
      }
    }
  }

  // SEC-AUTH: Route authentication check
  if (security.require_auth_on_all_routes === true) {
    var isRouteFile = /(?:routes|api|pages[\\/]api|graphql|resolvers|trpc)[\\/]/.test(filePath);
    if (isRouteFile) {
      var authTokens = ['auth', 'authenticate', 'requireAuth', 'withAuth', 'getSession', 'getServerSession', 'middleware'];
      var hasAuth = false;
      for (var ai = 0; ai < authTokens.length; ai++) {
        if (content.indexOf(authTokens[ai]) !== -1) { hasAuth = true; break; }
      }
      if (!hasAuth) {
        violations.push({
          code: 'SEC-AUTH',
          severity: 'high',
          message: 'Route file has no auth middleware reference: ' + filePath,
          line: 1,
        });
      }
    }
  }

  // SEC-CORS: CORS misconfiguration
  if (security.cors_validation === true) {
    for (var ci = 0; ci < lines.length; ci++) {
      if (/origin\s*:\s*['"`]\*['"`]/.test(lines[ci]) || /origin\s*:\s*true/.test(lines[ci]) || /Access-Control-Allow-Origin\s*:\s*\*/.test(lines[ci])) {
        violations.push({
          code: 'SEC-CORS',
          severity: 'high',
          message: 'Wildcard CORS origin at line ' + (ci + 1),
          line: ci + 1,
        });
      }
    }
  }

  // SEC-HSTS: HSTS enforcement
  if (security.hsts_enforcement === true) {
    var isServerConfig = /(?:server|app|express|middleware)\.[jt]sx?$/.test(filePath) || /\.config\.[jt]sx?$/.test(filePath);
    if (isServerConfig) {
      var hstsMatch = content.match(/max-age\s*=\s*(\d+)/);
      if (hstsMatch) {
        var configuredAge = parseInt(hstsMatch[1], 10);
        var requiredAge = security.hsts_max_age || 31536000;
        if (configuredAge < requiredAge) {
          violations.push({
            code: 'SEC-HSTS',
            severity: 'medium',
            message: 'HSTS max-age ' + configuredAge + ' below required ' + requiredAge,
            line: 1,
          });
        }
      }
    }
  }

  // SEC-COOKIE: Cookie security flags
  if (security.cookie_security === true) {
    for (var ki = 0; ki < lines.length; ki++) {
      if (/secure\s*:\s*false/.test(lines[ki])) {
        violations.push({
          code: 'SEC-COOKIE',
          severity: 'medium',
          message: 'Cookie with secure:false at line ' + (ki + 1),
          line: ki + 1,
        });
      }
      if (/httpOnly\s*:\s*false/.test(lines[ki])) {
        violations.push({
          code: 'SEC-COOKIE',
          severity: 'medium',
          message: 'Cookie with httpOnly:false at line ' + (ki + 1),
          line: ki + 1,
        });
      }
      if (/sameSite\s*:\s*['"]none['"]/i.test(lines[ki])) {
        violations.push({
          code: 'SEC-COOKIE',
          severity: 'medium',
          message: 'Cookie with sameSite:none disables SameSite protection at line ' + (ki + 1),
          line: ki + 1,
        });
      }
    }
  }

  // SEC-ERROREXPOSE: Error exposure prevention
  if (security.error_exposure_prevention !== false) {
    for (var ei = 0; ei < lines.length; ei++) {
      if (/res\.(send|json)\s*\(\s*err\b/.test(lines[ei])) {
        violations.push({
          code: 'SEC-ERROREXPOSE',
          severity: 'high',
          message: 'Raw error object in response at line ' + (ei + 1),
          line: ei + 1,
        });
      }
      if (/err\.stack/.test(lines[ei]) && /res\.(send|json|write)/.test(lines[ei])) {
        violations.push({
          code: 'SEC-ERROREXPOSE',
          severity: 'high',
          message: 'Error stack trace exposed in response at line ' + (ei + 1),
          line: ei + 1,
        });
      }
    }
  }

  // SEC-ENCRYPT-TRANSIT: Flag non-localhost, non-private-IP http:// URLs
  if (security.encryption_in_transit !== false) {
    var httpUrlRe = /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/g;
    var commentLineRe = /^\s*(\/\/|\/\*|\*|#)/;
    for (var ti = 0; ti < lines.length; ti++) {
      if (commentLineRe.test(lines[ti])) continue;
      if (httpUrlRe.test(lines[ti])) {
        violations.push({
          code: 'SEC-ENCRYPT-TRANSIT',
          severity: 'high',
          message: 'Unencrypted HTTP URL at line ' + (ti + 1),
          line: ti + 1,
        });
      }
      httpUrlRe.lastIndex = 0;
    }
  }

  // SEC-PII: PII detection
  if (security.pii_detection === true) {
    var piiSeverity = (security.pii_action === 'block') ? 'critical' : 'medium';
    var ssnRe = /\b\d{3}-\d{2}-\d{4}\b/;
    var ssnUnfmtRe = /\b\d{9}\b/;
    var ssnContextRe = /ssn|social.?sec|tax.?id|national.?id/i;
    var ccRe = /\b(?:\d[ -]*?){13,19}\b/;
    for (var pi = 0; pi < lines.length; pi++) {
      if (ssnRe.test(lines[pi])) {
        violations.push({
          code: 'SEC-PII',
          severity: piiSeverity,
          message: 'Possible SSN pattern at line ' + (pi + 1),
          line: pi + 1,
        });
      } else if (ssnUnfmtRe.test(lines[pi]) && ssnContextRe.test(lines[pi])) {
        violations.push({
          code: 'SEC-PII',
          severity: piiSeverity,
          message: 'Possible unformatted SSN at line ' + (pi + 1),
          line: pi + 1,
        });
      }
      if (ccRe.test(lines[pi]) && /['"`]/.test(lines[pi])) {
        violations.push({
          code: 'SEC-PII',
          severity: piiSeverity,
          message: 'Possible credit card number at line ' + (pi + 1),
          line: pi + 1,
        });
      }
    }
  }

  // ── Sprint 4: Extended Security Enforcement ─────────────

  // SEC-CONTAINER: Dockerfile security
  if (security.container_scanning === true) {
    var isDockerfile = /Dockerfile/i.test(filePath);
    if (isDockerfile) {
      if (/FROM\s+\S+:latest\b/.test(content)) {
        violations.push({ code: 'SEC-CONTAINER', severity: 'medium', message: 'Dockerfile uses :latest tag — pin to specific version', line: 1 });
      }
      if (!/^USER\s+/m.test(content)) {
        violations.push({ code: 'SEC-CONTAINER', severity: 'medium', message: 'Dockerfile missing USER directive — runs as root', line: 1 });
      }
      if (/^COPY\s+\.\s+\./m.test(content)) {
        violations.push({ code: 'SEC-CONTAINER', severity: 'medium', message: 'Dockerfile uses COPY . . — use specific paths or .dockerignore', line: 1 });
      }
    }
  }

  // SEC-IAC: Infrastructure as Code scanning
  if (security.iac_scanning === true) {
    var iacToolsSetting = security.iac_tools || 'both';
    var isTerraform = /\.tf$/.test(filePath);
    var isCfn = /\.(yaml|yml|json)$/.test(filePath) && /AWSTemplateFormatVersion|AWS::/.test(content);
    var isPulumi = /Pulumi\.(yaml|yml)$/.test(filePath) || (/\.(ts|py|go|cs)$/.test(filePath) && /pulumi\./.test(content));
    var isAnsible = /\.(yaml|yml)$/.test(filePath) && /\bhosts\s*:/.test(content) && /\btasks\s*:/.test(content);
    var isBicep = /\.bicep$/.test(filePath);

    var checkTf = iacToolsSetting === 'terraform' || iacToolsSetting === 'both';
    var checkCfn = iacToolsSetting === 'cloudformation' || iacToolsSetting === 'both';
    var checkPulumi = iacToolsSetting === 'pulumi' || iacToolsSetting === 'both';
    var checkAnsible = iacToolsSetting === 'ansible' || iacToolsSetting === 'both';
    var checkBicep = iacToolsSetting === 'bicep' || iacToolsSetting === 'both';

    // Terraform checks
    if (isTerraform && checkTf) {
      if (/acl\s*=\s*["']public-read/.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'Public S3 bucket ACL detected', line: 1 });
      }
      if (/cidr_blocks\s*=\s*\[\s*["']0\.0\.0\.0\/0["']/.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'Security group open to 0.0.0.0/0', line: 1 });
      }
      if (/encrypted\s*=\s*false/.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'Encryption disabled in infrastructure', line: 1 });
      }
    }

    // CloudFormation checks
    if (isCfn && checkCfn) {
      if (/AccessControl.*PublicRead/i.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'CloudFormation: public S3 bucket ACL detected', line: 1 });
      }
      if (/CidrIp.*0\.0\.0\.0\/0/.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'CloudFormation: security group open to 0.0.0.0/0', line: 1 });
      }
    }

    // Pulumi checks
    if (isPulumi && checkPulumi) {
      if (/acl.*public-read/i.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'Pulumi: public bucket ACL detected', line: 1 });
      }
      if (/0\.0\.0\.0\/0/.test(content) && /ingress|SecurityGroup/i.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'Pulumi: security group open to 0.0.0.0/0', line: 1 });
      }
    }

    // Ansible checks
    if (isAnsible && checkAnsible) {
      if (/become\s*:\s*true/i.test(content) && !/become_user/i.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'medium', message: 'Ansible: privilege escalation without become_user', line: 1 });
      }
    }

    // Bicep checks
    if (isBicep && checkBicep) {
      if (/publicAccess.*Blob|Container/i.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'Bicep: public blob access detected', line: 1 });
      }
      if (/0\.0\.0\.0\/0/.test(content)) {
        violations.push({ code: 'SEC-IAC', severity: 'high', message: 'Bicep: network rule open to 0.0.0.0/0', line: 1 });
      }
    }
  }

  // SEC-SESSION: Session timeout validation
  if (typeof security.session_timeout === 'number' && security.session_timeout > 0) {
    var maxAgeMatch = content.match(/maxAge\s*[:=]\s*(\d+)/);
    if (maxAgeMatch) {
      var maxAgeMin = parseInt(maxAgeMatch[1], 10) / 60000;
      if (maxAgeMin > security.session_timeout) {
        violations.push({ code: 'SEC-SESSION', severity: 'medium', message: 'Session maxAge (' + Math.round(maxAgeMin) + 'min) exceeds configured timeout (' + security.session_timeout + 'min)', line: 1 });
      }
    }
  }

  // SEC-PASSWD: Password minimum length check
  if (typeof security.password_min_length === 'number' && security.password_min_length > 0) {
    var pwLenMatch = content.match(/(?:password|passwd|pwd).*(?:length|len)\s*(?:>=?|<)\s*(\d+)/i);
    if (!pwLenMatch) {
      pwLenMatch = content.match(/(?:minLength|min_length)\s*[:=]\s*(\d+)/);
    }
    if (pwLenMatch) {
      var configuredLen = parseInt(pwLenMatch[1], 10);
      if (configuredLen < security.password_min_length) {
        violations.push({ code: 'SEC-PASSWD', severity: 'medium', message: 'Password length check (' + configuredLen + ') below minimum (' + security.password_min_length + ')', line: 1 });
      }
    }
  }

  // SEC-CSP: Content Security Policy
  if (security.csp_enforcement === true) {
    for (var cspI = 0; cspI < lines.length; cspI++) {
      if (/unsafe-inline/.test(lines[cspI]) && /content-security-policy/i.test(lines[cspI])) {
        violations.push({ code: 'SEC-CSP', severity: 'medium', message: 'CSP with unsafe-inline at line ' + (cspI + 1), line: cspI + 1 });
      }
      if (/unsafe-eval/.test(lines[cspI]) && /content-security-policy/i.test(lines[cspI])) {
        violations.push({ code: 'SEC-CSP', severity: 'medium', message: 'CSP with unsafe-eval at line ' + (cspI + 1), line: cspI + 1 });
      }
    }
  }

  // SEC-LOGSANITIZE: Log sanitization
  if (security.log_sanitization === true) {
    var logSensitiveRe = /(?:console\.(?:log|info|warn|error)|log(?:ger)?\.(?:info|warn|error|debug))\s*\([^)]*(?:password|token|secret|apiKey|api_key|credential|ssn|creditCard|credit_card|private_key|privateKey|auth_token|authToken|access_key|accessKey|session_id|sessionId)/i;
    for (var lsi = 0; lsi < lines.length; lsi++) {
      if (logSensitiveRe.test(lines[lsi])) {
        violations.push({ code: 'SEC-LOGSANITIZE', severity: 'medium', message: 'Sensitive data in log statement at line ' + (lsi + 1), line: lsi + 1 });
      }
    }
  }

  // SEC-APIFILTER: API response filtering
  if (security.api_response_filtering === true) {
    var directReturnRe = /res\.(json|send)\s*\(\s*(?:user|account|profile|record|row|data|customer|member|patient|employee)\s*\)/;
    for (var afi = 0; afi < lines.length; afi++) {
      if (directReturnRe.test(lines[afi])) {
        violations.push({ code: 'SEC-APIFILTER', severity: 'low', message: 'Direct DB/model object in API response at line ' + (afi + 1) + ' — use explicit field selection', line: afi + 1 });
      }
    }
  }

  // SEC-DEPVULN: Dependency vulnerability patterns
  if (security.dep_vuln_scanning === true) {
    var isPkgJson = /package\.json$/.test(filePath);
    if (isPkgJson) {
      var knownVulnPkgs = ['event-stream', 'flatmap-stream', 'ua-parser-js', 'coa', 'rc'];
      for (var dvi = 0; dvi < knownVulnPkgs.length; dvi++) {
        if (content.indexOf('"' + knownVulnPkgs[dvi] + '"') !== -1) {
          violations.push({ code: 'SEC-DEPVULN', severity: 'high', message: 'Known vulnerable package: ' + knownVulnPkgs[dvi], line: 1 });
        }
      }
    }
  }

  // SEC-LICENSE: License compliance
  if (security.license_compliance === true) {
    var isPkgJsonLic = /package\.json$/.test(filePath);
    if (isPkgJsonLic) {
      var blockList = security.license_block_list || 'gpl-agpl';
      var blockedLicenses = [];
      if (blockList.indexOf('gpl') !== -1) { blockedLicenses.push('GPL'); }
      if (blockList.indexOf('agpl') !== -1) { blockedLicenses.push('AGPL'); }
      for (var bli = 0; bli < blockedLicenses.length; bli++) {
        var licRe = new RegExp('"license"\\s*:\\s*"[^"]*' + blockedLicenses[bli] + '[^"]*"', 'i');
        if (licRe.test(content)) {
          violations.push({ code: 'SEC-LICENSE', severity: 'medium', message: 'Blocked license type: ' + blockedLicenses[bli], line: 1 });
        }
      }
    }
  }

  // SEC-IPALLOW: IP allowlisting check
  if (security.ip_allowlisting === true) {
    var isRouteFileIp = /(?:routes|api|pages[\\/]api)[\\/]/.test(filePath);
    if (isRouteFileIp) {
      var hasIpCheck = content.indexOf('ipAllow') !== -1 || content.indexOf('ip_allow') !== -1 || content.indexOf('ipWhitelist') !== -1 || content.indexOf('ipFilter') !== -1 || content.indexOf('rateLimiter') !== -1;
      if (!hasIpCheck) {
        violations.push({ code: 'SEC-IPALLOW', severity: 'low', message: 'Route file missing IP allowlist middleware: ' + filePath, line: 1 });
      }
    }
  }

  // ── Governance Checks ───────────────────────────────────

  if (governance && Array.isArray(governance.protected_paths)) {
    const relativePath = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, '/');
    for (const pp of governance.protected_paths) {
      const pattern = (typeof pp === 'object') ? (pp.pattern || '') : String(pp);
      if (matchGlob(relativePath, pattern)) {
        violations.push({
          code: 'GOV-PROTECTED',
          severity: 'high',
          message: `File matches protected path "${pattern}"`,
        });
      }
    }
  }

  // ── Compliance Checks ────────────────────────────────────
  var complianceSettings = loadCompliance(cwd);
  if (complianceSettings && complianceSettings.enabled) {
    try {
      var compMod = require('./ezra-compliance');
      var compViolations = compMod.runChecks(content, filePath, cwd, complianceSettings, { standards: standards, security: security });
      for (var cvi = 0; cvi < compViolations.length; cvi++) {
        violations.push(compViolations[cvi]);
      }
    } catch (compErr) {
      // Compliance module load failure should not block writes
    }
  }

  // ── Best Practices Checks ──────────────────────────────────
  var bpSettings = settingsModule ? settingsModule.getBestPractices(cwd) : {};
  if (bpSettings && bpSettings.enabled !== false) {
    try {
      var bpMod = require('./ezra-best-practices');
      var existingCodes = new Set();
      for (var eci = 0; eci < violations.length; eci++) {
        existingCodes.add(violations[eci].code);
      }
      var bpViolations = bpMod.runChecks(content, filePath, cwd, bpSettings, { existingViolationCodes: existingCodes });
      for (var bvi = 0; bvi < bpViolations.length; bvi++) {
        violations.push(bpViolations[bvi]);
      }
    } catch (bpErr) {
      // Best practices module load failure should not block writes
    }
  }

  // ── Workflow Enforcement Checks ────────────────────────────────
  var wfSettings = settingsModule ? settingsModule.getWorkflows(cwd) : {};
  if (wfSettings && wfSettings.active_templates && wfSettings.active_templates.length > 0) {
    try {
      var wfMod = require('./ezra-workflow-enforce');
      var wfExistingCodes = new Set();
      for (var weci = 0; weci < violations.length; weci++) {
        wfExistingCodes.add(violations[weci].code);
      }
      var wfViolations = wfMod.runChecks(content, filePath, cwd, wfSettings, { existingViolationCodes: wfExistingCodes });
      for (var wvi = 0; wvi < wfViolations.length; wvi++) {
        violations.push(wfViolations[wvi]);
      }
    } catch (wfErr) {
      // Workflow enforcement module load failure should not block writes
    }
  }

  return violations;
}

// ─── Violation Logger ────────────────────────────────────────────

const MAX_LOG_SIZE = 1024 * 1024; // 1 MB log rotation threshold

function logViolations(cwd, violations, filePath) {
  if (violations.length === 0) return;
  const oversightDir = path.join(cwd, '.ezra', 'oversight');
  try {
    if (!fs.existsSync(oversightDir)) {
      fs.mkdirSync(oversightDir, { recursive: true });
    }
    const logPath = path.join(oversightDir, 'violations.log');
    // Rotate log if it exceeds threshold
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        const rotated = logPath + '.1';
        try { fs.unlinkSync(rotated); } catch { /* no previous rotation */ }
        fs.renameSync(logPath, rotated);
      }
    }
    const timestamp = new Date().toISOString();
    const lines = violations.map(v =>
      `[${timestamp}] ${v.severity.toUpperCase()} ${v.code}: ${v.message} (${filePath})`
    );
    fs.appendFileSync(logPath, lines.join('\n') + '\n');
  } catch {
    // Logging failure should not block work
  }
}

// ─── Decision Engine ─────────────────────────────────────────────

/**
 * Given violations and oversight level, decide whether to allow or deny.
 * Returns { decision: 'allow'|'deny', message: string }
 */
function decide(violations, level) {
  if (violations.length === 0) {
    return { decision: 'allow', message: '' };
  }

  const hasCritical = violations.some(v => v.severity === 'critical');
  const hasHigh = violations.some(v => v.severity === 'high');
  const summary = violations.map(v => `[${v.code}] ${v.message}`).join('; ');

  switch (level) {
    case 'monitor': {
      const msg = `MONITOR: ${violations.length} issue(s) detected — ${summary}`;
      return { decision: 'allow', message: msg };
    }
    case 'warn': {
      const msg = `WARN: ${violations.length} issue(s) detected — ${summary}`;
      return { decision: 'allow', message: msg };
    }
    case 'gate': {
      if (hasCritical || hasHigh) {
        const msg = `GATE: Blocked — ${violations.length} issue(s) with critical/high severity — ${summary}`;
        return { decision: 'deny', message: msg };
      }
      const msg = `GATE: ${violations.length} low/medium issue(s) — ${summary}`;
      return { decision: 'allow', message: msg };
    }
    case 'phase-gate': {
      // Hard block — cannot be skipped. Used during plan-driven execution phase boundaries.
      const msg = `PHASE-GATE: Hard block — ${violations.length} issue(s) must be resolved before phase can advance — ${summary}`;
      // Emit decision_needed event so notification system can alert user
      if (_eventBus) {
        try {
          _eventBus.emit(process.cwd(), 'decision_needed', {
            message: msg,
            violation_count: violations.length,
            summary,
          });
        } catch { /* non-blocking */ }
      }
      return { decision: 'deny', message: msg };
    }
    case 'strict': {
      const msg = `STRICT: Blocked — ${violations.length} issue(s) detected — ${summary}`;
      return { decision: 'deny', message: msg };
    }
    default: {
      const msg = `WARN: ${violations.length} issue(s) detected — ${summary}`;
      return { decision: 'allow', message: msg };
    }
  }
}

// ─── Exports (for require() / testing) ───────────────────────────

module.exports = {
  runChecks,
  decide,
  logViolations,
  matchGlob,
  loadOversightSettings,
  isSafeRegex,
};

// ─── Hook Protocol (stdin → stdout → exit 0) ─────────────────────

if (require.main === module) {
  const MAX_STDIN = 1024 * 1024; // 1 MB stdin limit
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > MAX_STDIN) { process.exit(0); }
  });
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      const toolName = event.tool_name || '';
      const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
      const content = event.tool_input?.content || event.tool_input?.new_string || '';

      // Only check write/edit operations
      if (!/Write|Edit|MultiEdit/i.test(toolName)) {
        process.exit(0);
        return;
      }

      if (!filePath || !content) {
        process.exit(0);
        return;
      }

      const cwd = event.cwd || process.cwd();

      // Path traversal guard — resolved path must stay within cwd
      // F-004: Use realpathSync for symlink resolution
      let resolvedPath = path.resolve(cwd, filePath);
      try {
        if (fs.existsSync(resolvedPath)) {
          resolvedPath = fs.realpathSync(resolvedPath);
        }
      } catch { /* fallback to resolve */ }
      const cwdResolved = path.resolve(cwd);
      let cwdReal = cwdResolved;
      try { cwdReal = fs.realpathSync(cwdResolved); } catch { /* fallback */ }
      // Case-insensitive comparison on Windows to prevent drive-letter casing bypass
      const norm = process.platform === 'win32' ? s => s.toLowerCase() : s => s;
      if (!norm(resolvedPath).startsWith(norm(cwdReal) + path.sep) && norm(resolvedPath) !== norm(cwdReal)) {
        const msg = _fmt('GUARD_002', { path: filePath });
        process.stderr.write(msg + "\n");
        _log(cwd, 'ezra-oversight', 'error', msg);
        process.exit(0);
        return;
      }
      const ezraDir = path.join(cwd, '.ezra');

      // Quick exit if EZRA not initialized
      if (!fs.existsSync(ezraDir)) {
        process.exit(0);
        return;
      }

      const settings = loadOversightSettings(cwd);

      // Check if oversight is enabled
      if (!settings.enabled) {
        process.exit(0);
        return;
      }

      // Check excluded paths
      const relativePath = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, '/');
      const excluded = (settings.excluded_paths || []);
      for (const pattern of excluded) {
        if (matchGlob(relativePath, pattern)) {
          process.exit(0);
          return;
        }
      }

      // Run checks
      const violations = runChecks(content, filePath, cwd);

      // Log all violations
      logViolations(cwd, violations, filePath);

      // Decide
      const { decision, message } = decide(violations, settings.level || 'warn');

      if (violations.length === 0) {
        process.exit(0);
        return;
      }

      // Log violation summary to stderr for user visibility
      const critCount = violations.filter(v => v.severity === 'critical' || v.severity === 'high').length;
      if (critCount > 0) {
        const msg = _fmt('OVERSIGHT_001', { detail: `${critCount} critical/high issue(s) in ${relativePath}` });
        process.stderr.write(msg + "\n");
        _log(cwd, 'ezra-oversight', 'warn', msg, 'Run /ezra:review.');
      } else {
        const msg = _fmt('OVERSIGHT_003', { detail: `${violations.length} issue(s) in ${relativePath}` });
        process.stderr.write(msg + "\n");
        _log(cwd, 'ezra-oversight', 'info', msg, 'Run /ezra:scan.');
      }

      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision === 'deny' ? 'deny' : 'allow',
          permissionDecisionReason: `EZRA Oversight: ${message}`,
        },
      };

      process.stdout.write(JSON.stringify(output));
    } catch (hookErr) {
      // Hook errors should never block work
      const msg = 'EZRA [OVERSIGHT]: Hook error — ' + (hookErr && hookErr.message ? hookErr.message : 'unknown');
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-oversight', 'error', msg);
      process.exit(0);
    }
  });
}
