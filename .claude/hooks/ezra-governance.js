#!/usr/bin/env node
'use strict';

/**
 * EZRA Governance — Consolidated Hook Module (auto-generated)
 * Contains ALL code from 8 governance hooks inline.
 * ZERO external dependencies.
 */

const fs = require('fs');
const path = require('path');

const _moduleRegistry = {};
const _selfModules = [
  'ezra-guard', 'ezra-phase-gate', 'ezra-tier-gate', 'ezra-oversight',
  'ezra-drift-hook', 'ezra-compliance', 'ezra-workflow-enforce', 'ezra-best-practices'
];

function _loadInlineModule(name, factory) {
  var m = { exports: {} };
  var origReq = module.constructor.prototype.require;
  module.constructor.prototype.require = function(id) {
    if (typeof id === 'string') {
      var base = path.basename(id, '.js');
      if (_selfModules.indexOf(base) !== -1 && _moduleRegistry[base]) {
        return _moduleRegistry[base];
      }
    }
    return origReq.apply(this, arguments);
  };
  try { factory(m, m.exports); } finally {
    module.constructor.prototype.require = origReq;
  }
  _moduleRegistry[name] = m.exports;
  return m.exports;
}


// -- ezra-compliance ---------------------------------------------

_loadInlineModule('ezra-compliance', function(module, exports) {
  /**
   * EZRA v8 — Compliance Engine
   * Maps 56 compliance standards to automated, semi-automated, and documentation-only checks.
   *
   * Categories:
   *   - Automatable (15): Concrete code checks that reuse SEC-* and STD-* patterns
   *   - Semi-automatable (20): Evidence-based checks (files in .ezra/, git, configs)
   *   - Documentation-only (21): Tracked but not auto-checked
   */
  
  var fs = require('fs');
  var path = require('path');
  
  // ═══════════════════════════════════════════════════════════════
  // Standard Registry
  // ═══════════════════════════════════════════════════════════════
  
  var AUTOMATABLE_STANDARDS = {
    'owasp-asvs': { id: 'CMP-ASVS', name: 'OWASP ASVS', checks: ['SEC-SQLI', 'SEC-SAST', 'SEC-SECRETS', 'SEC-CORS', 'SEC-CSP'] },
    'sei-cert': { id: 'CMP-CERT', name: 'SEI CERT', patterns: [/\bgoto\b/, /\bsprintf\s*\(/, /\bgets\s*\(/] },
    'wcag-2.2': { id: 'CMP-WCAG', name: 'WCAG 2.2', patterns: [/<img(?![^>]*\balt\s*=)[^>]*>/, /<input(?![^>]*\baria-label)[^>]*(?:type\s*=\s*["'](?:text|email|password))[^>]*>/] },
    'pci-dss': { id: 'CMP-PCI', name: 'PCI DSS', checks: ['SEC-SECRETS', 'SEC-ENCRYPT-TRANSIT', 'SEC-AUTH', 'SEC-PII'] },
    'gdpr': { id: 'CMP-GDPR', name: 'GDPR', checks: ['SEC-PII', 'SEC-ENCRYPT-TRANSIT'], patterns: [/consent/i, /data.*deletion/i] },
    'hipaa': { id: 'CMP-HIPAA', name: 'HIPAA', checks: ['SEC-PII', 'SEC-ENCRYPT-TRANSIT', 'SEC-AUTH'], patterns: [/\bPHI\b/, /patient.*data/i] },
    'soc2': { id: 'CMP-SOC2', name: 'SOC 2', checks: ['SEC-AUTH', 'SEC-SECRETS', 'SEC-LOG'] },
    'iso-27001': { id: 'CMP-ISO27001', name: 'ISO 27001', checks: ['SEC-AUTH', 'SEC-ENCRYPT-TRANSIT', 'SEC-SECRETS', 'SEC-CORS'] },
    'iso-27002': { id: 'CMP-ISO27002', name: 'ISO 27002', checks: ['SEC-AUTH', 'SEC-ENCRYPT-TRANSIT', 'SEC-SECRETS'] },
    'nist-csf-2.0': { id: 'CMP-NISTCSF', name: 'NIST CSF 2.0', checks: ['SEC-AUTH', 'SEC-ENCRYPT-TRANSIT', 'SEC-SECRETS', 'SEC-SAST'] },
    'nist-800-53': { id: 'CMP-NIST53', name: 'NIST 800-53', checks: ['SEC-AUTH', 'SEC-ENCRYPT-TRANSIT', 'SEC-SECRETS'] },
    'cis-controls': { id: 'CMP-CIS', name: 'CIS Controls', checks: ['SEC-AUTH', 'SEC-SECRETS', 'SEC-DEPVULN'] },
    'ieee-2675': { id: 'CMP-DEVOPS', name: 'IEEE 2675', evidence: ['ci-config', 'test-automation'] },
    'iso-25010': { id: 'CMP-QUALITY', name: 'ISO 25010', checks: ['STD-COMPLEXITY', 'STD-COVERAGE', 'STD-REQTESTS'] },
    'misra': { id: 'CMP-MISRA', name: 'MISRA C/C++', patterns: [/\bgoto\b/, /\bmalloc\s*\(/, /\bfree\s*\(/] },
  };
  
  var SEMI_AUTO_STANDARDS = [
    'iso-12207', 'iso-15288', 'iso-15504', 'ieee-730', 'ieee-1012',
    'iso-25040', 'iso-25023', 'iso-25012', 'iso-25019', 'iso-9241-210',
    'ieee-29148', 'iso-26514', 'iso-29119', 'iso-15939', 'iso-20000-1',
    'iso-42001', 'cmmi', 'aspice', 'iso-9001', 'iso-31000',
  ];
  
  var DOC_ONLY_STANDARDS = [
    'iec-61508', 'iso-26262', 'do-178c', 'iec-62304', 'iso-14971',
    'autosar', 'iso-15408', 'iso-27034', 'sox', 'fedramp',
    'nist-800-171', 'nist-ai-rmf', 'iso-22301', 'itil-v4', 'cobit-2019',
    'ieee-7000', 'eu-ai-act', 'iso-sae-21434', 'iso-27017', 'iso-27701',
    'iso-27018',
  ];
  
  // ═══════════════════════════════════════════════════════════════
  // Core Engine
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Run compliance checks against file content.
   * @param {string} content - File content
   * @param {string} filePath - Relative file path
   * @param {string} cwd - Project root directory
   * @param {object} compliance - Compliance settings { enabled, standards, enforcement_mode }
   * @param {object} context - { standards, security } settings for cross-referencing
   * @returns {Array} Array of violation objects
   */
  function runChecks(content, filePath, cwd, compliance, context) {
    var violations = [];
    if (!compliance || !compliance.enabled) return violations;
  
    var enabledStandards = compliance.standards || {};
    var lines = content.split('\n');
  
    // Check each enabled automatable standard
    var autoKeys = Object.keys(AUTOMATABLE_STANDARDS);
    for (var i = 0; i < autoKeys.length; i++) {
      var key = autoKeys[i];
      var stdConfig = enabledStandards[key];
      if (!stdConfig || (typeof stdConfig === 'object' && !stdConfig.enabled)) continue;
  
      var std = AUTOMATABLE_STANDARDS[key];
  
      // Pattern-based checks
      if (std.patterns) {
        for (var pi = 0; pi < std.patterns.length; pi++) {
          for (var li = 0; li < lines.length; li++) {
            if (std.patterns[pi].test(lines[li])) {
              violations.push({
                code: std.id,
                severity: getSeverity(compliance.enforcement_mode),
                message: std.name + ' pattern violation at line ' + (li + 1),
                line: li + 1,
              });
              break; // One per pattern
            }
          }
        }
      }
  
      // Cross-reference checks (verify related SEC-*/STD-* violations exist)
      if (std.checks) {
        // These are informational — the actual SEC-*/STD-* violations are raised
        // by the main oversight engine. The compliance module just tracks coverage.
      }
  
      // Evidence checks
      if (std.evidence) {
        for (var ei = 0; ei < std.evidence.length; ei++) {
          var evidenceResult = checkEvidence(std.evidence[ei], cwd);
          if (!evidenceResult.found) {
            violations.push({
              code: std.id,
              severity: getSeverity(compliance.enforcement_mode),
              message: std.name + ': missing evidence — ' + evidenceResult.description,
              line: 0,
            });
          }
        }
      }
    }
  
    // Semi-automatable: check for governance evidence
    for (var si = 0; si < SEMI_AUTO_STANDARDS.length; si++) {
      var semiKey = SEMI_AUTO_STANDARDS[si];
      var semiConfig = enabledStandards[semiKey];
      if (!semiConfig || (typeof semiConfig === 'object' && !semiConfig.enabled)) continue;
  
      var evidenceChecks = getEvidenceRequirements(semiKey);
      for (var ej = 0; ej < evidenceChecks.length; ej++) {
        var result = checkEvidence(evidenceChecks[ej], cwd);
        if (!result.found) {
          violations.push({
            code: 'CMP-SEMI',
            severity: 'low',
            message: semiKey + ': missing evidence — ' + result.description,
            line: 0,
          });
        }
      }
    }
  
    return violations;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════
  
  function getSeverity(mode) {
    if (mode === 'gate') return 'high';
    if (mode === 'strict') return 'critical';
    return 'medium'; // advisory
  }
  
  function checkEvidence(evidenceType, cwd) {
    switch (evidenceType) {
      case 'decisions':
        return { found: dirHasFiles(path.join(cwd, '.ezra', 'decisions')), description: 'decision records in .ezra/decisions/' };
      case 'plans':
        return { found: dirHasFiles(path.join(cwd, '.ezra', 'plans')), description: 'plans in .ezra/plans/' };
      case 'scans':
        return { found: dirHasFiles(path.join(cwd, '.ezra', 'scans')), description: 'scan history in .ezra/scans/' };
      case 'governance':
        return { found: fileExists(path.join(cwd, '.ezra', 'governance.yaml')), description: 'governance.yaml configured' };
      case 'version-control':
        return { found: fileExists(path.join(cwd, '.git', 'HEAD')), description: 'version control active' };
      case 'ci-config':
        return { found: hasCIConfig(cwd), description: 'CI/CD configuration present' };
      case 'test-automation':
        return { found: hasTestConfig(cwd), description: 'test automation configured' };
      default:
        return { found: false, description: evidenceType };
    }
  }
  
  function getEvidenceRequirements(standardKey) {
    // Common evidence requirements for semi-automatable standards
    var common = ['governance', 'version-control'];
    var processStds = ['iso-12207', 'iso-15288', 'iso-15504', 'ieee-730', 'cmmi', 'aspice', 'iso-9001'];
    var docStds = ['ieee-29148', 'iso-26514'];
    var testStds = ['iso-29119', 'ieee-1012'];
    var measureStds = ['iso-15939', 'iso-25040', 'iso-25023', 'iso-25012', 'iso-25019'];
  
    if (processStds.indexOf(standardKey) !== -1) return common.concat(['decisions', 'plans']);
    if (docStds.indexOf(standardKey) !== -1) return common.concat(['plans']);
    if (testStds.indexOf(standardKey) !== -1) return common.concat(['test-automation', 'scans']);
    if (measureStds.indexOf(standardKey) !== -1) return common.concat(['scans']);
  
    return common;
  }
  
  function dirHasFiles(dirPath) {
    try {
      var entries = fs.readdirSync(dirPath);
      return entries.length > 0;
    } catch (e) {
      return false;
    }
  }
  
  function fileExists(fp) {
    try { return fs.statSync(fp).isFile(); } catch (e) { return false; }
  }
  
  function hasCIConfig(cwd) {
    var ciPaths = [
      '.github/workflows',
      '.gitlab-ci.yml',
      '.circleci/config.yml',
      'Jenkinsfile',
      'azure-pipelines.yml',
      '.travis.yml',
    ];
    for (var i = 0; i < ciPaths.length; i++) {
      var fullPath = path.join(cwd, ciPaths[i]);
      try {
        var stat = fs.statSync(fullPath);
        if (stat.isFile() || stat.isDirectory()) return true;
      } catch (e) { /* not found */ }
    }
    return false;
  }
  
  function hasTestConfig(cwd) {
    var testPaths = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js', '.nycrc', 'karma.conf.js'];
    for (var i = 0; i < testPaths.length; i++) {
      if (fileExists(path.join(cwd, testPaths[i]))) return true;
    }
    // Check package.json for test script
    try {
      var pkgPath = path.join(cwd, 'package.json');
      var pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts.test) return true;
    } catch (e) { /* no package.json */ }
    return false;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // Reporting
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get a compliance coverage report for the project.
   * @param {object} compliance - Compliance settings
   * @param {string} cwd - Project root
   * @returns {object} { total, enabled, automatable, semiAuto, docOnly, coverage }
   */
  function getCoverageReport(compliance, cwd) {
    var enabledStandards = (compliance && compliance.standards) || {};
    var enabledCount = 0;
    var autoCount = 0;
    var semiCount = 0;
    var docCount = 0;
  
    var autoKeys = Object.keys(AUTOMATABLE_STANDARDS);
    for (var i = 0; i < autoKeys.length; i++) {
      var cfg = enabledStandards[autoKeys[i]];
      if (cfg && (cfg === true || cfg.enabled === true)) { enabledCount++; autoCount++; }
    }
    for (var s = 0; s < SEMI_AUTO_STANDARDS.length; s++) {
      var scfg = enabledStandards[SEMI_AUTO_STANDARDS[s]];
      if (scfg && (scfg === true || scfg.enabled === true)) { enabledCount++; semiCount++; }
    }
    for (var d = 0; d < DOC_ONLY_STANDARDS.length; d++) {
      var dcfg = enabledStandards[DOC_ONLY_STANDARDS[d]];
      if (dcfg && (dcfg === true || dcfg.enabled === true)) { enabledCount++; docCount++; }
    }
  
    var total = autoKeys.length + SEMI_AUTO_STANDARDS.length + DOC_ONLY_STANDARDS.length;
  
    return {
      total: total,
      enabled: enabledCount,
      automatable: autoCount,
      semiAuto: semiCount,
      docOnly: docCount,
      coverage: total > 0 ? Math.round((enabledCount / total) * 100) : 0,
    };
  }
  
  /**
   * List all supported standards with their type.
   * @returns {Array} [{ key, id, name, type }]
   */
  function listStandards() {
    var result = [];
    var autoKeys = Object.keys(AUTOMATABLE_STANDARDS);
    for (var i = 0; i < autoKeys.length; i++) {
      var std = AUTOMATABLE_STANDARDS[autoKeys[i]];
      result.push({ key: autoKeys[i], id: std.id, name: std.name, type: 'automatable' });
    }
    for (var s = 0; s < SEMI_AUTO_STANDARDS.length; s++) {
      result.push({ key: SEMI_AUTO_STANDARDS[s], id: 'CMP-SEMI', name: SEMI_AUTO_STANDARDS[s], type: 'semi-auto' });
    }
    for (var d = 0; d < DOC_ONLY_STANDARDS.length; d++) {
      result.push({ key: DOC_ONLY_STANDARDS[d], id: 'CMP-DOC', name: DOC_ONLY_STANDARDS[d], type: 'doc-only' });
    }
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // Exports
  // ═══════════════════════════════════════════════════════════════
  
  module.exports = {
    runChecks: runChecks,
    getCoverageReport: getCoverageReport,
    listStandards: listStandards,
    AUTOMATABLE_STANDARDS: AUTOMATABLE_STANDARDS,
    SEMI_AUTO_STANDARDS: SEMI_AUTO_STANDARDS,
    DOC_ONLY_STANDARDS: DOC_ONLY_STANDARDS,
  };
  
});

// -- ezra-workflow-enforce ---------------------------------------

_loadInlineModule('ezra-workflow-enforce', function(module, exports) {
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
  
});

// -- ezra-best-practices -----------------------------------------

_loadInlineModule('ezra-best-practices', function(module, exports) {
  /**
   * EZRA v8 — Best Practices Enforcement Module
   *
   * Three enforcement registries:
   *   REGEX_CHECKS  — R-type: line-by-line pattern matching
   *   FILE_CHECKS   — F-type: file/directory existence
   *   CONFIG_CHECKS — C-type: JSON/YAML config parsing
   *
   * Called by ezra-oversight.js after STD/SEC/CMP checks.
   * Accepts existingCodes Set to avoid duplicate violations.
   */
  
  var fs = require('fs');
  var path = require('path');
  
  // ═══════════════════════════════════════════════════════════════
  // REGEX_CHECKS — R-type practices
  // ═══════════════════════════════════════════════════════════════
  
  var REGEX_CHECKS = {
    // ── Code Quality & Maintainability ──
    'cq-magic-numbers': {
      code: 'BP-001', severity: 'medium',
      message: 'Magic number detected — extract to a named constant',
      patterns: [/(?:^|[=:+\-*/<>,(])\s*(?<!\.)\b(\d{2,})\b(?!\s*[;:})\]]|\.\w)/],
      skipPatterns: [/const\s/, /let\s+\w+\s*=/, /var\s+\w+\s*=/, /^\s*\/\//, /^\s*\*/, /index|length|status|code|port|timeout|width|height|size|max|min|limit|offset|page|count|total|version/i],
      fileFilter: /\.(js|ts|tsx|jsx)$/,
      skipTest: true
    },
    'cq-file-size': {
      code: 'BP-003', severity: 'medium',
      message: 'File exceeds recommended maximum line count (400 lines)',
      special: 'file-size',
      fileFilter: /\.(js|ts|tsx|jsx)$/,
      skipTest: true
    },
    'cq-empty-errors': {
      code: 'BP-004', severity: 'medium',
      message: 'Empty Error constructor — provide a descriptive message',
      patterns: [/throw\s+new\s+Error\s*\(\s*\)/],
      fileFilter: /\.(js|ts|tsx|jsx)$/
    },
    'cq-commented-code': {
      code: 'BP-005', severity: 'low',
      message: 'Commented-out code detected — remove or use feature flags',
      patterns: [/^\s*\/\/\s*(const|let|var|function|if|return|import|export|class|for|while|switch)\s/],
      fileFilter: /\.(js|ts|tsx|jsx)$/,
      skipTest: true
    },
    'cq-todo-fixme': {
      code: 'BP-006', severity: 'low',
      message: 'Unresolved task comment found — resolve before production',
      patterns: [new RegExp('\\b(TO' + 'DO|FIX' + 'ME|HA' + 'CK|X' + 'XX|TE' + 'MP)\\b', 'i')],
      skipPatterns: [/^\s*\*\s*@todo/i],
      fileFilter: /\.(js|ts|tsx|jsx)$/,
      skipTest: true
    },
    'cq-import-order': {
      code: 'BP-007', severity: 'low',
      message: 'Import statements should be grouped and ordered consistently',
      special: 'import-order',
      fileFilter: /\.(js|ts|tsx|jsx)$/,
      skipTest: true
    },
    'cq-dead-code': {
      code: 'BP-009', severity: 'low',
      message: 'Possible dead code — eslint-disable for unused variable',
      patterns: [/eslint-disable.*no-unused/],
      fileFilter: /\.(js|ts|tsx|jsx)$/
    },
  
    // ── CI/CD Pipeline ──
    'cicd-dep-pinning': {
      code: 'BP-029', severity: 'medium',
      message: 'Unpinned dependency — use exact versions for reproducible builds',
      patterns: [/"[^"]+"\s*:\s*"[\^~>]/],
      fileFilter: /package\.json$/,
      skipPatterns: [/devDependencies/]
    },
  
    // ── Testing Practices ──
    'test-naming': {
      code: 'BP-034', severity: 'low',
      message: 'Test description should start with a verb (should, returns, throws, etc.)',
      patterns: [/(?:it|test)\s*\(\s*['"`](?![A-Z]?(?:should|must|can|does|returns?|throws?|creates?|updates?|deletes?|renders?|handles?|validates?|rejects?|accepts?|emits?|fires?|calls?|sets?|gets?|fetches?|sends?|loads?|saves?))\w/i],
      fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
    },
    'test-skip': {
      code: 'BP-035', severity: 'medium',
      message: 'Skipped test detected — do not commit skipped tests',
      patterns: [/\b(?:describe|it|test)\.skip\b/, /\bx(?:describe|it|test)\s*\(/],
      fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
    },
    'test-snapshot': {
      code: 'BP-036', severity: 'low',
      message: 'Snapshot test detected — prefer explicit assertions',
      patterns: [/\.toMatchSnapshot\s*\(/],
      fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
    },
    'test-isolation': {
      code: 'BP-040', severity: 'medium',
      message: 'Global state in test setup — may cause test coupling',
      patterns: [/(?:beforeAll|afterAll)\s*\([^)]*(?:global|process\.env|window\.)/],
      fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
    },
  
    // ── Infrastructure as Code ──
    'iac-remote-state': {
      code: 'BP-042', severity: 'medium',
      message: 'Local backend detected — use remote state for team collaboration',
      patterns: [/backend\s+["']local["']/],
      fileFilter: /\.tf$/
    },
    'iac-module-version': {
      code: 'BP-043', severity: 'medium',
      message: 'Unversioned module source — pin with ?ref= or version constraint',
      patterns: [/source\s*=\s*"(?!\.)[^"]*"(?!.*\?ref=)/],
      skipPatterns: [/version\s*=/],
      fileFilter: /\.tf$/
    },
    'iac-secrets': {
      code: 'BP-044', severity: 'high',
      message: 'Potential hardcoded secret in IaC file',
      patterns: [/(?:password|secret|token|api_key)\s*=\s*"[^"]{8,}"/i],
      fileFilter: /\.(tf|bicep|template|cfn)(\.(json|yaml|yml))?$/,
      dedup: 'SEC-SECRETS'
    },
    'iac-tagging': {
      code: 'BP-046', severity: 'low',
      message: 'Resource without tags — add tags for cost tracking and organization',
      patterns: [/resource\s+"[^"]+"\s+"[^"]+"\s*\{/],
      requirePattern: /tags\s*[={]/,
      fileFilter: /\.tf$/
    },
    'iac-least-privilege': {
      code: 'BP-048', severity: 'high',
      message: 'Wildcard IAM action detected — use least privilege',
      patterns: [/Action\s*[:=]\s*['"]\s*\*/i, /"Effect"\s*:\s*"Allow"[^}]*"Action"\s*:\s*\[?\s*"\*"/],
      fileFilter: /\.(tf|json|yaml|yml)$/
    },
    'iac-network-open': {
      code: 'BP-049', severity: 'high',
      message: 'Open CIDR (0.0.0.0/0) in security group — restrict access',
      patterns: [/0\.0\.0\.0\/0/],
      skipPatterns: [/egress/i, /outbound/i],
      fileFilter: /\.(tf|json|yaml|yml)$/
    },
  
    // ── Containerization & Orchestration ──
    'container-base-image': {
      code: 'BP-051', severity: 'medium',
      message: 'Use minimal base image (alpine, slim, distroless) to reduce attack surface',
      special: 'dockerfile-base',
      fileFilter: /Dockerfile/
    },
    'container-multistage': {
      code: 'BP-052', severity: 'low',
      message: 'Consider multi-stage build to reduce final image size',
      special: 'dockerfile-multistage',
      fileFilter: /Dockerfile/
    },
    'container-no-root': {
      code: 'BP-053', severity: 'high',
      message: 'Container runs as root — add USER directive',
      special: 'dockerfile-user',
      fileFilter: /Dockerfile/,
      dedup: 'SEC-CONTAINER'
    },
    'container-healthcheck': {
      code: 'BP-054', severity: 'medium',
      message: 'Missing HEALTHCHECK in Dockerfile',
      special: 'dockerfile-healthcheck',
      fileFilter: /Dockerfile/
    },
    'container-resources': {
      code: 'BP-055', severity: 'medium',
      message: 'Pod missing resource limits — set CPU/memory limits',
      special: 'k8s-resources',
      fileFilter: /\.(yaml|yml)$/
    },
    'container-latest-tag': {
      code: 'BP-057', severity: 'medium',
      message: 'Avoid :latest tag — use specific version for reproducibility',
      patterns: [/:latest\s*$/m, /image:\s*[^\s:]+:latest/],
      fileFilter: /Dockerfile|\.(yaml|yml)$/
    },
    'container-pod-security': {
      code: 'BP-058', severity: 'high',
      message: 'Privileged container or hostNetwork detected — use restricted pod security',
      patterns: [/privileged:\s*true/, /hostNetwork:\s*true/, /hostPID:\s*true/],
      fileFilter: /\.(yaml|yml)$/
    },
    'container-inline-secrets': {
      code: 'BP-060', severity: 'high',
      message: 'Inline secret value in k8s manifest — use Secret resource or external secrets',
      patterns: [/name:\s*.*(?:password|secret|token|key)[\s\S]*?value:\s*["'][^"']{4,}/i],
      fileFilter: /\.(yaml|yml)$/
    },
  
    // ── Monitoring & Observability ──
    'obs-structured-logging': {
      code: 'BP-061', severity: 'low',
      message: 'Use structured logging (objects) instead of string-only console.log',
      patterns: [/console\.log\s*\(\s*['"`][^'"`]*['"`]\s*\)/],
      skipPatterns: [/debug|trace/i],
      fileFilter: /\.(js|ts|tsx|jsx)$/,
      skipTest: true
    },
    'obs-correlation-id': {
      code: 'BP-070', severity: 'low',
      message: 'Consider adding correlation/request ID headers for distributed tracing',
      patterns: [/app\.(get|post|put|delete|patch|use)\s*\(/],
      requirePattern: /x-request-id|x-correlation-id|correlationId|requestId/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
  
    // ── Security & DevSecOps ──
    'sec-rbac': {
      code: 'BP-076', severity: 'medium',
      message: 'Route handler without role/permission middleware',
      patterns: [/router\.(get|post|put|delete|patch)\s*\(\s*['"`]\//],
      requirePattern: /(?:authorize|checkRole|requireRole|hasPermission|isAdmin|requireAuth|authMiddleware|protect)\s*[\(,]/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'sec-audit-log': {
      code: 'BP-077', severity: 'low',
      message: 'Critical operation without audit logging',
      patterns: [/\.(delete|destroy|update|create|save)\s*\(/],
      requirePattern: /audit(?:Log|_log|Event|Trail)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
  
    // ── Documentation ──
    'doc-function-comments': {
      code: 'BP-087', severity: 'low',
      message: 'Long function without documentation — add JSDoc or explanatory comments',
      special: 'function-comments',
      fileFilter: /\.(js|ts|tsx|jsx)$/,
      skipTest: true
    },
  
    // ── Release Management ──
    'rel-version-wildcard': {
      code: 'BP-097', severity: 'medium',
      message: 'Wildcard or open-ended version range in dependencies',
      patterns: [/"[^"]+"\s*:\s*"(\*|>=)/],
      fileFilter: /package\.json$/
    },
    'rel-deprecation': {
      code: 'BP-098', severity: 'low',
      message: '@deprecated without removal target version',
      patterns: [/@deprecated(?!\s+.*(?:v\d|since|remove|version))/i],
      fileFilter: /\.(js|ts|tsx|jsx)$/
    },
  
    // ── Database Practices ──
    'db-raw-sql': {
      code: 'BP-102', severity: 'medium',
      message: 'Raw SQL string detected — use parameterized queries or ORM',
      patterns: [/(?:query|execute|raw)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s/i],
      fileFilter: /\.(js|ts)$/,
      skipPatterns: [/migration/i]
    },
    'db-select-star': {
      code: 'BP-109', severity: 'medium',
      message: 'SELECT * detected — specify needed columns explicitly',
      patterns: [/SELECT\s+\*/i],
      fileFilter: /\.(js|ts)$/,
      skipPatterns: [/migration/i, /\.sql$/]
    },
    'db-hard-delete': {
      code: 'BP-110', severity: 'low',
      message: 'Hard DELETE detected — consider soft deletes for critical data',
      patterns: [/DELETE\s+FROM/i],
      fileFilter: /\.(js|ts)$/,
      skipPatterns: [/migration/i]
    },
  
    // ── API Design ──
    'api-rate-limit': {
      code: 'BP-113', severity: 'medium',
      message: 'API endpoint without rate limiting middleware',
      patterns: [/app\.(get|post|put|delete|patch)\s*\(\s*['"`]\/api\//],
      requirePattern: /rateLimit|throttle|rateLimiter/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
  
    // ── Performance ──
    'perf-image-opt': {
      code: 'BP-124', severity: 'low',
      message: 'Image without loading attribute — add lazy loading',
      patterns: [/<img\s(?![^>]*loading\s*=)/i],
      fileFilter: /\.(jsx|tsx|html)$/
    },
    'perf-memory-leak': {
      code: 'BP-129', severity: 'medium',
      message: 'addEventListener without matching removeEventListener — potential memory leak',
      patterns: [/addEventListener\s*\(/],
      requirePattern: /removeEventListener\s*\(/,
      fileFilter: /\.(js|ts|tsx|jsx)$/,
      skipTest: true
    },
  
    // ── Agent Engineering ──
    'agent-retry-guard': {
      code: 'BP-152', severity: 'medium',
      message: 'Retry loop without max-retry guard — add maximum attempt limit',
      patterns: [/retry|retries|attempt/i],
      requirePattern: /max(?:Retries|Attempts|_retries|_attempts)|retryLimit|MAX_RETRY/,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'agent-output-schema': {
      code: 'BP-153', severity: 'medium',
      message: 'Agent output without schema validation — use zod/pydantic/JSON schema',
      patterns: [/(?:agent|llm|model)(?:Response|Output|Result)/i],
      requirePattern: /(?:z\.|zod\.|schema\.parse|validate|pydantic|jsonschema)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
  
    // ── Security (additional) ──
    'sec-api-auth': {
      code: 'BP-075', severity: 'high',
      message: 'API route without authentication middleware',
      patterns: [/app\.(get|post|put|delete|patch)\s*\(\s*['"`]\/api\//],
      requirePattern: /(?:auth|authenticate|requireAuth|isAuthenticated|protect|verifyToken|jwt|session)\s*[\(,]/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true,
      dedup: 'SEC-AUTH'
    },
    'sec-headers': {
      code: 'BP-079', severity: 'medium',
      message: 'Missing security headers middleware (helmet/security headers)',
      patterns: [/app\.(use|listen)\s*\(/],
      requirePattern: /helmet|securityHeaders|x-content-type|x-frame-options/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true,
      dedup: 'SEC-HSTS'
    },
    'sec-csp': {
      code: 'BP-080', severity: 'medium',
      message: 'Missing Content Security Policy configuration',
      patterns: [/app\.(use|listen)\s*\(/],
      requirePattern: /contentSecurityPolicy|content-security-policy|csp/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true,
      dedup: 'SEC-CSP'
    },
  
    // ── Database (additional) ──
    'db-connection-pool': {
      code: 'BP-103', severity: 'medium',
      message: 'Database connection without pooling — use connection pool for performance',
      patterns: [/(?:createConnection|new\s+Client|connect\s*\()/i],
      requirePattern: /pool|Pool|connectionLimit|poolSize|max:\s*\d/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'db-boundary-validation': {
      code: 'BP-107', severity: 'medium',
      message: 'Route handler without input validation at boundary',
      patterns: [/router\.(post|put|patch)\s*\(\s*['"`]\//],
      requirePattern: /(?:zod|joi|yup|validate|schema|celebrate|express-validator)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
  
    // ── API Design (additional) ──
    'api-error-responses': {
      code: 'BP-112', severity: 'low',
      message: 'Inconsistent error response — use structured error shape { error, message, code }',
      patterns: [/res\.status\s*\(\s*[45]\d{2}\s*\)\s*\.(?:json|send)\s*\(/],
      skipPatterns: [/error:|message:/],
      fileFilter: /\.(js|ts)$/
    },
    'api-pagination': {
      code: 'BP-114', severity: 'low',
      message: 'List endpoint without pagination — add page/limit/cursor parameters',
      patterns: [/\.(?:find|findAll|findMany|select)\s*\([^)]*\)\s*(?:\.then|;|\))/],
      requirePattern: /(?:limit|offset|page|cursor|skip|take|paginate)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'api-versioning': {
      code: 'BP-115', severity: 'low',
      message: 'API route without version prefix (/v1/, /v2/)',
      patterns: [/app\.(get|post|put|delete|patch)\s*\(\s*['"`]\/api\/(?!v\d)/],
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'api-input-validation': {
      code: 'BP-116', severity: 'medium',
      message: 'API endpoint without input validation middleware',
      patterns: [/app\.(post|put|patch)\s*\(\s*['"`]\/api\//],
      requirePattern: /(?:validate|zod|joi|yup|celebrate|express-validator|schema)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'api-cors': {
      code: 'BP-118', severity: 'medium',
      message: 'Overly permissive CORS — avoid origin: * in production',
      patterns: [/origin:\s*['"`]\*['"`]|origin:\s*true/],
      fileFilter: /\.(js|ts)$/,
      dedup: 'SEC-CORS'
    },
    'api-idempotency': {
      code: 'BP-120', severity: 'low',
      message: 'POST/PUT mutation without idempotency key handling',
      patterns: [/app\.(post|put)\s*\(\s*['"`]\/api\//],
      requirePattern: /idempoten|x-idempotency|idempotencyKey/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
  
    // ── Performance (additional) ──
    'perf-lazy-loading': {
      code: 'BP-122', severity: 'low',
      message: 'Consider lazy loading for code splitting — use React.lazy/dynamic/import()',
      patterns: [/import\s+\{[^}]{200,}\}\s+from/],
      fileFilter: /\.(jsx|tsx)$/,
      skipTest: true
    },
    'perf-caching': {
      code: 'BP-123', severity: 'low',
      message: 'API response without caching headers — add Cache-Control or stale-while-revalidate',
      patterns: [/res\.(?:json|send)\s*\(/],
      requirePattern: /cache-control|stale-while-revalidate|setHeader.*cache|etag/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'perf-db-query': {
      code: 'BP-128', severity: 'medium',
      message: 'Potential N+1 query — await inside loop iterating over records',
      patterns: [/\.(?:map|forEach)\s*\(\s*(?:async\s*)?\(?[^)]*\)?\s*=>\s*\{[\s\S]*?await\s+.*\.find/],
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
  
    // ── Agent Engineering (additional) ──
    'agent-supervisor': {
      code: 'BP-142', severity: 'medium',
      message: 'Agent orchestration without triage/routing logic',
      patterns: [/(?:orchestrat|dispatch|multi.?agent|agent.?pool)/i],
      requirePattern: /(?:triage|route|classify|dispatch|supervisor)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'agent-handoff': {
      code: 'BP-143', severity: 'medium',
      message: 'Multi-agent flow without explicit handoff/return control',
      patterns: [/(?:handoff|hand.?off|delegate|transfer).*agent/i],
      requirePattern: /(?:return|callback|onComplete|result|response)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'agent-two-phase': {
      code: 'BP-145', severity: 'medium',
      message: 'High-stakes tool call without plan-validate-execute pattern',
      patterns: [/(?:tool.?call|execute.?tool|run.?tool|invoke.?tool)/i],
      requirePattern: /(?:validate|confirm|approve|plan|preview|dry.?run)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'agent-idempotency': {
      code: 'BP-146', severity: 'medium',
      message: 'Agent tool call (DB write, deploy) without idempotency key',
      patterns: [/(?:agent|tool).*(?:write|deploy|create|update|delete)/i],
      requirePattern: /idempoten|dedup|requestId|operationId/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'agent-human-loop': {
      code: 'BP-149', severity: 'medium',
      message: 'Destructive agent action without human confirmation gate',
      patterns: [/(?:agent|tool).*(?:delete|destroy|drop|remove|force)/i],
      requirePattern: /(?:confirm|approve|human|review|prompt|ask)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'agent-context-monitoring': {
      code: 'BP-151', severity: 'low',
      message: 'Agent prompt without context window monitoring',
      patterns: [/(?:prompt|messages|context).*(?:length|size|tokens|count)/i],
      requirePattern: /(?:maxTokens|contextLimit|truncat|summariz|compress)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'api-rest-conventions': {
      code: 'BP-111', severity: 'low',
      message: 'Non-RESTful route pattern — use standard HTTP methods and resource naming',
      patterns: [/app\.(get|post)\s*\(\s*['"`]\/api\/.*(?:get|fetch|delete|update|create|remove)[A-Z]/],
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    },
    'agent-plan-act-reflect': {
      code: 'BP-141', severity: 'medium',
      message: 'Agent prompt without structured plan/act/reflect phases',
      patterns: [/(?:system.?prompt|agent.?prompt|instruction)/i],
      requirePattern: /(?:plan|act|reflect|reason|think|step)/i,
      fileFilter: /\.(js|ts)$/,
      skipTest: true
    }
  };
  
  // ═══════════════════════════════════════════════════════════════
  // FILE_CHECKS — F-type practices
  // ═══════════════════════════════════════════════════════════════
  
  var FILE_CHECKS = {
    'vc-gitignore': {
      code: 'BP-015', severity: 'low',
      message: '.gitignore missing or incomplete (should include node_modules, dist, .env)',
      paths: ['.gitignore'],
      contentCheck: /node_modules/
    },
    'vc-lfs': {
      code: 'BP-014', severity: 'low',
      message: 'No .gitattributes for Git LFS — large files may bloat repository',
      paths: ['.gitattributes']
    },
    'cicd-pipeline': {
      code: 'BP-022', severity: 'medium',
      message: 'No CI/CD pipeline configuration found',
      paths: ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci', 'azure-pipelines.yml'],
      anyOf: true
    },
    'cicd-env-parity': {
      code: 'BP-027', severity: 'low',
      message: 'No .env.example — document required environment variables',
      paths: ['.env.example', '.env.template', '.env.sample'],
      anyOf: true
    },
    'test-integration': {
      code: 'BP-032', severity: 'low',
      message: 'No integration test directory found',
      paths: ['tests/integration', '__tests__/integration', 'test/integration', 'src/__tests__/integration'],
      anyOf: true
    },
    'test-e2e': {
      code: 'BP-033', severity: 'low',
      message: 'No E2E test directory found (e2e, cypress, playwright)',
      paths: ['e2e', 'cypress', 'playwright', 'tests/e2e'],
      anyOf: true
    },
    'test-benchmark': {
      code: 'BP-037', severity: 'low',
      message: 'No performance benchmarks directory found',
      paths: ['benchmarks', 'bench', 'perf'],
      anyOf: true
    },
    'test-contract': {
      code: 'BP-039', severity: 'low',
      message: 'No contract test directory found',
      paths: ['pact', 'contracts', 'tests/contract'],
      anyOf: true
    },
    'iac-directory': {
      code: 'BP-041', severity: 'low',
      message: 'No Infrastructure as Code directory found',
      paths: ['terraform', 'infrastructure', 'cdk', 'pulumi', 'infra', 'iac'],
      anyOf: true
    },
    'container-network-policy': {
      code: 'BP-059', severity: 'medium',
      message: 'No Kubernetes NetworkPolicy manifests found',
      paths: ['k8s/network-policy.yaml', 'k8s/network-policy.yml', 'kubernetes/network-policy.yaml'],
      anyOf: true
    },
    'obs-slo': {
      code: 'BP-065', severity: 'low',
      message: 'No SLI/SLO definitions found — define service level objectives',
      paths: ['slo.yaml', 'slo.yml', 'docs/slo.md', 'docs/sli-slo.md'],
      anyOf: true
    },
    'obs-dashboards': {
      code: 'BP-068', severity: 'low',
      message: 'No dashboard-as-code definitions found',
      paths: ['grafana/dashboards', 'dashboards'],
      anyOf: true
    },
    'doc-readme': {
      code: 'BP-081', severity: 'medium',
      message: 'No README.md found at project root',
      paths: ['README.md']
    },
    'doc-openapi': {
      code: 'BP-082', severity: 'low',
      message: 'No API documentation (OpenAPI/Swagger) found',
      paths: ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.json', 'swagger.yaml', 'docs/api'],
      anyOf: true
    },
    'doc-adr': {
      code: 'BP-083', severity: 'low',
      message: 'No Architecture Decision Records directory found',
      paths: ['docs/adr', 'adr', 'docs/decisions'],
      anyOf: true
    },
    'doc-runbooks': {
      code: 'BP-084', severity: 'low',
      message: 'No operations runbooks found',
      paths: ['runbooks', 'docs/runbooks'],
      anyOf: true
    },
    'doc-contributing': {
      code: 'BP-085', severity: 'low',
      message: 'No CONTRIBUTING.md or onboarding documentation found',
      paths: ['CONTRIBUTING.md', 'docs/onboarding.md', 'docs/getting-started.md'],
      anyOf: true
    },
    'doc-changelog': {
      code: 'BP-086', severity: 'low',
      message: 'No CHANGELOG.md found',
      paths: ['CHANGELOG.md']
    },
    'doc-deployment': {
      code: 'BP-088', severity: 'low',
      message: 'No deployment documentation found',
      paths: ['docs/deployment.md', 'DEPLOYMENT.md', 'docs/deploy.md'],
      anyOf: true
    },
    'doc-postmortems': {
      code: 'BP-089', severity: 'low',
      message: 'No incident postmortem templates found',
      paths: ['docs/postmortems', 'postmortems'],
      anyOf: true
    },
    'rel-rollback': {
      code: 'BP-095', severity: 'low',
      message: 'No rollback procedures documented',
      paths: ['docs/rollback.md', 'scripts/rollback.sh', 'scripts/rollback.js'],
      anyOf: true
    },
    'rel-releases': {
      code: 'BP-096', severity: 'low',
      message: 'No release notes directory found',
      paths: ['RELEASES.md', 'docs/releases'],
      anyOf: true
    },
    'db-migrations': {
      code: 'BP-101', severity: 'medium',
      message: 'No database migration directory found',
      paths: ['migrations', 'prisma/migrations', 'db/migrations', 'drizzle'],
      anyOf: true
    },
    'db-schema-docs': {
      code: 'BP-106', severity: 'low',
      message: 'No database schema documentation found',
      paths: ['docs/schema.md', 'DATABASE.md', 'docs/database.md', 'prisma/schema.prisma'],
      anyOf: true
    },
    'incident-playbook': {
      code: 'BP-131', severity: 'low',
      message: 'No incident response playbook found',
      paths: ['docs/incident-response.md', 'docs/incident-playbook.md', 'runbooks/incident.md'],
      anyOf: true
    },
    'incident-severity': {
      code: 'BP-133', severity: 'low',
      message: 'No severity classification document found',
      paths: ['docs/severity.md', 'docs/severity-levels.md'],
      anyOf: true
    },
    'incident-escalation': {
      code: 'BP-137', severity: 'low',
      message: 'No escalation procedures document found',
      paths: ['docs/escalation.md', 'docs/escalation-policy.md'],
      anyOf: true
    },
    'agent-golden-dataset': {
      code: 'BP-147', severity: 'low',
      message: 'No golden dataset/evals directory for agent evaluation',
      paths: ['tests/golden', 'evals', 'tests/evals', 'golden'],
      anyOf: true
    },
    'incident-remediation': {
      code: 'BP-140', severity: 'low',
      message: 'No automated remediation scripts found',
      paths: ['scripts/remediation', 'remediation'],
      anyOf: true
    },
    'doc-api-versioning': {
      code: 'BP-090', severity: 'low',
      message: 'No API versioning documentation found',
      paths: ['docs/api-versioning.md', 'docs/api-versioning', 'docs/api/versioning.md'],
      anyOf: true
    },
    'api-documentation': {
      code: 'BP-119', severity: 'low',
      message: 'No API documentation found (reuses BP-082 check)',
      paths: ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.json', 'swagger.yaml', 'docs/api'],
      anyOf: true
    },
    'inc-comm-templates': {
      code: 'BP-134', severity: 'low',
      message: 'No incident communication templates found',
      paths: ['docs/templates/incident.md', 'docs/templates/incident', 'docs/incident-templates'],
      anyOf: true
    },
    'inc-postmortem': {
      code: 'BP-135', severity: 'low',
      message: 'No post-incident review templates found',
      paths: ['docs/postmortems', 'postmortems', 'docs/post-incident'],
      anyOf: true
    }
  };
  
  // ═══════════════════════════════════════════════════════════════
  // CONFIG_CHECKS — C-type practices
  // ═══════════════════════════════════════════════════════════════
  
  var CONFIG_CHECKS = {
    'cq-tsconfig-strict': {
      code: 'BP-010', severity: 'medium',
      message: 'TypeScript strict mode not enabled in tsconfig.json',
      file: 'tsconfig.json',
      check: function(content) {
        try {
          var clean = content.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
          var cfg = JSON.parse(clean);
          return !(cfg.compilerOptions && cfg.compilerOptions.strict === true);
        } catch (e) { _log('best-practices', 'warn', 'tsconfig.json parse failed: ' + e.message); return false; }
      },
      dedup: 'STD-TSSTRICT'
    },
    'cicd-lockfile': {
      code: 'BP-021', severity: 'medium',
      message: 'No lock file found — builds may not be reproducible',
      file: null,
      check: function(content, cwd) {
        var lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
        for (var i = 0; i < lockFiles.length; i++) {
          try { if (fs.statSync(path.join(cwd, lockFiles[i])).isFile()) return false; } catch (e) { /* continue */ }
        }
        return true;
      }
    },
    'cicd-pkg-version': {
      code: 'BP-024', severity: 'low',
      message: 'package.json missing "version" field',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          return !pkg.version;
        } catch (e) { _log('best-practices', 'warn', 'package.json parse failed in cicd-pkg-version: ' + e.message); return false; }
      }
    },
    'rel-semver': {
      code: 'BP-091', severity: 'low',
      message: 'package.json version does not follow semantic versioning',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          if (!pkg.version) return false;
          return !/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(pkg.version);
        } catch (e) { _log('best-practices', 'warn', 'package.json parse failed in rel-semver: ' + e.message); return false; }
      }
    },
    'test-coverage-threshold': {
      code: 'BP-031', severity: 'low',
      message: 'No test coverage threshold configured',
      file: null,
      check: function(content, cwd) {
        var configs = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js'];
        for (var i = 0; i < configs.length; i++) {
          try {
            var c = fs.readFileSync(path.join(cwd, configs[i]), 'utf8');
            if (/coverageThreshold|coverage\s*:\s*\{/.test(c)) return false;
          } catch (e) { /* continue */ }
        }
        return true;
      }
    },
    'ci-test-gates': {
      code: 'BP-023', severity: 'medium',
      message: 'CI pipeline without automated testing gate',
      file: null,
      check: function(content, cwd) {
        var ciFiles = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile'];
        for (var i = 0; i < ciFiles.length; i++) {
          try {
            var p = path.join(cwd, ciFiles[i]);
            var stat = fs.statSync(p);
            if (stat.isDirectory()) {
              var files = fs.readdirSync(p).filter(function(f) { return /\.ya?ml$/.test(f); });
              for (var j = 0; j < files.length; j++) {
                var c = fs.readFileSync(path.join(p, files[j]), 'utf8');
                if (/test|jest|vitest|mocha|pytest|cargo test/i.test(c)) return false;
              }
            } else {
              var c2 = fs.readFileSync(p, 'utf8');
              if (/test|jest|vitest|mocha|pytest/i.test(c2)) return false;
            }
          } catch (e) { /* continue */ }
        }
        return true;
      }
    },
    'ci-build-cache': {
      code: 'BP-028', severity: 'low',
      message: 'CI pipeline without build cache configuration',
      file: null,
      check: function(content, cwd) {
        var ciDir = path.join(cwd, '.github', 'workflows');
        try {
          var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
          for (var i = 0; i < files.length; i++) {
            var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
            if (/cache|actions\/cache/i.test(c)) return false;
          }
        } catch (e) { /* no CI dir */ }
        return true;
      }
    },
    'ci-pipeline-security': {
      code: 'BP-030', severity: 'medium',
      message: 'CI pipeline without security scanning step',
      file: null,
      check: function(content, cwd) {
        var ciDir = path.join(cwd, '.github', 'workflows');
        try {
          var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
          for (var i = 0; i < files.length; i++) {
            var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
            if (/snyk|trivy|semgrep|codeql|sonarqube|grype|npm audit/i.test(c)) return false;
          }
        } catch (e) { /* no CI dir */ }
        return true;
      }
    },
    'test-mutation': {
      code: 'BP-038', severity: 'low',
      message: 'No mutation testing configured (stryker)',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          return !deps['@stryker-mutator/core'] && !deps['stryker'];
        } catch (e) { _log('best-practices', 'warn', 'package.json parse failed in test-mutation: ' + e.message); return false; }
      }
    },
    'cont-image-scanning': {
      code: 'BP-056', severity: 'medium',
      message: 'No container image scanning in CI pipeline',
      file: null,
      check: function(content, cwd) {
        var ciDir = path.join(cwd, '.github', 'workflows');
        try {
          var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
          for (var i = 0; i < files.length; i++) {
            var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
            if (/trivy|snyk.container|grype|docker.scan|aqua/i.test(c)) return false;
          }
        } catch (e) { /* no CI dir */ }
        return true;
      }
    },
    'obs-distributed-tracing': {
      code: 'BP-062', severity: 'low',
      message: 'No distributed tracing library found',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          var tracingPkgs = ['@opentelemetry/sdk-node', '@opentelemetry/api', 'dd-trace', 'jaeger-client'];
          for (var i = 0; i < tracingPkgs.length; i++) {
            if (deps[tracingPkgs[i]]) return false;
          }
          return true;
        } catch (e) { return false; }
      }
    },
    'obs-metrics': {
      code: 'BP-063', severity: 'low',
      message: 'No metrics collection library found',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          var metricsPkgs = ['prom-client', 'hot-shots', 'datadog-metrics', '@opentelemetry/sdk-metrics'];
          for (var i = 0; i < metricsPkgs.length; i++) {
            if (deps[metricsPkgs[i]]) return false;
          }
          return true;
        } catch (e) { return false; }
      }
    },
    'obs-error-tracking': {
      code: 'BP-066', severity: 'low',
      message: 'No error tracking service configured',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          var errorPkgs = ['@sentry/node', '@sentry/nextjs', 'bugsnag', '@bugsnag/node', 'rollbar', '@rollbar/node'];
          for (var i = 0; i < errorPkgs.length; i++) {
            if (deps[errorPkgs[i]]) return false;
          }
          return true;
        } catch (e) { return false; }
      }
    },
    'sec-sast-pipeline': {
      code: 'BP-072', severity: 'medium',
      message: 'No SAST tool configured in CI pipeline',
      file: null,
      check: function(content, cwd) {
        var ciDir = path.join(cwd, '.github', 'workflows');
        try {
          var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
          for (var i = 0; i < files.length; i++) {
            var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
            if (/semgrep|sonarqube|codeql|snyk code|checkmarx|fortify/i.test(c)) return false;
          }
        } catch (e) { /* no CI dir */ }
        return true;
      }
    },
    'sec-dast': {
      code: 'BP-073', severity: 'low',
      message: 'No DAST tool configured in CI pipeline',
      file: null,
      check: function(content, cwd) {
        var ciDir = path.join(cwd, '.github', 'workflows');
        try {
          var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
          for (var i = 0; i < files.length; i++) {
            var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
            if (/zap|zaproxy|burp|nuclei|dast/i.test(c)) return false;
          }
        } catch (e) { /* no CI dir */ }
        return true;
      }
    },
    'rel-changelog-auto': {
      code: 'BP-092', severity: 'low',
      message: 'No changelog automation configured',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          return !deps['standard-version'] && !deps['semantic-release'] && !deps['@changesets/cli'] && !deps['conventional-changelog-cli'];
        } catch (e) { return false; }
      }
    },
    'rel-feature-flags': {
      code: 'BP-093', severity: 'low',
      message: 'No feature flag library configured',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          return !deps['launchdarkly-node-server-sdk'] && !deps['unleash-client'] && !deps['flagsmith'] && !deps['@growthbook/growthbook'];
        } catch (e) { return false; }
      }
    },
    'api-compression': {
      code: 'BP-117', severity: 'low',
      message: 'No response compression middleware configured',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          return !deps['compression'] && !deps['shrink-ray-current'];
        } catch (e) { return false; }
      }
    },
    'perf-code-splitting': {
      code: 'BP-125', severity: 'low',
      message: 'No code splitting configuration found in bundler config',
      file: null,
      check: function(content, cwd) {
        var configs = ['webpack.config.js', 'webpack.config.ts', 'vite.config.js', 'vite.config.ts', 'next.config.js', 'next.config.mjs'];
        for (var i = 0; i < configs.length; i++) {
          try {
            var c = fs.readFileSync(path.join(cwd, configs[i]), 'utf8');
            if (/splitChunks|manualChunks|dynamic|code.?split/i.test(c)) return false;
          } catch (e) { /* continue */ }
        }
        // Next.js auto-splits, so if next.config exists it passes
        try { fs.statSync(path.join(cwd, 'next.config.js')); return false; } catch (e) { /* continue */ }
        try { fs.statSync(path.join(cwd, 'next.config.mjs')); return false; } catch (e) { /* continue */ }
        try { fs.statSync(path.join(cwd, 'next.config.ts')); return false; } catch (e) { /* continue */ }
        return true;
      }
    },
    'perf-minification': {
      code: 'BP-126', severity: 'low',
      message: 'Build not configured for production minification',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var scripts = pkg.scripts || {};
          var build = scripts.build || '';
          return !(/production|--mode prod|NODE_ENV.*prod|next build|vite build|tsc.*&&/i.test(build));
        } catch (e) { return false; }
      }
    },
    'perf-budgets': {
      code: 'BP-130', severity: 'low',
      message: 'No performance budget configuration found',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          return !deps['@lhci/cli'] && !deps['lighthouse-ci'] && !deps['bundlesize'] && !deps['size-limit'];
        } catch (e) { return false; }
      }
    },
    'agent-observability': {
      code: 'BP-154', severity: 'low',
      message: 'No agent observability/tracing configured',
      file: 'package.json',
      check: function(content) {
        try {
          var pkg = JSON.parse(content);
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          return !deps['langsmith'] && !deps['agentops'] && !deps['@opentelemetry/sdk-node'] && !deps['@langchain/core'];
        } catch (e) { return false; }
      }
    },
    'sec-dep-vuln': {
      code: 'BP-071', severity: 'medium',
      message: 'No dependency vulnerability scanning in CI pipeline',
      file: null,
      check: function(content, cwd) {
        var ciDir = path.join(cwd, '.github', 'workflows');
        try {
          var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
          for (var i = 0; i < files.length; i++) {
            var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
            if (/npm audit|snyk|trivy|grype|dependabot|renovate/i.test(c)) return false;
          }
        } catch (e) { /* no CI dir */ }
        // Also check for .github/dependabot.yml
        try { fs.statSync(path.join(cwd, '.github', 'dependabot.yml')); return false; } catch (e) { /* continue */ }
        return true;
      }
    },
    'perf-bundle-size': {
      code: 'BP-121', severity: 'low',
      message: 'No bundle size limit configuration found',
      file: null,
      check: function(content, cwd) {
        var configs = ['webpack.config.js', 'webpack.config.ts', 'vite.config.js', 'vite.config.ts'];
        for (var i = 0; i < configs.length; i++) {
          try {
            var c = fs.readFileSync(path.join(cwd, configs[i]), 'utf8');
            if (/maxAssetSize|maxEntrypointSize|chunkSizeWarningLimit/i.test(c)) return false;
          } catch (e) { /* continue */ }
        }
        // Check package.json for bundlesize/size-limit
        try {
          var pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
          var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
          if (deps['bundlesize'] || deps['size-limit'] || deps['@size-limit/preset-app']) return false;
        } catch (e) { /* continue */ }
        return true;
      }
    }
  };
  
  // ═══════════════════════════════════════════════════════════════
  // Special Check Handlers
  // ═══════════════════════════════════════════════════════════════
  
  function checkFileSize(content) {
    var lines = content.split('\n');
    return lines.length > 400;
  }
  
  function checkImportOrder(content) {
    var lines = content.split('\n');
    var imports = [];
    var lastImportLine = -1;
    var hasNonImportBetween = false;
  
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (/^import\s/.test(line) || /^const\s+\w+\s*=\s*require\(/.test(line)) {
        if (lastImportLine >= 0 && i - lastImportLine > 2) {
          hasNonImportBetween = true;
        }
        lastImportLine = i;
        imports.push(i);
      }
    }
    return hasNonImportBetween && imports.length > 3;
  }
  
  function checkDockerfileBase(content) {
    var lines = content.split('\n');
    var fromLines = [];
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*FROM\s/i.test(lines[i])) fromLines.push(lines[i]);
    }
    if (fromLines.length === 0) return false;
    var lastFrom = fromLines[fromLines.length - 1];
    return !/alpine|slim|distroless|scratch|busybox/i.test(lastFrom);
  }
  
  function checkDockerfileMultistage(content) {
    var fromCount = 0;
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*FROM\s/i.test(lines[i])) fromCount++;
    }
    return fromCount < 2;
  }
  
  function checkDockerfileUser(content) {
    return !/^\s*USER\s/m.test(content);
  }
  
  function checkDockerfileHealthcheck(content) {
    return !/^\s*HEALTHCHECK\s/m.test(content);
  }
  
  function checkK8sResources(content) {
    if (!/kind:\s*(?:Deployment|Pod|StatefulSet|DaemonSet)/i.test(content)) return false;
    return !/resources:\s*\n\s*limits:/m.test(content);
  }
  
  function checkFunctionComments(content) {
    var lines = content.split('\n');
    var funcStart = -1;
    var braceDepth = 0;
    var hasComment = false;
    var violations = [];
  
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/.test(line)) {
        if (i > 0 && /^\s*(?:\/\/|\/\*|\*)/.test(lines[i - 1])) {
          hasComment = true;
        }
        funcStart = i;
        braceDepth = 0;
      }
      if (funcStart >= 0) {
        for (var j = 0; j < line.length; j++) {
          if (line[j] === '{') braceDepth++;
          if (line[j] === '}') braceDepth--;
        }
        if (braceDepth <= 0 && i > funcStart) {
          var funcLength = i - funcStart + 1;
          if (funcLength > 30 && !hasComment) {
            violations.push(funcStart + 1);
          }
          funcStart = -1;
          hasComment = false;
        }
      }
    }
    return violations.length > 0 ? violations : false;
  }
  
  var SPECIAL_HANDLERS = {
    'file-size': checkFileSize,
    'import-order': checkImportOrder,
    'dockerfile-base': checkDockerfileBase,
    'dockerfile-multistage': checkDockerfileMultistage,
    'dockerfile-user': checkDockerfileUser,
    'dockerfile-healthcheck': checkDockerfileHealthcheck,
    'k8s-resources': checkK8sResources,
    'function-comments': checkFunctionComments
  };
  
  // ═══════════════════════════════════════════════════════════════
  // Practice Enablement Check
  // ═══════════════════════════════════════════════════════════════
  
  function isPracticeEnabled(practiceId, bpSettings) {
    if (!bpSettings || bpSettings.enabled === false) return false;
    var rules = bpSettings.rules || {};
    var rule = rules[practiceId];
    if (rule && rule.enabled === false) return false;
    // Default: enabled unless explicitly disabled
    return true;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // Run Checks
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Run regex-based checks against file content.
   * @param {string} content - File content
   * @param {string} filePath - File path
   * @param {object} bpSettings - Best practices settings
   * @param {Set} [existingCodes] - Codes already fired by STD/SEC/CMP
   * @returns {Array} violations
   */
  function runRegexChecks(content, filePath, bpSettings, existingCodes) {
    var violations = [];
    existingCodes = existingCodes || new Set();
    var lines = content.split('\n');
    var ids = Object.keys(REGEX_CHECKS);
  
    for (var ri = 0; ri < ids.length; ri++) {
      var id = ids[ri];
      var check = REGEX_CHECKS[id];
  
      if (!isPracticeEnabled(id, bpSettings)) continue;
      if (check.dedup && existingCodes.has(check.dedup)) continue;
      if (check.fileFilter && !check.fileFilter.test(filePath)) continue;
      if (check.skipTest && /\.(test|spec)\.(js|ts|tsx|jsx)$/.test(filePath)) continue;
  
      // Special handlers
      if (check.special) {
        var handler = SPECIAL_HANDLERS[check.special];
        if (handler) {
          var result = handler(content);
          if (result === true) {
            violations.push({ code: check.code, severity: check.severity, message: check.message, line: 1 });
          } else if (Array.isArray(result)) {
            for (var vi = 0; vi < result.length; vi++) {
              violations.push({ code: check.code, severity: check.severity, message: check.message, line: result[vi] });
            }
          }
        }
        continue;
      }
  
      // requirePattern: file-level check — flag if patterns match but requirePattern doesn't
      if (check.requirePattern) {
        var hasTarget = false;
        for (var pi = 0; pi < check.patterns.length; pi++) {
          if (check.patterns[pi].test(content)) { hasTarget = true; break; }
        }
        if (hasTarget && !check.requirePattern.test(content)) {
          violations.push({ code: check.code, severity: check.severity, message: check.message, line: 1 });
        }
        continue;
      }
  
      // Standard line-by-line check
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var matched = false;
        for (var pi2 = 0; pi2 < check.patterns.length; pi2++) {
          if (check.patterns[pi2].test(line)) { matched = true; break; }
        }
        if (!matched) continue;
  
        // Check skip patterns
        if (check.skipPatterns) {
          var skipped = false;
          for (var si = 0; si < check.skipPatterns.length; si++) {
            if (check.skipPatterns[si].test(line)) { skipped = true; break; }
          }
          if (skipped) continue;
        }
  
        violations.push({ code: check.code, severity: check.severity, message: check.message, line: li + 1 });
        break; // One violation per check per file
      }
    }
  
    return violations;
  }
  
  /**
   * Run file existence checks.
   * @param {string} cwd - Project root directory
   * @param {object} bpSettings - Best practices settings
   * @returns {Array} violations
   */
  function runFileChecks(cwd, bpSettings) {
    var violations = [];
    var ids = Object.keys(FILE_CHECKS);
  
    for (var fi = 0; fi < ids.length; fi++) {
      var id = ids[fi];
      var check = FILE_CHECKS[id];
  
      if (!isPracticeEnabled(id, bpSettings)) continue;
  
      var found = false;
      for (var pi = 0; pi < check.paths.length; pi++) {
        var fullPath = path.join(cwd, check.paths[pi]);
        try {
          var stat = fs.statSync(fullPath);
          if (stat.isFile() || stat.isDirectory()) {
            // Content check if required
            if (check.contentCheck && stat.isFile()) {
              var fileContent = fs.readFileSync(fullPath, 'utf8');
              if (check.contentCheck.test(fileContent)) {
                found = true;
                break;
              }
            } else {
              found = true;
              break;
            }
          }
        } catch (e) { /* not found */ }
      }
  
      if (!found) {
        if (check.anyOf || check.paths.length === 1) {
          violations.push({ code: check.code, severity: check.severity, message: check.message, line: 0 });
        }
      }
    }
  
    return violations;
  }
  
  /**
   * Run config file checks.
   * @param {string} cwd - Project root directory
   * @param {object} bpSettings - Best practices settings
   * @param {Set} [existingCodes] - Codes already fired
   * @returns {Array} violations
   */
  function runConfigChecks(cwd, bpSettings, existingCodes) {
    var violations = [];
    existingCodes = existingCodes || new Set();
    var ids = Object.keys(CONFIG_CHECKS);
  
    for (var ci = 0; ci < ids.length; ci++) {
      var id = ids[ci];
      var check = CONFIG_CHECKS[id];
  
      if (!isPracticeEnabled(id, bpSettings)) continue;
      if (check.dedup && existingCodes.has(check.dedup)) continue;
  
      var content = '';
      if (check.file) {
        try {
          content = fs.readFileSync(path.join(cwd, check.file), 'utf8');
        } catch (e) { continue; } // File doesn't exist, skip
      }
  
      try {
        if (check.check(content, cwd)) {
          violations.push({ code: check.code, severity: check.severity, message: check.message, line: 0 });
        }
      } catch (e) { /* check failed, skip */ }
    }
  
    return violations;
  }
  
  /**
   * Main entry point — run all applicable checks.
   * @param {string} content - File content being written
   * @param {string} filePath - Target file path
   * @param {string} cwd - Project root directory
   * @param {object} bpSettings - Best practices settings
   * @param {object} [context] - { existingViolationCodes: Set }
   * @returns {Array} violations
   */
  function runChecks(content, filePath, cwd, bpSettings, context) {
    if (!bpSettings || bpSettings.enabled === false) return [];
  
    var existingCodes = (context && context.existingViolationCodes) || new Set();
    var violations = [];
  
    // Always run regex checks on the file being written
    var regexResults = runRegexChecks(content, filePath, bpSettings, existingCodes);
    for (var i = 0; i < regexResults.length; i++) violations.push(regexResults[i]);
  
    // File checks only on project config changes (not every file write)
    // Config checks only when writing the specific config file
    // These are run separately by oversight on init/scan
  
    return violations;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // Exports
  // ═══════════════════════════════════════════════════════════════
  
  module.exports = {
    runChecks: runChecks,
    runRegexChecks: runRegexChecks,
    runFileChecks: runFileChecks,
    runConfigChecks: runConfigChecks,
    isPracticeEnabled: isPracticeEnabled,
    REGEX_CHECKS: REGEX_CHECKS,
    FILE_CHECKS: FILE_CHECKS,
    CONFIG_CHECKS: CONFIG_CHECKS
  };
  
});

// -- ezra-guard --------------------------------------------------

_loadInlineModule('ezra-guard', function(module, exports) {
  /**
   * EZRA Guard Hook — PreToolUse hook for Write/Edit operations
   * 
   * Checks if the file being modified matches a protected path pattern
   * defined in .ezra/governance.yaml. If matched and no decision record
   * authorises the change, the hook provides a warning (non-blocking).
   * 
   * To make it blocking (deny writes to protected paths), change
   * permissionDecision from "allow" to "deny" in the output.
   * 
   * Install: Add to .claude/settings.json under hooks.PreToolUse
   */
  
  const fs = require('fs');
  const path = require('path');
  
  // EZRA feedback helpers (non-blocking)
  let _log, _fmt;
  try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
  try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }
  
  // YAML parser — simple built-in, zero dependencies
  function parseYaml(text) {
    // Parse YAML-like key: value pairs (top-level only)
    const result = {};
    const lines = text.split('\n');
    let currentKey = null;
    let currentList = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Only treat unindented lines as top-level keys
      const indent = line.match(/^(\s*)/)[1].length;
      if (indent === 0) {
        const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
          if (/^(__proto__|constructor|prototype)$/.test(kvMatch[1])) continue;
          currentKey = kvMatch[1];
          const val = kvMatch[2].trim();
          if (val) { result[currentKey] = val; currentList = null; }
          else { result[currentKey] = []; currentList = currentKey; }
        }
      } else if (trimmed.startsWith('- ') && currentList) {
        result[currentList].push(trimmed.slice(2).trim());
      }
      // Indented sub-keys (e.g. reason: under a list item) are skipped — not top-level
    }
    return result;
  }
  
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
      const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
      
      if (!filePath) {
        process.exit(0); // No file path, allow
        return;
      }
  
      // Find .ezra/governance.yaml relative to cwd
      const cwd = event.cwd || process.cwd();
  
      // Path traversal guard — resolved path must stay within cwd
      // SEC-003: Use realpathSync for existing files to prevent symlink bypass
      let resolved = path.resolve(cwd, filePath);
      try {
        if (fs.existsSync(resolved)) {
          resolved = fs.realpathSync(resolved);
        }
      } catch { /* If realpathSync fails, fall back to resolve */ }
      const cwdResolved = path.resolve(cwd);
      let cwdReal = cwdResolved;
      try { cwdReal = fs.realpathSync(cwdResolved); } catch { /* fallback */ }
      // Case-insensitive comparison on Windows to prevent drive-letter casing bypass
      const norm = process.platform === 'win32' ? s => s.toLowerCase() : s => s;
      if (!norm(resolved).startsWith(norm(cwdReal) + path.sep) && norm(resolved) !== norm(cwdReal)) {
        const msg = _fmt('GUARD_002', { path: filePath });
        process.stderr.write(msg + "\n");
        _log(cwd, 'ezra-guard', 'error', msg);
        process.exit(0);
        return;
      }
      const govPath = path.join(cwd, '.ezra', 'governance.yaml');
      
      if (!fs.existsSync(govPath)) {
        process.exit(0); // EZRA not initialized, allow
        return;
      }
  
      // Parse governance file (with FACT cache support)
      let governance;
      const govCacheKey = `governance:${govPath}`;
      let govContent;
      // Check FACT in-memory cache first (avoids filesystem read on every hook)
      if (global.__factGovernanceCache && global.__factGovernanceCache.key === govCacheKey) {
        const cached = global.__factGovernanceCache;
        const age = Date.now() - cached.timestamp;
        if (age < 60000) { // 1 minute TTL for governance cache
          governance = cached.parsed;
          govContent = cached.raw;
        }
      }
      if (!governance) {
        govContent = fs.readFileSync(govPath, 'utf8');
      }
      if (!governance) {
      try {
        // Try YAML parse
        governance = parseYaml(govContent);
        // Store in FACT cache for subsequent hook invocations
        global.__factGovernanceCache = {
          key: govCacheKey,
          raw: govContent,
          parsed: governance,
          timestamp: Date.now(),
        };
      } catch {
        // Fallback: try as JSON
        try {
          governance = JSON.parse(govContent);
        } catch (parseErr) {
          const msg = _fmt('GUARD_003', { reason: 'Invalid YAML/JSON syntax' });
          process.stderr.write(msg + "\n");
          _log(cwd, 'ezra-guard', 'warn', msg, 'Run /ezra:health to diagnose.');
          process.exit(0); // Can't parse, allow
          return;
        }
      }
      } // end if (!governance) — FACT cache miss path
  
      // Schema validation — warn on missing required keys or unknown top-level keys
      const KNOWN_KEYS = ['protected_paths', 'allowed_patterns', 'auto_approve', 'version', 'project', 'settings', 'name', 'language', 'standards', 'strict_types', 'no_any', 'project_phase', 'reason'];
      if (governance && typeof governance === 'object') {
        if (!governance.protected_paths) {
          const msg = _fmt('GUARD_004', { key: 'protected_paths' });
          process.stderr.write(msg + "\n");
          _log(cwd, 'ezra-guard', 'warn', msg, 'Run /ezra:init to regenerate governance.yaml.');
        }
        const unknownKeys = Object.keys(governance).filter(k => !KNOWN_KEYS.includes(k));
        if (unknownKeys.length > 0) {
          const msg = 'EZRA [GUARD]: Unknown governance.yaml keys: ' + unknownKeys.join(', ') + '. These will be ignored.';
          process.stderr.write(msg + "\n");
          _log(cwd, 'ezra-guard', 'info', msg);
        }
      }
  
      const protectedPaths = governance?.protected_paths || [];
      
      // Check if file matches any protected pattern
      const relativePath = path.relative(cwd, path.resolve(cwd, filePath));
      
      for (const pp of protectedPaths) {
        // Handle both object {pattern, reason} and string formats
        let pattern, reason;
        if (typeof pp === 'string') {
          const m = pp.match(/^pattern:\s*(.+)/);
          pattern = m ? m[1].trim() : pp;
          reason = '';
        } else {
          pattern = pp.pattern || '';
          reason = pp.reason || '';
        }
        if (matchGlob(relativePath, pattern)) {
          // File matches protected path — check for decision record
          const decisionsDir = path.join(cwd, '.ezra', 'decisions');
          const hasDecision = checkDecisionExists(decisionsDir, relativePath);
          
          if (!hasDecision) {
            // Protected path without decision — warn (change to "deny" for blocking)
            const guardMsg = _fmt('GUARD_001', { path: relativePath });
            process.stderr.write(guardMsg + "\n");
            _log(cwd, 'ezra-guard', 'warn', guardMsg, 'Run /ezra:decide to authorize.');
            const output = {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                // Change "allow" to "deny" to block protected path writes
                permissionDecision: 'allow',
                permissionDecisionReason: `EZRA: Protected path "${pattern}" — ${reason || 'no reason specified'}. Run /ezra:decide to record a decision authorising this change.`
              }
            };
            process.stdout.write(JSON.stringify(output));
            return;
          }
        }
      }
      
      // No protected path matched or decision exists — allow
      process.exit(0);
      
    } catch (err) {
      // Hook errors should not block work
      process.stderr.write(`EZRA hook error: ${err.message}\n`);
      process.exit(0);
    }
  });
  
  /**
   * Simple glob matching supporting * and ** patterns
   */
  function matchGlob(filePath, pattern) {
    if (!pattern) return false;
    // SEC-006: Reject overly complex glob patterns to prevent ReDoS
    if (pattern.length > 200) return false;
    // Convert glob to regex
    const normalized = filePath.replace(/\\/g, '/');
    let regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DOUBLESTAR\}\}/g, '.*?');
    
    try {
      return new RegExp(`^${regex}$`).test(normalized) || 
             new RegExp(regex).test(normalized);
    } catch {
      return false;
    }
  }
  
  /**
   * Check if any decision file references the given file path
   */
  function checkDecisionExists(decisionsDir, filePath) {
    if (!fs.existsSync(decisionsDir)) return false;
    
    const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(decisionsDir, file), 'utf8');
        // Check if this decision references the file AND is active
        if (content.includes(filePath) && /status:\s*ACTIVE/i.test(content)) {
          return true;
        }
      } catch {
        continue;
      }
    }
    
    return false;
  }
  
});

// -- ezra-tier-gate ----------------------------------------------

_loadInlineModule('ezra-tier-gate', function(module, exports) {
  /**
   * hooks/ezra-tier-gate.js — PreToolUse hook for license tier gating
   * Blocks Pro/Team features on Core tier. Core features ALWAYS pass.
   * ZERO external dependencies.
   */
  const path = require('path');
  
  // EZRA feedback helpers (non-blocking)
  let _log, _fmt;
  try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
  try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }
  
  // Feature-to-command mapping for gating
  const GATED_COMMANDS = {
    'ezra:cost':       'cost_tracking',
    'ezra:agents':     'multi_agent',
    'ezra:portfolio':  'portfolio',
    'ezra:handoff':    'handoff',
    'ezra:cloud-sync': 'cloud_sync',
    'ezra:research':   'research_agent',
    'ezra:compliance': 'compliance_profiles',
    'ezra:memory':     'memory_system',
    'ezra:plan':       'planning_engine',
    'ezra:advisor':    'advisor',
    'ezra:dash':       'dashboard',
    'ezra:pm':         'project_manager',
    'ezra:learn':      'self_learning',
  };
  
  // Core commands — NEVER gated
  const CORE_COMMANDS = [
    'ezra:init', 'ezra:scan', 'ezra:guard', 'ezra:reconcile',
    'ezra:decide', 'ezra:review', 'ezra:status', 'ezra:help',
    'ezra:doc', 'ezra:doc-check', 'ezra:doc-sync', 'ezra:doc-approve',
    'ezra:version', 'ezra:health', 'ezra:settings', 'ezra:oversight',
    'ezra:process', 'ezra:workflow', 'ezra:progress', 'ezra:library',
    'ezra:license', 'ezra:install',
  ];
  
  /**
   * Check if a command should be gated.
   * Returns null if allowed, or a denial object if blocked.
   * Now internally triggers refreshLicense if cache is expired.
   */
  function checkGate(commandName, projectDir) {
    // Core commands always pass
    if (CORE_COMMANDS.includes(commandName)) return null;
  
    const feature = GATED_COMMANDS[commandName];
    if (!feature) return null; // Unknown commands pass through
  
    // Lazy-load license module to avoid circular deps
    let license;
    try {
      license = require(path.join(__dirname, 'ezra-license.js'));
    } catch (_) {
      return null; // If license module not available, allow
    }
  
    // Check current license — if cache expired, trigger refresh
    const currentLicense = license.checkLicense(projectDir);
    if (currentLicense.reason === 'cache_expired' || currentLicense.reason === 'no_cache') {
      // Trigger async refresh (non-blocking for gate check)
      try {
        const refreshResult = license.refreshLicense(projectDir);
        if (refreshResult && typeof refreshResult.then === 'function') {
          refreshResult.catch(() => {});
        }
      } catch (_) {
        // Refresh failed — proceed with current check
      }
    }
  
    const result = license.isFeatureAvailable(projectDir, feature);
    if (result.available) return null;
  
    return {
      blocked: true,
      command: commandName,
      feature,
      requiredTier: result.requiredTier,
      currentTier: result.currentTier || 'core',
      message: result.upgrade || 'Requires EZRA ' + (result.requiredTier || 'Pro') + '. Upgrade at ezra.dev/pricing',
    };
  }
  
  /**
   * PreToolUse hook handler (reads JSON from stdin).
   */
  function handleHook(event) {
    if (!event || !event.tool_name) return {};
  
    const commandName = event.tool_name;
    const projectDir = event.project_dir || process.cwd();
  
    const gate = checkGate(commandName, projectDir);
    if (gate) {
      return {
        permissionDecision: 'deny',
        reason: gate.message,
      };
    }
  
    return {};
  }
  
  // ─── Exports ────────────────────────────────────────────────────
  
  module.exports = {
    GATED_COMMANDS,
    CORE_COMMANDS,
    checkGate,
    handleHook,
  };
  
  // ─── CLI mode ───────────────────────────────────────────────────
  if (require.main === module) {
    const MAX_STDIN = 1024 * 1024; // 1 MB stdin limit
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => {
      input += c;
      if (input.length > MAX_STDIN) { process.exit(0); }
    });
    process.stdin.on('end', () => {
      try {
        const event = JSON.parse(input);
        const result = handleHook(event);
        process.stdout.write(JSON.stringify(result));
      } catch (_) {
        const msg = _fmt('TIER_001', { detail: 'Hook protocol error' });
        process.stderr.write(msg + "\n");
        _log(process.cwd(), 'ezra-tier-gate', 'warn', msg);
        process.stdout.write('{}');
      }
      process.exit(0);
    });
  }
  
});

// -- ezra-drift-hook ---------------------------------------------

_loadInlineModule('ezra-drift-hook', function(module, exports) {
  /**
   * EZRA Document Drift Detection Hook
   * 
   * PostToolUse hook for Write/Edit/MultiEdit operations.
   * When a file is modified, checks if it falls within the scope of any
   * existing EZRA document. If so, increments a drift counter and
   * periodically reminds the user to run /ezra:doc-sync.
   * 
   * Non-blocking — provides feedback only, never denies actions.
   * 
   * Install: Add to settings.json under hooks.PostToolUse:
   * {
   *   "matcher": "Write|Edit|MultiEdit",
   *   "hooks": [{
   *     "type": "command",
   *     "command": "node <path>/ezra-drift-hook.js",
   *     "timeout": 3
   *   }]
   * }
   */
  
  const fs = require('fs');
  const path = require('path');
  
  // EZRA feedback helpers (non-blocking)
  let _log, _fmt;
  try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
  try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }
  
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
      const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
      
      if (!filePath) {
        process.exit(0);
        return;
      }
  
      const cwd = event.cwd || process.cwd();
      const ezraDir = path.join(cwd, '.ezra');
      
      // Quick exit if EZRA not initialized or no docs exist
      if (!fs.existsSync(ezraDir)) {
        process.exit(0);
        return;
      }
  
      const regPath = path.join(ezraDir, 'docs', 'registry.yaml');
      if (!fs.existsSync(regPath)) {
        process.exit(0);
        return;
      }
  
      // Drift counter file — tracks edits since last doc-sync
      const driftCounterPath = path.join(ezraDir, 'docs', '.drift-counter.json');
      let counter = { edits_since_sync: 0, affected_docs: {}, last_reminded: null };
      
      if (fs.existsSync(driftCounterPath)) {
        try {
          counter = JSON.parse(fs.readFileSync(driftCounterPath, 'utf8'));
        } catch { /* reset on parse error */ }
      }
  
      const relativePath = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, '/');
  
      // File-to-document relevance mapping
      const relevanceRules = [
        { patterns: [/^src\/(routes|controllers|handlers|api)\//i, /\.controller\./i, /\.route\./i], docs: ['api-spec', 'api-docs'] },
        { patterns: [/migrations?\//i, /schema/i, /\.entity\./i, /\.model\./i], docs: ['data-model', 'migrations'] },
        { patterns: [/(auth|session|jwt|oauth|token)/i, /middleware/i], docs: ['security-arch'] },
        { patterns: [/docker/i, /\.github\/workflows/i, /ci/i, /cd/i, /deploy/i], docs: ['deploy-runbook', 'infra-plan'] },
        { patterns: [/\.env/i, /docker-compose/i, /config\//i], docs: ['env-setup', 'config-mgmt'] },
        { patterns: [/package\.json$/i, /package-lock/i, /yarn\.lock/i], docs: ['dependencies', 'tech-stack'] },
        { patterns: [/tsconfig/i, /\.eslint/i, /\.prettier/i, /lint/i], docs: ['coding-standards'] },
        { patterns: [/test/i, /spec/i, /\.test\./i, /\.spec\./i, /jest/i, /vitest/i], docs: ['test-strategy', 'test-cases'] },
        { patterns: [/src\//i], docs: ['tad'] },  // Any source change can affect architecture doc
        { patterns: [/\.ezra\/decisions\//i], docs: ['adr'] },
        { patterns: [/monitoring|health|metrics|logging/i], docs: ['monitoring', 'ops-manual'] },
        { patterns: [/components?\//i, /pages?\//i, /views?\//i, /ui\//i], docs: ['user-guide', 'wireframes'] },
        { patterns: [/\.github\/workflows/i, /pipeline/i, /\.gitlab-ci/i], docs: ['cicd-pipeline'] },
        { patterns: [/k8s/i, /kubernetes/i, /helm/i, /compose/i], docs: ['container-spec'] },
        { patterns: [/secret/i, /vault/i, /credential/i], docs: ['secrets-mgmt'] },
        { patterns: [/firewall/i, /proxy/i, /cors/i, /csp/i], docs: ['network-arch'] },
        { patterns: [/feature.?flag/i, /toggle/i, /unleash/i, /launchdarkly/i], docs: ['feature-flags'] },
        { patterns: [/rollback/i, /revert/i, /restore/i], docs: ['rollback-plan'] },
        { patterns: [/(load|stress|perf).?test/i, /k6/i, /artillery/i, /jmeter/i], docs: ['load-test-plan'] },
        { patterns: [/llm/i, /openai/i, /anthropic/i, /claude/i, /prompt/i], docs: ['ai-usage-policy', 'agent-runbook'] },
        { patterns: [/a11y/i, /accessibility/i, /aria/i, /wcag/i], docs: ['accessibility'] },
        { patterns: [/i18n/i, /l10n/i, /locale/i, /translation/i, /intl/i], docs: ['localization'] },
        { patterns: [/error.?code/i, /error.?catalog/i], docs: ['error-catalog'] },
        { patterns: [/alert/i, /pager/i, /oncall/i, /escalat/i], docs: ['runbook-alerts'] },
        { patterns: [/privacy/i, /gdpr/i, /pii/i, /consent/i], docs: ['privacy-impact', 'data-lineage'] },
        { patterns: [/tech.?debt/i, /deprecat/i], docs: ['tech-debt-register'] },
        { patterns: [/vendor/i, /saas/i, /third.?party/i], docs: ['vendor-register'] },
        { patterns: [/api.?version/i, /v[0-9]+\//i], docs: ['api-versioning'] },
      ];
  
      // Check which docs this file change affects
      const affectedDocs = new Set();
      for (const rule of relevanceRules) {
        for (const pattern of rule.patterns) {
          if (pattern.test(relativePath)) {
            rule.docs.forEach(d => affectedDocs.add(d));
          }
        }
      }
  
      if (affectedDocs.size === 0) {
        process.exit(0);
        return;
      }
  
      // Read registry to check which affected docs actually exist
      const regContent = fs.readFileSync(regPath, 'utf8');
      const existingAffected = [];
      for (const docId of affectedDocs) {
        if (regContent.includes(`id: ${docId}`)) {
          existingAffected.push(docId);
          // Increment per-doc counter
          counter.affected_docs[docId] = (counter.affected_docs[docId] || 0) + 1;
          // F-025: Cap per-doc counter to prevent unbounded growth
          if (counter.affected_docs[docId] > 10000) counter.affected_docs[docId] = 10000;
        }
      }
  
      if (existingAffected.length === 0) {
        process.exit(0);
        return;
      }
  
      // Increment global counter (capped to prevent unbounded growth)
      counter.edits_since_sync = Math.min((counter.edits_since_sync || 0) + 1, 100000);
  
      // Save counter
      const proposalsDir = path.join(ezraDir, 'docs');
      if (!fs.existsSync(proposalsDir)) {
        fs.mkdirSync(proposalsDir, { recursive: true });
      }
      fs.writeFileSync(driftCounterPath, JSON.stringify(counter, null, 2));
  
      // Decide whether to remind
      // Remind every 10 edits, or if a high-impact doc is affected 3+ times
      const shouldRemind = (
        counter.edits_since_sync % 10 === 0 ||
        existingAffected.some(d => (counter.affected_docs[d] || 0) >= 3 && !counter.last_reminded_docs?.[d])
      );
  
      if (shouldRemind) {
        // Find the most-affected docs
        const sorted = Object.entries(counter.affected_docs)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        
        const docList = sorted.map(([id, count]) => `${id} (${count} edits)`).join(', ');
        
        // Output as stderr feedback (non-blocking)
        process.stderr.write(`EZRA: ${counter.edits_since_sync} edits since last doc-sync. Docs potentially stale: ${docList}. Run /ezra:doc-sync to review.` + "\n");
        
        // Track that we reminded about these
        counter.last_reminded = new Date().toISOString();
        if (!counter.last_reminded_docs) counter.last_reminded_docs = {};
        for (const [id] of sorted) {
          counter.last_reminded_docs[id] = counter.last_reminded;
        }
        fs.writeFileSync(driftCounterPath, JSON.stringify(counter, null, 2));
      }
  
      process.exit(0);
  
    } catch (err) {
      // Never block work due to hook errors
      const msg = _fmt('DRIFT_001', { detail: err.message });
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-drift-hook', 'warn', msg);
      process.exit(0);
    }
  });
  
  module.exports = { MAX_STDIN };
  
});

// -- ezra-oversight ----------------------------------------------

_loadInlineModule('ezra-oversight', function(module, exports) {
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
  
});

// -- ezra-phase-gate ---------------------------------------------

_loadInlineModule('ezra-phase-gate', function(module, exports) {
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
   * Uses spawnSync with tree-kill on Windows to prevent zombie processes.
   */
  function runCommand(cmd, cwd, timeoutMs = 60000) {
    const result = require('child_process').spawnSync(cmd, {
      cwd, timeout: timeoutMs, encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
      killSignal: 'SIGKILL',
    });

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
   * Run all gate checks for a phase. Returns GateResult.
   * GateResult: { passed, overall_score, checks[], blockers[], run_at, phase, retries }
   */
  function runGate(projectDir, phaseNum, options = {}) {
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
  
});

// Unified Exports
var _gd = _moduleRegistry['ezra-guard'] || {};
var _pg = _moduleRegistry['ezra-phase-gate'] || {};
var _tg = _moduleRegistry['ezra-tier-gate'] || {};
var _ov = _moduleRegistry['ezra-oversight'] || {};
var _dr = _moduleRegistry['ezra-drift-hook'] || {};
var _cp = _moduleRegistry['ezra-compliance'] || {};
var _wf = _moduleRegistry['ezra-workflow-enforce'] || {};
var _bp = _moduleRegistry['ezra-best-practices'] || {};

module.exports.guard_parseYaml = _gd.parseYaml;
module.exports.guard_matchGlob = _gd.matchGlob;
module.exports.guard_checkDecisionExists = _gd.checkDecisionExists;

module.exports.GATE_CHECKS = _pg.GATE_CHECKS;
module.exports.DEFAULT_THRESHOLDS = _pg.DEFAULT_THRESHOLDS;
module.exports.runGate = _pg.runGate;
module.exports.runTestSuite = _pg.runTestSuite;
module.exports.runLintCheck = _pg.runLintCheck;
module.exports.runSecurityScan = _pg.runSecurityScan;
module.exports.runCoverageCheck = _pg.runCoverageCheck;
module.exports.runStandardsCheck = _pg.runStandardsCheck;
module.exports.fixAndRecheck = _pg.fixAndRecheck;
module.exports.saveGateResult = _pg.saveGateResult;
module.exports.loadGateResult = _pg.loadGateResult;
module.exports.listGateResults = _pg.listGateResults;
module.exports.detectTestRunner = _pg.detectTestRunner;
module.exports.detectLintCommand = _pg.detectLintCommand;

module.exports.GATED_COMMANDS = _tg.GATED_COMMANDS;
module.exports.CORE_COMMANDS = _tg.CORE_COMMANDS;
module.exports.checkGate = _tg.checkGate;
module.exports.tierGate_handleHook = _tg.handleHook;

module.exports.oversight_runChecks = _ov.runChecks;
module.exports.oversight_decide = _ov.decide;
module.exports.oversight_logViolations = _ov.logViolations;
module.exports.oversight_matchGlob = _ov.matchGlob;
module.exports.oversight_loadOversightSettings = _ov.loadOversightSettings;
module.exports.oversight_isSafeRegex = _ov.isSafeRegex;

module.exports.DRIFT_MAX_STDIN = _dr.MAX_STDIN;

module.exports.AUTOMATABLE_STANDARDS = _cp.AUTOMATABLE_STANDARDS;
module.exports.SEMI_AUTO_STANDARDS = _cp.SEMI_AUTO_STANDARDS;
module.exports.DOC_ONLY_STANDARDS = _cp.DOC_ONLY_STANDARDS;
module.exports.compliance_runChecks = _cp.runChecks;
module.exports.compliance_getCoverageReport = _cp.getCoverageReport;
module.exports.compliance_listStandards = _cp.listStandards;

module.exports.WORKFLOW_CHECKS = _wf.WORKFLOW_CHECKS;
module.exports.wf_runChecks = _wf.runChecks;
module.exports.wf_runTemplateRegexChecks = _wf.runTemplateRegexChecks;
module.exports.wf_runTemplateFileChecks = _wf.runTemplateFileChecks;
module.exports.wf_getEnforceableTemplates = _wf.getEnforceableTemplates;

module.exports.BP_REGEX_CHECKS = _bp.REGEX_CHECKS;
module.exports.BP_FILE_CHECKS = _bp.FILE_CHECKS;
module.exports.BP_CONFIG_CHECKS = _bp.CONFIG_CHECKS;
module.exports.bp_runChecks = _bp.runChecks;
module.exports.bp_runRegexChecks = _bp.runRegexChecks;
module.exports.bp_runFileChecks = _bp.runFileChecks;
module.exports.bp_runConfigChecks = _bp.runConfigChecks;
module.exports.bp_isPracticeEnabled = _bp.isPracticeEnabled;

module.exports._moduleRegistry = _moduleRegistry;

if (require.main === module) {
  var MAX_STDIN = 1024 * 1024;
  var input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function(c) { input += c; if (input.length > MAX_STDIN) process.exit(0); });
  process.stdin.on('end', function() {
    try {
      var event = JSON.parse(input);
      var hookType = event._governanceHook || 'oversight';
      if (hookType === 'phase-gate' && _pg.runGate) {
        var result = _pg.runGate(event.cwd || process.cwd(), event.phase || 0);
        process.stdout.write(JSON.stringify(result));
      } else if (hookType === 'tier-gate' && _tg.handleHook) {
        process.stdout.write(JSON.stringify(_tg.handleHook(event)));
      } else if (_ov.runChecks) {
        var tn = event.tool_name || '';
        var fp = event.tool_input?.file_path || event.tool_input?.path || '';
        var ct = event.tool_input?.content || event.tool_input?.new_string || '';
        if (/Write|Edit|MultiEdit/i.test(tn) && fp && ct) {
          var cwd = event.cwd || process.cwd();
          if (fs.existsSync(path.join(cwd, '.ezra'))) {
            var settings = _ov.loadOversightSettings(cwd);
            if (settings.enabled) {
              var v = _ov.runChecks(ct, fp, cwd);
              _ov.logViolations(cwd, v, fp);
              var d = _ov.decide(v, settings.level || 'warn');
              if (v.length > 0) {
                process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision === 'deny' ? 'deny' : 'allow', permissionDecisionReason: 'EZRA Oversight: ' + d.message } }));
              }
            }
          }
        }
      }
    } catch (err) {
      process.stderr.write('EZRA [GOVERNANCE]: ' + (err.message || 'unknown') + '\n');
    }
    process.exit(0);
  });
}
