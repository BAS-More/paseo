#!/usr/bin/env node
'use strict';

/**
 * EZRA v8 — Workflow Enforcement Module
 *
 * Enforces active workflow template requirements on file writes.
 * Each workflow template maps to specific checks that are applied
 * when the template is enabled in settings.
 *
 * Called by ezra-oversight.js after best practices checks.
 * Accepts existingCodes Set to avoid duplicate violations.
 *
 * Check types:
 *   REGEX — line-by-line pattern matching (WF-xxx-R codes)
 *   FILE  — file/directory existence (WF-xxx-F codes)
 */

var fs = require('fs');
var path = require('path');

// ═══════════════════════════════════════════════════════════════
// WORKFLOW_CHECKS — Maps template IDs to enforcement checks
// ═══════════════════════════════════════════════════════════════

var WORKFLOW_CHECKS = {
  // ── Quality Gates & Code Review ──
  'wf-phase-gate': {
    regex: [
      {
        code: 'WF-011-R1', severity: 'high',
        message: 'Phase gate active — untested code detected (no corresponding test file)',
        special: 'require-test-file',
        fileFilter: /\.(js|ts|tsx|jsx)$/
      }
    ],
    file: [
      {
        code: 'WF-011-F1', severity: 'high',
        message: 'Phase gate active — .ezra/governance.yaml required for governance tracking',
        path: '.ezra/governance.yaml'
      }
    ]
  },
  'wf-code-review': {
    regex: [
      {
        code: 'WF-012-R1', severity: 'medium',
        message: 'Code review workflow active — file lacks required JSDoc/docstring on exported function',
        patterns: [/^export\s+(async\s+)?function\s+\w+/],
        skipPatterns: [/\/\*\*/, /^\s*\/\/\s*@/, /\.test\.|\.spec\.|__test__|__spec__/],
        fileFilter: /\.(js|ts|tsx|jsx)$/,
        skipTest: true
      }
    ]
  },
  'wf-coverage-gate': {
    file: [
      {
        code: 'WF-014-F1', severity: 'medium',
        message: 'Coverage gate active — coverage configuration file required',
        paths: ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', '.nycrc', '.c8rc.json'],
        anyOf: true
      }
    ]
  },
  'wf-dep-audit': {
    regex: [
      {
        code: 'WF-015-R1', severity: 'medium',
        message: 'Dependency audit active — unpinned dependency version detected',
        patterns: [/"[^"]+"\s*:\s*"[\^~>]/],
        fileFilter: /package\.json$/
      }
    ]
  },

  // ── Release & Deployment ──
  'wf-release-prep': {
    file: [
      {
        code: 'WF-016-F1', severity: 'high',
        message: 'Release prep active — CHANGELOG.md required before release',
        path: 'CHANGELOG.md'
      }
    ]
  },
  'wf-hotfix': {
    regex: [
      {
        code: 'WF-017-R1', severity: 'high',
        message: 'Hotfix workflow active — console.log/debug statements must be removed',
        patterns: [/console\.(log|debug|info)\s*\(/],
        skipPatterns: [/eslint-disable/, /\/\/\s*keep/, /logger\./],
        fileFilter: /\.(js|ts|tsx|jsx)$/,
        skipTest: true
      }
    ]
  },

  // ── Security & DevSecOps ──
  'wf-security-audit': {
    regex: [
      {
        code: 'WF-021-R1', severity: 'critical',
        message: 'Security audit active — hardcoded secret/token detected',
        patterns: [/(password|secret|token|api_key|apikey|private_key)\s*[:=]\s*['"][^'"]{8,}['"]/i],
        skipPatterns: [/example|placeholder|dummy|test|mock|fake|sample|default|changeme/i],
        fileFilter: /\.(js|ts|tsx|jsx|json|yaml|yml|env)$/
      },
      {
        code: 'WF-021-R2', severity: 'high',
        message: 'Security audit active — dynamic code evaluation detected',
        patterns: [/\beval\s*\(/],  // intentional: detects eval usage in user code
        skipPatterns: [/^\s*\/\//, /^\s*\*/],
        fileFilter: /\.(js|ts|tsx|jsx)$/
      }
    ]
  },
  'wf-compliance-check': {
    file: [
      {
        code: 'WF-022-F1', severity: 'medium',
        message: 'Compliance check active — LICENSE file required',
        path: 'LICENSE'
      }
    ]
  },
  'wf-vuln-response': {
    regex: [
      {
        code: 'WF-025-R1', severity: 'high',
        message: 'Vulnerability response active — known vulnerable pattern detected (innerHTML assignment)',
        patterns: [/\.innerHTML\s*=/],
        skipPatterns: [/sanitize|DOMPurify|escape/i],
        fileFilter: /\.(js|ts|tsx|jsx)$/
      }
    ]
  },

  // ── Documentation & Knowledge ──
  'wf-doc-completeness': {
    regex: [
      {
        code: 'WF-026-R1', severity: 'low',
        message: 'Doc completeness active — exported module lacks description comment',
        patterns: [/^module\.exports\s*=/],
        skipPatterns: [/\/\*\*/, /\/\/\s*\w{10,}/],
        fileFilter: /\.(js)$/,
        skipTest: true
      }
    ]
  },

  // ── CI/CD Pipeline ──
  'wf-build-validation': {
    regex: [
      {
        code: 'WF-041-R1', severity: 'medium',
        message: 'Build validation active — require() of devDependency in production code',
        patterns: [/require\s*\(\s*['"](@types\/|jest|mocha|chai|sinon|nock|supertest)/],
        fileFilter: /\.(js|ts)$/,
        skipTest: true
      }
    ]
  },
  'wf-pipeline-security': {
    regex: [
      {
        code: 'WF-045-R1', severity: 'high',
        message: 'Pipeline security active — shell command injection risk (unsanitized variable in template literal)',
        patterns: [/execSync\s*\(\s*`[^`]*\$\{/],
        skipPatterns: [/sanitize|escape|quote/i],
        fileFilter: /\.(js|ts)$/
      }
    ]
  },

  // ── AI Agent Workflows ──
  'wf-otao-loop': {
    regex: [
      {
        code: 'WF-051-R1', severity: 'medium',
        message: 'OTAO loop active — infinite loop risk (while(true) without break condition)',
        patterns: [/while\s*\(\s*true\s*\)\s*\{/],
        skipPatterns: [/break\s*;/, /return\s/],
        fileFilter: /\.(js|ts|tsx|jsx)$/
      }
    ]
  },
  'wf-human-gate': {
    regex: [
      {
        code: 'WF-057-R1', severity: 'high',
        message: 'Human-in-the-loop active — destructive operation without confirmation guard',
        patterns: [/\b(delete|remove|drop|truncate|destroy)\s*\(/i],
        skipPatterns: [/confirm|prompt|approval|gate|guard|if\s*\(|\.test\.|\.spec\./i],
        fileFilter: /\.(js|ts|tsx|jsx)$/,
        skipTest: true
      }
    ]
  },
  'wf-token-budget': {
    regex: [
      {
        code: 'WF-060-R1', severity: 'medium',
        message: 'Token budget active — unbounded LLM call (no max_tokens parameter)',
        patterns: [/\.(complete|chat|generate)\s*\(\s*\{(?:(?!max_tokens)[^}])*\}/],
        fileFilter: /\.(js|ts|tsx|jsx)$/
      }
    ]
  },

  // ── MCP & Tool Integration ──
  'wf-mcp-security': {
    regex: [
      {
        code: 'WF-063-R1', severity: 'critical',
        message: 'MCP security active — MCP tool call without permission validation',
        patterns: [/mcp\.(call|invoke|execute)\s*\(/i],
        skipPatterns: [/permission|authorize|validate|check|guard|gate/i],
        fileFilter: /\.(js|ts|tsx|jsx)$/
      }
    ]
  },
  'wf-zero-trust': {
    regex: [
      {
        code: 'WF-070-R1', severity: 'high',
        message: 'Zero-trust active — trust boundary crossed without validation',
        patterns: [/\breq\.(body|query|params)\.\w+/],
        skipPatterns: [/validate|sanitize|check|schema|zod|joi|yup|assert/i],
        fileFilter: /\.(js|ts|tsx|jsx)$/,
        skipTest: true
      }
    ]
  },

  // ── Data & Migration ──
  'wf-db-migration': {
    regex: [
      {
        code: 'WF-076-R1', severity: 'critical',
        message: 'DB migration active — DROP TABLE without safety check',
        patterns: [/DROP\s+TABLE/i],
        skipPatterns: [/IF\s+EXISTS/i, /--\s*safe/, /\/\/\s*intentional/i],
        fileFilter: /\.(sql|js|ts)$/
      }
    ]
  },

  // ── Testing & Verification ──
  'wf-tdd': {
    regex: [
      {
        code: 'WF-081-R1', severity: 'medium',
        message: 'TDD workflow active — test file should use describe/it or test() pattern',
        special: 'tdd-structure',
        fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
      }
    ]
  },
  'wf-e2e-suite': {
    file: [
      {
        code: 'WF-082-F1', severity: 'medium',
        message: 'E2E test suite active — E2E test directory required',
        paths: ['tests/e2e', 'test/e2e', 'e2e', 'cypress', '__e2e__'],
        anyOf: true,
        isDir: true
      }
    ]
  },

  // ── AI Resilience & Observability ──
  'wf-failure-pattern': {
    regex: [
      {
        code: 'WF-091-R1', severity: 'medium',
        message: 'Failure pattern workflow active — empty catch block silently swallows errors',
        patterns: [/catch\s*\([^)]*\)\s*\{\s*\}/],
        skipPatterns: [/\/\//, /\/\*/, /catch\s*\([^)]*\)\s*\{[^}]/],
        fileFilter: /\.(js|ts|tsx|jsx|mjs|cjs)$/,
        skipTest: true
      }
    ]
  },
  'wf-failsafe-eng': {
    regex: [
      {
        code: 'WF-092-R1', severity: 'medium',
        message: 'Fail-safe workflow active — Promise chain without .catch() handler risks unhandled rejection',
        patterns: [/new\s+Promise\s*\(/],
        skipPatterns: [/\.catch\s*\(/, /\/\//, /\/\*/],
        fileFilter: /\.(js|ts|tsx|jsx|mjs|cjs)$/,
        skipTest: true
      }
    ]
  },
  'wf-ai-gateway': {
    regex: [
      {
        code: 'WF-095-R1', severity: 'high',
        message: 'AI gateway workflow active — LLM API call without timeout or AbortSignal parameter',
        patterns: [/\.(chat|complete|completion|generate)\s*\(/],
        skipPatterns: [/timeout/, /signal/, /AbortSignal/, /AbortController/, /\/\//, /\/\*/],
        fileFilter: /\.(js|ts|tsx|jsx|mjs|cjs)$/,
        skipTest: true
      }
    ]
  },
  'wf-governance-evidence': {
    file: [
      {
        code: 'WF-097-F1', severity: 'medium',
        message: 'Governance evidence workflow active — decisions directory required for audit trail',
        paths: ['.ezra/decisions', 'docs/decisions'],
        anyOf: true,
        isDir: true
      }
    ]
  },
  'wf-hitl-approval': {
    regex: [
      {
        code: 'WF-098-R1', severity: 'high',
        message: 'HITL approval workflow active — deploy/publish/release call without confidence or threshold guard',
        patterns: [/\.(deploy|publish|release)\s*\(/],
        skipPatterns: [/confidence/, /threshold/, /approval/, /confirm/, /gate/, /\/\//, /\/\*/],
        fileFilter: /\.(js|ts|tsx|jsx|mjs|cjs)$/,
        skipTest: true
      }
    ]
  },

  // ── Planning & Architecture ──
  'wf-adr-creation': {
    file: [
      {
        code: 'WF-087-F1', severity: 'low',
        message: 'ADR workflow active — docs/adr directory recommended for architecture decisions',
        paths: ['docs/adr', 'docs/decisions', 'adr', '.decisions'],
        anyOf: true,
        isDir: true
      }
    ]
  },
};

// ═══════════════════════════════════════════════════════════════
// Check runners
// ═══════════════════════════════════════════════════════════════

/**
 * Run regex checks for a single template's rules against file content.
 */
function runTemplateRegexChecks(content, filePath, rules, existingCodes) {
  var violations = [];
  if (!rules || !rules.length) return violations;

  var lines = content.split('\n');
  var basename = path.basename(filePath);
  var isTestFile = /\.(test|spec)\.(js|ts|tsx|jsx)$/.test(basename) ||
                   /^test[-_]/.test(basename) ||
                   /__tests?__/.test(filePath);

  for (var ri = 0; ri < rules.length; ri++) {
    var rule = rules[ri];

    // Skip if already reported
    if (existingCodes.has(rule.code)) continue;

    // Check file filter
    if (rule.fileFilter && !rule.fileFilter.test(filePath)) continue;

    // Skip test files if flagged
    if (rule.skipTest && isTestFile) continue;

    // Handle special checks
    if (rule.special === 'require-test-file') {
      // Check if corresponding test file exists
      if (!isTestFile && /\.(js|ts|tsx|jsx)$/.test(filePath)) {
        var dir = path.dirname(filePath);
        var ext = path.extname(filePath);
        var base = path.basename(filePath, ext);
        var testExists = false;
        var testPatterns = [
          base + '.test' + ext,
          base + '.spec' + ext,
          '__tests__/' + base + ext,
        ];
        for (var ti = 0; ti < testPatterns.length; ti++) {
          if (fs.existsSync(path.join(dir, testPatterns[ti]))) {
            testExists = true;
            break;
          }
        }
        if (!testExists) {
          violations.push({
            code: rule.code,
            severity: rule.severity,
            message: rule.message,
            line: 1
          });
          existingCodes.add(rule.code);
        }
      }
      continue;
    }

    if (rule.special === 'tdd-structure') {
      // Only applies to test files — check they have test structure
      if (isTestFile) {
        var hasStructure = /\b(describe|it|test|expect|assert)\s*\(/.test(content);
        if (!hasStructure) {
          violations.push({
            code: rule.code,
            severity: rule.severity,
            message: rule.message,
            line: 1
          });
          existingCodes.add(rule.code);
        }
      }
      continue;
    }

    // Standard pattern matching
    if (!rule.patterns) continue;

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var matched = false;

      for (var pi = 0; pi < rule.patterns.length; pi++) {
        if (rule.patterns[pi].test(line)) {
          matched = true;
          break;
        }
      }

      if (!matched) continue;

      // Check skip patterns
      var skipped = false;
      if (rule.skipPatterns) {
        for (var si = 0; si < rule.skipPatterns.length; si++) {
          if (rule.skipPatterns[si].test(line)) {
            skipped = true;
            break;
          }
        }
      }

      if (!skipped) {
        violations.push({
          code: rule.code,
          severity: rule.severity,
          message: rule.message,
          line: li + 1
        });
        existingCodes.add(rule.code);
        break; // One violation per rule per file
      }
    }
  }

  return violations;
}

/**
 * Run file existence checks for a single template's rules.
 */
function runTemplateFileChecks(cwd, rules, existingCodes) {
  var violations = [];
  if (!rules || !rules.length) return violations;

  for (var fi = 0; fi < rules.length; fi++) {
    var rule = rules[fi];
    if (existingCodes.has(rule.code)) continue;

    if (rule.anyOf && rule.paths) {
      // At least one of the paths must exist
      var found = false;
      for (var pi = 0; pi < rule.paths.length; pi++) {
        var checkPath = path.join(cwd, rule.paths[pi]);
        if (rule.isDir) {
          try {
            if (fs.existsSync(checkPath) && fs.statSync(checkPath).isDirectory()) {
              found = true;
              break;
            }
          } catch (e) { /* ignore stat errors */ }
        } else {
          if (fs.existsSync(checkPath)) {
            found = true;
            break;
          }
        }
      }
      if (!found) {
        violations.push({
          code: rule.code,
          severity: rule.severity,
          message: rule.message,
          line: 0
        });
        existingCodes.add(rule.code);
      }
    } else if (rule.path) {
      var target = path.join(cwd, rule.path);
      if (!fs.existsSync(target)) {
        violations.push({
          code: rule.code,
          severity: rule.severity,
          message: rule.message,
          line: 0
        });
        existingCodes.add(rule.code);
      }
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════

/**
 * Run workflow enforcement checks.
 * @param {string} content - File content being written
 * @param {string} filePath - Absolute path of the file
 * @param {string} cwd - Project root directory
 * @param {object} wfSettings - Workflow settings from .ezra/settings.yaml
 * @param {object} context - { existingViolationCodes: Set }
 * @returns {Array} violations [{code, severity, message, line}]
 */
function runChecks(content, filePath, cwd, wfSettings, context) {
  if (!wfSettings) return [];

  var activeTemplates = wfSettings.active_templates;
  if (!activeTemplates || !Array.isArray(activeTemplates) || activeTemplates.length === 0) {
    return [];
  }

  var existingCodes = (context && context.existingViolationCodes) || new Set();
  var violations = [];

  for (var ai = 0; ai < activeTemplates.length; ai++) {
    var templateId = activeTemplates[ai];
    var checks = WORKFLOW_CHECKS[templateId];
    if (!checks) continue;

    // Run regex checks
    if (checks.regex) {
      var regexResults = runTemplateRegexChecks(content, filePath, checks.regex, existingCodes);
      for (var ri = 0; ri < regexResults.length; ri++) {
        violations.push(regexResults[ri]);
      }
    }

    // Run file checks
    if (checks.file) {
      var fileResults = runTemplateFileChecks(cwd, checks.file, existingCodes);
      for (var fci = 0; fci < fileResults.length; fci++) {
        violations.push(fileResults[fci]);
      }
    }
  }

  return violations;
}

/**
 * Get all template IDs that have enforcement checks.
 * @returns {string[]}
 */
function getEnforceableTemplates() {
  return Object.keys(WORKFLOW_CHECKS);
}

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  runChecks: runChecks,
  runTemplateRegexChecks: runTemplateRegexChecks,
  runTemplateFileChecks: runTemplateFileChecks,
  getEnforceableTemplates: getEnforceableTemplates,
  WORKFLOW_CHECKS: WORKFLOW_CHECKS
};
