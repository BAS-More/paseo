#!/usr/bin/env node

'use strict';

/**
 * EZRA Error Code Catalog
 *
 * Structured error codes for all EZRA hooks.
 * Each code has: code, severity, message_template, action_template.
 *
 * Usage:
 *   const { formatError, ERROR_CODES } = require('./ezra-error-codes');
 *   console.error(formatError('GUARD_001', { path: 'src/auth.js', adr: 'ADR-005' }));
 *   // → "EZRA [GUARD-001]: Protected path violation on src/auth.js by ADR-005. Run /ezra:decide to authorize."
 *
 * Zero dependencies.
 */

const ERROR_CODES = {
  // ─── Guard Hook ────────────────────────────────────────────────
  GUARD_001: {
    code: 'GUARD-001',
    severity: 'warn',
    message_template: 'Protected path violation on {path}',
    action_template: 'Run /ezra:decide to authorize changes.',
  },
  GUARD_002: {
    code: 'GUARD-002',
    severity: 'error',
    message_template: 'Path traversal attempt blocked: {path}',
    action_template: 'Use a relative path within the project.',
  },
  GUARD_003: {
    code: 'GUARD-003',
    severity: 'warn',
    message_template: 'governance.yaml parse failure: {reason}',
    action_template: 'Run /ezra:health to diagnose.',
  },
  GUARD_004: {
    code: 'GUARD-004',
    severity: 'info',
    message_template: 'Unknown key \'{key}\' in governance.yaml',
    action_template: 'Possible typo — check governance.yaml keys.',
  },

  // ─── Oversight Hook ────────────────────────────────────────────
  OVERSIGHT_001: {
    code: 'OVERSIGHT-001',
    severity: 'warn',
    message_template: 'Security rule violation: {detail}',
    action_template: 'Review flagged code and run /ezra:review.',
  },
  OVERSIGHT_002: {
    code: 'OVERSIGHT-002',
    severity: 'error',
    message_template: 'ReDoS pattern rejected: {pattern}',
    action_template: 'Simplify the regex to avoid catastrophic backtracking.',
  },
  OVERSIGHT_003: {
    code: 'OVERSIGHT-003',
    severity: 'warn',
    message_template: 'Standards violation: {detail}',
    action_template: 'Run /ezra:scan to see full standards report.',
  },
  OVERSIGHT_004: {
    code: 'OVERSIGHT-004',
    severity: 'info',
    message_template: 'Oversight log rotation triggered',
    action_template: 'Previous log archived as violations.log.1.',
  },

  // ─── Drift Hook ────────────────────────────────────────────────
  DRIFT_001: {
    code: 'DRIFT-001',
    severity: 'warn',
    message_template: '{count} edits since last doc-sync. Docs potentially stale: {docs}',
    action_template: 'Run /ezra:doc-sync to review.',
  },

  // ─── Agents Hook ───────────────────────────────────────────────
  AGENTS_001: {
    code: 'AGENTS-001',
    severity: 'warn',
    message_template: 'Provider configuration error: {detail}',
    action_template: 'Run /ezra:agents list to verify roster.',
  },
  AGENTS_002: {
    code: 'AGENTS-002',
    severity: 'info',
    message_template: 'Settings module unavailable, using defaults',
    action_template: 'Run /ezra:settings to configure.',
  },

  // ─── Memory Hooks ──────────────────────────────────────────────
  MEMORY_001: {
    code: 'MEMORY-001',
    severity: 'info',
    message_template: 'Memory pruning triggered: {detail}',
    action_template: 'Run /ezra:memory list to review entries.',
  },
  MEMORY_002: {
    code: 'MEMORY-002',
    severity: 'warn',
    message_template: 'Memory store failure: {detail}',
    action_template: 'Check .ezra/memory/ directory permissions.',
  },

  // ─── Version Hook ──────────────────────────────────────────────
  VERSION_001: {
    code: 'VERSION-001',
    severity: 'info',
    message_template: 'State change versioned: {detail}',
    action_template: 'Run /ezra:version to see changelog.',
  },
  VERSION_002: {
    code: 'VERSION-002',
    severity: 'warn',
    message_template: 'Version tracking failure: {detail}',
    action_template: 'Check .ezra/versions/ directory.',
  },

  // ─── Settings Hooks ────────────────────────────────────────────
  SETTINGS_001: {
    code: 'SETTINGS-001',
    severity: 'warn',
    message_template: 'Settings parse failure, using defaults: {detail}',
    action_template: 'Run /ezra:settings to reconfigure.',
  },
  SETTINGS_002: {
    code: 'SETTINGS-002',
    severity: 'warn',
    message_template: 'Settings write failure: {detail}',
    action_template: 'Check .ezra/settings.yaml permissions.',
  },

  // ─── License Hook ──────────────────────────────────────────────
  LICENSE_001: {
    code: 'LICENSE-001',
    severity: 'warn',
    message_template: 'License validation error: {detail}',
    action_template: 'Run /ezra:license status to check.',
  },
  LICENSE_002: {
    code: 'LICENSE-002',
    severity: 'info',
    message_template: 'Tier gate: {command} requires {tier} tier',
    action_template: 'Run /ezra:license to see available features.',
  },

  // ─── PM Hook ───────────────────────────────────────────────────
  PM_001: {
    code: 'PM-001',
    severity: 'warn',
    message_template: 'Milestone tracking error: {detail}',
    action_template: 'Run /ezra:pm status to review milestones.',
  },
  PM_002: {
    code: 'PM-002',
    severity: 'info',
    message_template: 'Stall detected: {detail}',
    action_template: 'Run /ezra:progress to see recommendations.',
  },

  // ─── Planner Hook ──────────────────────────────────────────────
  PLANNER_001: {
    code: 'PLANNER-001',
    severity: 'warn',
    message_template: 'Plan validation error: {detail}',
    action_template: 'Run /ezra:plan status to review.',
  },

  // ─── Library Hook ──────────────────────────────────────────────
  LIBRARY_001: {
    code: 'LIBRARY-001',
    severity: 'warn',
    message_template: 'Library access error: {detail}',
    action_template: 'Run /ezra:library list to verify.',
  },

  // ─── Cloud Sync Hook ──────────────────────────────────────────
  CLOUD_001: {
    code: 'CLOUD-001',
    severity: 'warn',
    message_template: 'Cloud sync failure: {detail}',
    action_template: 'Check network and run /ezra:sync retry.',
  },

  // ─── Dashboard Hook ───────────────────────────────────────────
  DASH_001: {
    code: 'DASH-001',
    severity: 'info',
    message_template: 'Dashboard data collection error: {detail}',
    action_template: 'Run /ezra:health to verify .ezra/ state.',
  },

  // ─── Progress Hook ────────────────────────────────────────────
  PROGRESS_001: {
    code: 'PROGRESS-001',
    severity: 'warn',
    message_template: 'Progress tracking failure: {detail}',
    action_template: 'Run /ezra:progress to review status.',
  },

  // ─── Workflow Hook ─────────────────────────────────────────────
  WORKFLOW_001: {
    code: 'WORKFLOW-001',
    severity: 'warn',
    message_template: 'Workflow execution error: {detail}',
    action_template: 'Run /ezra:workflow list to verify templates.',
  },

  // ─── Workflow Enforcement (WF-xxx) ────────────────────────────
  // Keys use single underscore (PREFIX_NNN) to match error code convention.
  // The enforcement module (ezra-workflow-enforce.js) uses detailed codes
  // like WF-011-R1 internally; these catalog entries map the categories.
  WF_011: { code: 'WF-011', severity: 'error', message_template: 'Phase gate violation: {detail}', action_template: 'Ensure test files exist and .ezra/governance.yaml is present.' },
  WF_012: { code: 'WF-012', severity: 'warn', message_template: 'Code review violation: {detail}', action_template: 'Add JSDoc comment above exported functions.' },
  WF_014: { code: 'WF-014', severity: 'warn', message_template: 'Coverage gate violation: {detail}', action_template: 'Add jest.config or vitest.config.' },
  WF_015: { code: 'WF-015', severity: 'warn', message_template: 'Dependency audit violation: {detail}', action_template: 'Pin dependency to exact version.' },
  WF_016: { code: 'WF-016', severity: 'error', message_template: 'Release prep violation: {detail}', action_template: 'Create CHANGELOG.md before release.' },
  WF_017: { code: 'WF-017', severity: 'error', message_template: 'Hotfix violation: {detail}', action_template: 'Remove debug logging statements.' },
  WF_021: { code: 'WF-021', severity: 'error', message_template: 'Security audit violation: {detail}', action_template: 'Move credentials to environment variables or vault.' },
  WF_022: { code: 'WF-022', severity: 'warn', message_template: 'Compliance violation: {detail}', action_template: 'Add LICENSE file to project root.' },
  WF_025: { code: 'WF-025', severity: 'error', message_template: 'Vulnerability response violation: {detail}', action_template: 'Use DOMPurify.sanitize() or textContent.' },
  WF_026: { code: 'WF-026', severity: 'info', message_template: 'Doc completeness violation: {detail}', action_template: 'Add JSDoc comment above module.exports.' },
  WF_041: { code: 'WF-041', severity: 'warn', message_template: 'Build validation violation: {detail}', action_template: 'Move to devDependencies or remove.' },
  WF_045: { code: 'WF-045', severity: 'error', message_template: 'Pipeline security violation: {detail}', action_template: 'Use execFile() with array args instead.' },
  WF_051: { code: 'WF-051', severity: 'warn', message_template: 'OTAO loop violation: {detail}', action_template: 'Add break/return condition to while(true).' },
  WF_057: { code: 'WF-057', severity: 'error', message_template: 'Human gate violation: {detail}', action_template: 'Add confirmation guard before destructive operations.' },
  WF_060: { code: 'WF-060', severity: 'warn', message_template: 'Token budget violation: {detail}', action_template: 'Add max_tokens parameter to LLM calls.' },
  WF_063: { code: 'WF-063', severity: 'error', message_template: 'MCP security violation: {detail}', action_template: 'Add permission validation before MCP tool calls.' },
  WF_070: { code: 'WF-070', severity: 'error', message_template: 'Zero-trust violation: {detail}', action_template: 'Add input validation (zod/joi/yup).' },
  WF_076: { code: 'WF-076', severity: 'error', message_template: 'DB migration violation: {detail}', action_template: 'Add IF EXISTS clause.' },
  WF_081: { code: 'WF-081', severity: 'warn', message_template: 'TDD violation: {detail}', action_template: 'Add describe/it/test blocks.' },
  WF_082: { code: 'WF-082', severity: 'warn', message_template: 'E2E suite violation: {detail}', action_template: 'Create tests/e2e or cypress directory.' },
  WF_087: { code: 'WF-087', severity: 'info', message_template: 'ADR workflow violation: {detail}', action_template: 'Create docs/adr directory.' },
  WF_091: { code: 'WF-091', severity: 'warn', message_template: 'Failure pattern violation: {detail}', action_template: 'Add error logging inside catch blocks.' },
  WF_092: { code: 'WF-092', severity: 'warn', message_template: 'Fail-safe violation: {detail}', action_template: 'Add .catch() handler to Promise chains.' },
  WF_095: { code: 'WF-095', severity: 'error', message_template: 'AI gateway violation: {detail}', action_template: 'Add timeout or AbortSignal to LLM API calls.' },
  WF_097: { code: 'WF-097', severity: 'warn', message_template: 'Governance evidence violation: {detail}', action_template: 'Create .ezra/decisions/ directory for audit trail.' },
  WF_098: { code: 'WF-098', severity: 'error', message_template: 'HITL approval violation: {detail}', action_template: 'Add confidence/threshold guard before deploy/publish.' },

  // ─── AVI-OS Bridge Hook ───────────────────────────────────────
  AVIOS_001: {
    code: 'AVIOS-001',
    severity: 'warn',
    message_template: 'AVI-OS bridge sync failure: {detail}',
    action_template: 'Check .ezra/avios/ directory and avios-context MCP.',
  },

  // ─── Installer ────────────────────────────────────────────────
  INSTALLER_001: {
    code: 'INSTALLER-001',
    severity: 'warn',
    message_template: 'Install operation failed: {detail}',
    action_template: 'Run /ezra:install with --verbose for details.',
  },

  // ─── Tier Gate Hook ───────────────────────────────────────────
  TIER_001: {
    code: 'TIER-001',
    severity: 'info',
    message_template: 'Feature gated: {detail}',
    action_template: 'Run /ezra:license to see tier features.',
  },

  // ─── HTTP Utility ─────────────────────────────────────────────
  HTTP_001: {
    code: 'HTTP-001',
    severity: 'error',
    message_template: 'SSRF attempt blocked: {url}',
    action_template: 'Use only allowed external URLs.',
  },
  HTTP_002: {
    code: 'HTTP-002',
    severity: 'warn',
    message_template: 'HTTP request failed: {detail}',
    action_template: 'Check network connectivity and retry.',
  },
};

/**
 * Format an error code with context variables.
 * @param {string} codeKey - Key from ERROR_CODES (e.g. 'GUARD_001')
 * @param {Object} [ctx] - Context variables to interpolate (e.g. { path: 'src/auth.js' })
 * @returns {string} Formatted error message for console.error()
 */
function formatError(codeKey, ctx) {
  const def = ERROR_CODES[codeKey];
  if (!def) return 'EZRA [UNKNOWN]: Unknown error code ' + codeKey;

  const context = ctx || {};
  let msg = def.message_template;
  let action = def.action_template;

  // Interpolate {key} placeholders
  for (const [key, val] of Object.entries(context)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    msg = msg.replace(new RegExp('\\{' + escaped + '\\}', 'g'), String(val));
    action = action.replace(new RegExp('\\{' + escaped + '\\}', 'g'), String(val));
  }

  return 'EZRA [' + def.code + ']: ' + msg + ' ' + action;
}

module.exports = { ERROR_CODES, formatError };
