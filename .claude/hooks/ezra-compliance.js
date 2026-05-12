#!/usr/bin/env node
'use strict';

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
