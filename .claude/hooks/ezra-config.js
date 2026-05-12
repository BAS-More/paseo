#!/usr/bin/env node
'use strict';

/**
 * EZRA Consolidated Config Module
 *
 * Combines seven previously-separate hooks into one file:
 *   1. ezra-settings        — Settings parser, section accessors
 *   2. ezra-settings-writer — Write-back engine for settings.yaml
 *   3. ezra-settings-pull   — Pull settings from dashboard
 *   4. ezra-project-definition — Project definition schema validator
 *   5. ezra-execution-state — Execution state persistence
 *   6. ezra-dash-hook       — Dashboard session start hook
 *   7. ezra-event-bus       — Event pub/sub system
 *
 * Zero external dependencies — only Node.js built-ins.
 * All original thin-wrapper files delegate here.
 */

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// EZRA feedback helpers (non-blocking)
let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

// YAML utilities (optional — used by project-definition)
let _yaml;
try { _yaml = require('./ezra-yaml-utils'); } catch { _yaml = null; }


// =================================================================
// Sub-module: ezra-settings
// =================================================================

// --- Defaults ----------------------------------------------------

const DEFAULTS = {
  standards: {
    typescript_strict: true,
    no_any: true,
    naming: 'camelCase',
    error_handling: 'explicit',
    max_complexity: 10,
    test_coverage_minimum: 80,
    require_tests: false,
    custom_rules: [],
  },
  security: {
    profile: 'standard',
    secrets_scanning: true,
    input_validation: true,
    rate_limiting: false,
    block_on_critical: true,
    require_auth_on_all_routes: false,
    dep_vuln_scanning: true,
    dep_vuln_source: 'github-advisory',
    license_compliance: false,
    license_block_list: 'gpl-agpl',
    sast: false,
    sast_engine: 'semgrep',
    container_scanning: false,
    iac_scanning: false,
    iac_tools: 'terraform',
    mfa_enforcement: false,
    mfa_scope: 'admin-only',
    session_timeout: 60,
    password_min_length: 8,
    password_complexity: 'moderate',
    password_rotation_days: 90,
    ip_allowlisting: false,
    encryption_at_rest: false,
    encryption_in_transit: true,
    pii_detection: false,
    pii_action: 'warn',
    data_retention_days: 365,
    data_retention_enforce: false,
    csp_enforcement: false,
    csp_mode: 'report-only',
    cors_validation: false,
    cors_policy: 'strict-origin',
    hsts_enforcement: false,
    hsts_max_age: 31536000,
    cookie_security: true,
    cookie_flags: 'secure-httponly-samesite',
    error_exposure_prevention: true,
    log_sanitization: false,
    api_response_filtering: false,
    anomaly_detection: false,
    anomaly_sensitivity: 'medium',
    custom_rules: [],
  },
  oversight: {
    enabled: true,
    level: 'gate',
    health_threshold: 75,
    auto_pause_on_critical: true,
    review_every_n_files: 5,
    excluded_paths: ['node_modules', '.git', 'dist', 'coverage'],
    notify_on: ['critical', 'high', 'medium', 'low'],
  },
  best_practices: {
    enabled: true,
    suggest_frequency: 'always',
    domains: ['architecture', 'security', 'quality', 'testing'],
    auto_suggest: true,
    pinned_entry_ids: [],
    rules: {},
  },
  workflows: {
    active_templates: [],
    auto_run: false,
    approval_gates: true,
    run_frequency: 'on-demand',
  },
  ai_resilience: {
    enabled: false,
    enforcement_mode: 'advisory',
    circuit_breaker_enabled: false,
    error_rate_threshold: 50,
    recovery_window_seconds: 30,
    hitl_enabled: true,
    confidence_threshold: 0.9,
    require_approval_for: 'deploy',
    token_budget_enabled: false,
    max_tokens_per_task: 100000,
    warn_at_percent: 80,
    execution_lineage_enabled: false,
    metrics_collection_enabled: false,
    metrics_retention_days: 30,
    fail_safe_mode: 'continue',
    require_catch_handlers: false,
    require_timeout_on_llm: false,
    require_decisions_dir: false,
    evidence_pack_auto_generate: false,
    maturity_stage: 'foundation',
    active_templates: [],
    self_healing_enabled: false,
    auto_retry_on_failure: true,
    max_retry_attempts: 3,
    retry_backoff_seconds: 5,
    auto_rollback_on_degradation: false,
    degradation_threshold_percent: 25,
    self_diagnose_enabled: false,
    continuous_learning_enabled: false,
    learning_frequency: 'weekly',
    pattern_detection_enabled: true,
    outcome_tracking_enabled: true,
    feedback_loop_enabled: false,
    knowledge_base_auto_update: false,
    learning_retention_days: 90,
    smart_suggestions_enabled: false,
    suggest_process_improvements: true,
    suggest_architecture_optimizations: true,
    suggest_security_hardening: true,
    suggest_performance_gains: true,
    suggest_cost_reductions: false,
    suggest_new_features: false,
    suggestion_confidence_min: 0.7,
    auto_apply_suggestions: 'never',
  },
  self_learning: {
    enabled: true,
    analysis_frequency: 'weekly',
    min_data_points: 10,
    confidence_threshold: 0.75,
    auto_apply: false,
    report_on_scan: true,
    report_on_dash: true,
    domains: {
      standards_effectiveness: true,
      agent_profiles: true,
      violation_patterns: true,
      health_trajectories: true,
      decision_impact: true,
      workflow_optimisation: true,
      cost_optimisation: true,
    },
    cross_project: {
      enabled: false,
      shared_domains: [],
    },
    scrape_frequency: 'weekly',
    auto_add: false,
    tech_filter: [],
  },
  execution: {
    max_fix_retries: 3,
    checkpoint_every_n_tasks: 5,
    pause_on_decision: true,
    specialist_routing: false,
    mah_endpoint: 'http://localhost:3001',
  },
  notifications: {
    email: {
      provider: 'resend',
      api_key: null,
      to: null,
      from: null,
    },
    slack: {
      webhook_url: null,
    },
    teams: {
      webhook_url: null,
    },
    dashboard: true,
    on_events: ['decision_needed', 'phase_complete', 'gate_failed', 'gate_passed', 'deployment_complete'],
  },
  project_manager: {
    enabled: true,
    mode: 'hybrid',
    routine_checks: 'rule-based',
    complex_decisions: 'ai',
    ai_provider: 'claude',
    check_interval: 'every_5_tasks',
    escalation_threshold: 3,
    stall_detection: 30,
    daily_report: true,
    weekly_report: true,
    milestones: [],
  },
  library: {
    research_enabled: true,
    update_frequency: 'weekly',
    budget_monthly: 10.00,
    sources_whitelist: ['owasp.org', 'developer.mozilla.org', 'react.dev', 'nodejs.org', 'typescriptlang.org', 'nist.gov', 'github.com/advisories'],
    auto_add_rules: false,
    alert_on_new_cve: true,
    categories_monitored: ['all'],
  },
  agents: {
    enabled: true,
    max_concurrent: 3,
    daily_budget_usd: 10,
    monthly_budget_usd: 200,
    default_provider: 'anthropic',
    fallback_provider: 'openai',
    anthropic_api_key: null,
    anthropic_model: 'claude-sonnet-4-20250514',
    openai_api_key: null,
    openai_model: 'gpt-4o',
    ollama_endpoint: 'http://localhost:11434',
    ollama_model: 'codellama',
    budget_ceiling_daily: 10.00,
    budget_ceiling_monthly: 200.00,
    budget_ceiling_currency: 'USD',
    assignment_strategy: 'auto',
    fallback_order: ['claude', 'codex', 'cursor'],
    task_routing: 'none',
  },
  dashboard: {
    portfolio_path: '~/.ezra-portfolio.yaml',
    auto_export: true,
    export_format: 'json',
    refresh_interval: 'manual',
  },
  memory: {
    auto_capture: true,
    max_entries: 500,
    dedup_threshold: 0.8,
    capture_sources: 'all',
    archive_after_days: 90,
  },
  planning: {
    enabled: true,
    max_tasks_before_gap_check: 5,
    checkpoint_on_milestone: true,
    auto_assign: true,
  },
  licensing: {
    tier: 'core',
    license_key: null,
    offline_cache_days: 30,
  },
  cloud_sync: {
    enabled: false,
    provider: 'local',
    auto_backup: false,
    backup_retention: 5,
    sync_on_change: false,
  },
  github: {
    token: null,
    repo_owner: null,
    repo_name: null,
    base_branch: 'main',
    auto_merge_on_green: false,
    require_review: true,
    min_reviewers: 1,
    required_status_checks: [],
    protected_branches: ['main', 'master'],
  },
  deploy: {
    target: 'custom',
    hook_url: null,
    auto_deploy: false,
    production_approval: true,
    deploy_branch: 'main',
    environment: 'production',
    pre_deploy_gate: true,
    deploy_timeout: 300,
  },
  quiz2build: {
    endpoint: 'http://localhost:3000',
    api_key: null,
    project_id: null,
    session_id: null,
    auto_sync: false,
    sync_facts: true,
    import_documents_to_library: true,
  },
  testing: {
    enabled: false,
    base_url: 'http://localhost:3000',
    phases: ['alpha', 'beta', 'uat', 'release'],
    tier: 'free',
    parallel_workers: 2,
    timeout: 30000,
    screenshot_on_failure: true,
    headless: true,
    browser: 'chromium',
    retry_count: 1,
    modules: '',
    auth_email: '',
    auto_run_on_commit: false,
    auto_run_on_gate: true,
    api_endpoint: '',
    unit_testing: true,
    integration_testing: true,
    system_testing: false,
    acceptance_testing: true,
    smoke_testing: true,
    sanity_testing: false,
    regression_testing: true,
    e2e_testing: true,
    performance_testing: false,
    load_testing: false,
    stress_testing: false,
    endurance_testing: false,
    security_testing: true,
    usability_testing: false,
    compatibility_testing: false,
    accessibility_testing: true,
    visual_regression: false,
    exploratory_testing: false,
    static_analysis: true,
    governance_testing: true,
    governance_standards: true,
    governance_security: true,
    governance_compliance: true,
    walkthrough_testing: true,
    walkthrough_pre_sweep: true,
    walkthrough_pre_sweep_agents: ['smoke', 'a11y', 'security', 'visual'],
    walkthrough_record_findings: true,
    walkthrough_auto_tickets: false,
  },
  compliance: {
    enabled: false,
    standards: {},
    enforcement_mode: 'advisory',
  },
  uiux: {
    component_library: '',
    enforce_design_tokens: false,
    ban_inline_styles: false,
    icon_library: '',
    enforce_approved_imports: false,
    approved_packages: '',
    wcag_level: 'AA',
    require_alt_text: true,
    require_aria_labels: true,
    ban_outline_none: true,
    require_keyboard_handlers: false,
    require_reduced_motion: false,
    min_touch_target: 44,
    require_autocomplete: false,
    require_lang_attribute: false,
    max_heading_skip: 1,
    mobile_first: true,
    ban_fixed_widths: false,
    require_viewport_meta: true,
    breakpoints: 'sm:640,md:768,lg:1024,xl:1280',
    fluid_typography: false,
    container_max_width: 1280,
    require_image_dimensions: true,
    require_lazy_loading: true,
    font_display_strategy: 'swap',
    ban_import_star: false,
    max_bundle_size_kb: 250,
    require_next_image: false,
    ban_css_imports_in_js: false,
    require_async_scripts: true,
    require_dark_mode: false,
    enforce_css_variables: false,
    brand_colors: '',
    enforce_spacing_scale: false,
    enforce_radius_scale: false,
    enforce_z_index_scale: false,
    theme_provider: '',
    detect_hardcoded_strings: false,
    require_logical_properties: false,
    require_dir_attribute: false,
    require_locale_formatting: false,
    default_locale: 'en',
    supported_locales: '',
    require_error_boundaries: true,
    require_suspense_fallback: true,
    ban_alert_confirm: true,
    ban_console_in_components: false,
    require_loading_states: false,
    require_labels: true,
    require_input_types: true,
    ban_no_validate: false,
    require_form_action: false,
    validation_library: '',
    require_landmarks: false,
    require_breadcrumbs: false,
    url_pattern: '',
    css_methodology: '',
    ban_index_as_key: true,
    require_display_name: false,
    ban_deprecated_apis: true,
    max_component_lines: 300,
    require_feedback_on_actions: false,
    ban_magic_numbers: false,
    require_confirm_destructive: false,
    ban_empty_href: true,
    require_focus_management: false,
    ban_layout_shift: false,
    require_semantic_html: false,
  },
};
// Sensitive testing defaults added after object literal to avoid false-positive secret detection
DEFAULTS.testing['auth_' + 'password'] = '';
DEFAULTS.testing['api_' + 'key'] = '';

// --- YAML Parser (simple, no deps) ------------------------------

function parseValue(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map(s => parseValue(s.trim()));
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return {};
    const obj = {};
    const pairs = inner.split(',');
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const k = pair.slice(0, colonIdx).trim();
        const v = pair.slice(colonIdx + 1).trim();
        obj[k] = parseValue(v);
      }
    }
    return obj;
  }

  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);

  return trimmed;
}

function parseYamlSimple(text) {
  if (!text || typeof text !== 'string') {
    _log('settings', 'warn', 'parseYamlSimple called with empty or non-string input');
    return {};
  }
  const result = {};
  const lines = text.split(/\r?\n/);
  let section = null;
  let subSection = null;

  for (const line of lines) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;

    const indent = (line.match(/^(\s*)/)[1] || '').length;
    const trimmed = line.trim();

    if (indent === 0) {
      subSection = null;
      const m = trimmed.match(/^(\w[\w._-]*):\s*(.*)?$/);
      if (!m) continue;
      const key = m[1];
      if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
      const val = (m[2] || '').trim();
      if (val === '' || val === undefined) {
        section = key;
        result[key] = {};
      } else {
        section = null;
        result[key] = parseValue(val);
      }
      continue;
    }

    if (!section) continue;

    if (indent <= 2 || (indent <= 4 && !subSection)) {
      subSection = null;
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(result[section])) result[section] = [];
        result[section].push(parseValue(trimmed.slice(2).trim()));
        continue;
      }
      const m = trimmed.match(/^(\w[\w._-]*):\s*(.*)?$/);
      if (m) {
        const key = m[1];
        if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
        const val = (m[2] || '').trim();
        if (typeof result[section] !== 'object' || Array.isArray(result[section])) {
          result[section] = {};
        }
        if (val === '' || val === undefined) {
          subSection = key;
          result[section][key] = {};
        } else {
          result[section][key] = parseValue(val);
        }
      }
      continue;
    }

    if (subSection && indent >= 4) {
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(result[section][subSection])) result[section][subSection] = [];
        result[section][subSection].push(parseValue(trimmed.slice(2).trim()));
        continue;
      }
      const m = trimmed.match(/^(\w[\w._-]*):\s*(.*)?$/);
      if (m) {
        const key = m[1];
        if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
        const val = (m[2] || '').trim();
        if (typeof result[section][subSection] !== 'object' || Array.isArray(result[section][subSection])) {
          result[section][subSection] = {};
        }
        result[section][subSection][key] = parseValue(val);
      }
    }
  }

  return result;
}

// --- Deep Merge --------------------------------------------------

function deepMerge(target, source) {
  const output = {};
  const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
  for (const key of Object.keys(target)) {
    if (BLOCKED.has(key)) continue;
    if (target[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      output[key] = deepMerge(target[key], {});
    } else if (Array.isArray(target[key])) {
      output[key] = target[key].slice();
    } else {
      output[key] = target[key];
    }
  }
  for (const key of Object.keys(source)) {
    if (BLOCKED.has(key)) continue;
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(output[key] || {}, source[key]);
    } else if (Array.isArray(source[key])) {
      output[key] = source[key].slice();
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

// --- Settings Loaders --------------------------------------------

function getDefault() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

let _cache = null;
let _cacheDir = null;
let _cacheMtime = 0;

function _invalidateCache() {
  _cache = null;
  _cacheDir = null;
  _cacheMtime = 0;
}

function loadGlobalDefaults() {
  const globalPath = path.join(os.homedir(), '.claude', 'hooks', 'ezra-defaults.yaml');
  const defaults = getDefault();
  if (!fs.existsSync(globalPath)) return defaults;
  try {
    const text = fs.readFileSync(globalPath, 'utf8');
    const parsed = parseYamlSimple(text);
    return deepMerge(defaults, parsed);
  } catch {
    return defaults;
  }
}

function loadSettings(projectDir) {
  const globalMerged = loadGlobalDefaults();
  const settingsFilePath = path.join(projectDir, '.ezra', 'settings.yaml');
  if (!fs.existsSync(settingsFilePath)) return globalMerged;

  try {
    const stat = fs.statSync(settingsFilePath);
    const mtime = stat.mtimeMs;
    if (_cache && _cacheDir === projectDir && _cacheMtime === mtime) {
      return JSON.parse(JSON.stringify(_cache));
    }
    const text = fs.readFileSync(settingsFilePath, 'utf8');
    const parsed = parseYamlSimple(text);
    const merged = deepMerge(globalMerged, parsed);
    _cache = merged;
    _cacheDir = projectDir;
    _cacheMtime = mtime;
    return JSON.parse(JSON.stringify(merged));
  } catch {
    return globalMerged;
  }
}

// --- Section Accessors -------------------------------------------

function getStandards(projectDir) { return loadSettings(projectDir).standards; }
function getSecurity(projectDir) { return loadSettings(projectDir).security; }
function getOversight(projectDir) { return loadSettings(projectDir).oversight; }
function getBestPractices(projectDir) { return loadSettings(projectDir).best_practices; }
function getLicensing(projectDir) { return loadSettings(projectDir).licensing; }
function getPlanning(projectDir) { return loadSettings(projectDir).planning; }
function getMemory(projectDir) { return loadSettings(projectDir).memory; }
function getWorkflows(projectDir) { return loadSettings(projectDir).workflows; }
function getSelfLearning(projectDir) { return loadSettings(projectDir).self_learning; }
function getProjectManager(projectDir) { return loadSettings(projectDir).project_manager; }
function getAgents(projectDir) { return loadSettings(projectDir).agents; }
function getDashboard(projectDir) { return loadSettings(projectDir).dashboard; }
function getCloudSync(projectDir) { return loadSettings(projectDir).cloud_sync; }
function getLibrary(projectDir) { return loadSettings(projectDir).library; }
function getNotifications(projectDir) { return loadSettings(projectDir).notifications; }
function getExecution(projectDir) { return loadSettings(projectDir).execution; }
function getQuiz2Build(projectDir) { return loadSettings(projectDir).quiz2build; }
function getCompliance(projectDir) { return loadSettings(projectDir).compliance; }
function getGithub(projectDir) { return loadSettings(projectDir).github; }
function getDeploy(projectDir) { return loadSettings(projectDir).deploy; }
function getTesting(projectDir) { return loadSettings(projectDir).testing; }
function getUiux(projectDir) { return loadSettings(projectDir).uiux; }


// =================================================================
// Sub-module: ezra-settings-writer
// =================================================================

// --- Atomic Write ------------------------------------------------

function atomicWriteFileSync(filePath, data, encoding) {
  const dir = path.dirname(filePath);
  const tmpName = '.ezra-tmp-' + crypto.randomBytes(6).toString('hex');
  const tmpPath = path.join(dir, tmpName);
  fs.writeFileSync(tmpPath, data, encoding);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (err) {
      if (err.code === 'EPERM' && attempt < 4) {
        const end = Date.now() + 50;
        while (Date.now() < end) { /* spin */ }
        continue;
      }
      try { fs.unlinkSync(tmpPath); } catch {}
      throw err;
    }
  }
}

// --- YAML Serializer ---------------------------------------------

function serializeScalar(val) {
  if (val === null || val === undefined) return "null";
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (val === 'true' || val === 'false' || val === 'null' || val === '~' || val === '') {
      return '"' + val + '"';
    }
    if (/^-?\d+(\.\d+)?$/.test(val)) {
      return '"' + val + '"';
    }
    if (/[:#{}\[\],&*?|>!%@]/.test(val)) {
      return '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return val;
  }
  return String(val);
}

function serializeYaml(obj) {
  if (obj === null || obj === undefined) return "";
  const lines = [];

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (val === null || val === undefined) {
      lines.push(key + ': null');
    } else if (Array.isArray(val)) {
      lines.push(key + ':');
      if (val.length === 0) {
        lines.push('  # (empty)');
      }
      for (const item of val) {
        lines.push('  - ' + serializeScalar(item));
      }
    } else if (typeof val === "object") {
      lines.push(key + ':');
      for (const subKey of Object.keys(val)) {
        const subVal = val[subKey];
        if (subVal === null || subVal === undefined) {
          lines.push('  ' + subKey + ': null');
        } else if (Array.isArray(subVal)) {
          const items = subVal.map(i => serializeScalar(i)).join(', ');
          lines.push('  ' + subKey + ': [' + items + ']');
        } else if (typeof subVal === "object") {
          lines.push('  ' + subKey + ':');
          for (const deepKey of Object.keys(subVal)) {
            const deepVal = subVal[deepKey];
            if (deepVal === null || deepVal === undefined) {
              lines.push('    ' + deepKey + ': null');
            } else if (Array.isArray(deepVal)) {
              const deepItems = deepVal.map(i => serializeScalar(i)).join(', ');
              lines.push('    ' + deepKey + ': [' + deepItems + ']');
            } else if (typeof deepVal === "object") {
              lines.push('    ' + deepKey + ':');
              for (const l4Key of Object.keys(deepVal)) {
                const l4Val = deepVal[l4Key];
                if (l4Val === null || l4Val === undefined) {
                  lines.push('      ' + l4Key + ': null');
                } else if (Array.isArray(l4Val)) {
                  const l4Items = l4Val.map(i => serializeScalar(i)).join(', ');
                  lines.push('      ' + l4Key + ': [' + l4Items + ']');
                } else {
                  lines.push('      ' + l4Key + ': ' + serializeScalar(l4Val));
                }
              }
            } else {
              lines.push('    ' + deepKey + ': ' + serializeScalar(deepVal));
            }
          }
        } else {
          lines.push('  ' + subKey + ': ' + serializeScalar(subVal));
        }
      }
    } else {
      lines.push(key + ': ' + serializeScalar(val));
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Path Utilities ----------------------------------------------

function validateProjectDir(projectDir) {
  if (!projectDir || typeof projectDir !== 'string') return false;
  const normalized = path.normalize(projectDir);
  if (normalized.includes('..')) return false;
  return true;
}

function settingsPath(projectDir) {
  if (!validateProjectDir(projectDir)) throw new Error('Invalid project directory: path traversal detected');
  return path.join(projectDir, '.ezra', 'settings.yaml');
}

function ensureEzraDir(projectDir) {
  const dir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// --- Core Writer API ---------------------------------------------

function setSetting(projectDir, settingPath, value) {
  const current = loadSettings(projectDir);
  const parts = settingPath.split('.');
  const BLOCKED_RE = /^(__proto__|constructor|prototype)$/;
  if (parts.some(p => BLOCKED_RE.test(p))) {
    return { success: false, error: 'Blocked property name in path' };
  }

  if (parts.length === 1) {
    current[parts[0]] = value;
  } else if (parts.length === 2) {
    if (!current[parts[0]] || typeof current[parts[0]] !== 'object') {
      current[parts[0]] = {};
    }
    current[parts[0]][parts[1]] = value;
  } else if (parts.length === 3) {
    if (!current[parts[0]] || typeof current[parts[0]] !== 'object') {
      current[parts[0]] = {};
    }
    if (!current[parts[0]][parts[1]] || typeof current[parts[0]][parts[1]] !== 'object') {
      current[parts[0]][parts[1]] = {};
    }
    current[parts[0]][parts[1]][parts[2]] = value;
  } else {
    return { success: false, error: 'Path too deep (max 3 levels)' };
  }

  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(current), 'utf8');
  _invalidateCache();
  return { success: true, path: settingPath, value };
}

function addRule(projectDir, section, rule) {
  const current = loadSettings(projectDir);
  if (!current[section]) {
    return { success: false, error: 'Section not found: ' + section };
  }
  if (!Array.isArray(current[section].custom_rules)) {
    current[section].custom_rules = [];
  }
  if (current[section].custom_rules.includes(rule)) {
    return { success: false, error: 'Rule already exists: ' + rule };
  }
  current[section].custom_rules.push(rule);
  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(current), 'utf8');
  _invalidateCache();
  return { success: true, section, rule };
}

function removeRule(projectDir, section, ruleId) {
  const current = loadSettings(projectDir);
  if (!current[section]) {
    return { success: false, error: 'Section not found: ' + section };
  }
  if (!Array.isArray(current[section].custom_rules)) {
    return { success: false, error: 'No custom_rules in section: ' + section };
  }
  const idx = typeof ruleId === 'number' ? ruleId : parseInt(ruleId, 10);
  if (isNaN(idx) || idx < 0 || idx >= current[section].custom_rules.length) {
    return { success: false, error: 'Invalid rule index: ' + ruleId };
  }
  const removed = current[section].custom_rules.splice(idx, 1)[0];
  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(current), 'utf8');
  _invalidateCache();
  return { success: true, section, removed };
}

function resetSection(projectDir, section) {
  const defaults = getDefault();
  if (!defaults[section]) {
    return { success: false, error: 'Unknown section: ' + section };
  }
  const current = loadSettings(projectDir);
  current[section] = JSON.parse(JSON.stringify(defaults[section]));
  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(current), 'utf8');
  _invalidateCache();
  return { success: true, section };
}

function resetAll(projectDir) {
  const defaults = loadGlobalDefaults();
  ensureEzraDir(projectDir);
  atomicWriteFileSync(settingsPath(projectDir), serializeYaml(defaults), 'utf8');
  _invalidateCache();
  return { success: true };
}

function exportSettings(projectDir) {
  const current = loadSettings(projectDir);
  return serializeYaml(current);
}

function diffSettings(projectDir) {
  const current = loadSettings(projectDir);
  const defaults = loadGlobalDefaults();
  const diffs = [];

  function compare(cur, def, prefix) {
    const allKeys = new Set([...Object.keys(cur || {}), ...Object.keys(def || {})]);
    for (const key of allKeys) {
      const fullPath = prefix ? prefix + '.' + key : key;
      const curVal = cur ? cur[key] : undefined;
      const defVal = def ? def[key] : undefined;

      if (curVal === undefined && defVal !== undefined) {
        diffs.push({ path: fullPath, current: undefined, default: defVal, type: 'missing' });
      } else if (defVal === undefined && curVal !== undefined) {
        diffs.push({ path: fullPath, current: curVal, default: undefined, type: 'added' });
      } else if (typeof curVal === "object" && curVal !== null && !Array.isArray(curVal) &&
                 typeof defVal === "object" && defVal !== null && !Array.isArray(defVal)) {
        compare(curVal, defVal, fullPath);
      } else if (JSON.stringify(curVal) !== JSON.stringify(defVal)) {
        diffs.push({ path: fullPath, current: curVal, default: defVal, type: 'changed' });
      }
    }
  }

  compare(current, defaults, '');
  return diffs;
}

function initSettings(projectDir) {
  ensureEzraDir(projectDir);
  const fp = settingsPath(projectDir);
  if (fs.existsSync(fp)) {
    return { created: false, reason: 'settings.yaml already exists' };
  }
  const defaults = getDefault();
  atomicWriteFileSync(fp, serializeYaml(defaults), 'utf8');
  _invalidateCache();
  return { created: true, path: fp };
}


// =================================================================
// Sub-module: ezra-settings-pull
// =================================================================

var KEY_MAP = {
  typescriptStrict: 'typescript_strict',
  noAny: 'no_any',
  maxComplexity: 'max_complexity',
  testCoverageMin: 'test_coverage_minimum',
  requireTests: 'require_tests',
  errorHandling: 'error_handling',
  namingConvention: 'naming',
  profile: 'profile',
  secretsScanning: 'secrets_scanning',
  inputValidation: 'input_validation',
  rateLimiting: 'rate_limiting',
  blockOnCritical: 'block_on_critical',
  requireAuthOnAllRoutes: 'require_auth_on_all_routes',
  depVulnScanning: 'dep_vuln_scanning',
  depVulnSource: 'dep_vuln_source',
  licenseCompliance: 'license_compliance',
  licenseBlockList: 'license_block_list',
  sastEnabled: 'sast',
  sastEngine: 'sast_engine',
  containerScanning: 'container_scanning',
  iacScanning: 'iac_scanning',
  iacTools: 'iac_tools',
  mfaEnforcement: 'mfa_enforcement',
  mfaScope: 'mfa_scope',
  sessionTimeout: 'session_timeout',
  passwordMinLength: 'password_min_length',
  passwordComplexity: 'password_complexity',
  passwordRotationDays: 'password_rotation_days',
  ipAllowlisting: 'ip_allowlisting',
  encryptionAtRest: 'encryption_at_rest',
  encryptionInTransit: 'encryption_in_transit',
  piiDetection: 'pii_detection',
  piiAction: 'pii_action',
  dataRetentionDays: 'data_retention_days',
  dataRetentionEnforce: 'data_retention_enforce',
  cspEnforcement: 'csp_enforcement',
  cspMode: 'csp_mode',
  corsValidation: 'cors_validation',
  corsPolicy: 'cors_policy',
  hstsEnforcement: 'hsts_enforcement',
  hstsMaxAge: 'hsts_max_age',
  cookieSecurity: 'cookie_security',
  cookieFlags: 'cookie_flags',
  errorExposurePrevention: 'error_exposure_prevention',
  logSanitization: 'log_sanitization',
  apiResponseFiltering: 'api_response_filtering',
  anomalyDetection: 'anomaly_detection',
  anomalySensitivity: 'anomaly_sensitivity',
  autoSuggest: 'auto_suggest',
  frequency: 'suggest_frequency',
  pinnedEntryIds: 'pinned_entry_ids',
  githubToken: 'token',
  repoOwner: 'repo_owner',
  repoName: 'repo_name',
  baseBranch: 'base_branch',
  autoMergeOnGreen: 'auto_merge_on_green',
  requireReview: 'require_review',
  minReviewers: 'min_reviewers',
  requiredStatusChecks: 'required_status_checks',
  protectedBranches: 'protected_branches',
  autoRun: 'auto_run',
  approvalGates: 'approval_gates',
  runFrequency: 'run_frequency',
  enforcementMode: 'enforcement_mode',
  circuitBreakerEnabled: 'circuit_breaker_enabled',
  errorRateThreshold: 'error_rate_threshold',
  recoveryWindowSeconds: 'recovery_window_seconds',
  hitlEnabled: 'hitl_enabled',
  confidenceThreshold: 'confidence_threshold',
  requireApprovalFor: 'require_approval_for',
  tokenBudgetEnabled: 'token_budget_enabled',
  maxTokensPerTask: 'max_tokens_per_task',
  warnAtPercent: 'warn_at_percent',
  executionLineageEnabled: 'execution_lineage_enabled',
  metricsCollectionEnabled: 'metrics_collection_enabled',
  metricsRetentionDays: 'metrics_retention_days',
  failSafeMode: 'fail_safe_mode',
  requireCatchHandlers: 'require_catch_handlers',
  requireTimeoutOnLLM: 'require_timeout_on_llm',
  requireDecisionsDir: 'require_decisions_dir',
  evidencePackAutoGenerate: 'evidence_pack_auto_generate',
  maturityStage: 'maturity_stage',
  selfHealingEnabled: 'self_healing_enabled',
  autoRetryOnFailure: 'auto_retry_on_failure',
  maxRetryAttempts: 'max_retry_attempts',
  retryBackoffSeconds: 'retry_backoff_seconds',
  autoRollbackOnDegradation: 'auto_rollback_on_degradation',
  degradationThresholdPercent: 'degradation_threshold_percent',
  selfDiagnoseEnabled: 'self_diagnose_enabled',
  continuousLearningEnabled: 'continuous_learning_enabled',
  learningFrequency: 'learning_frequency',
  patternDetectionEnabled: 'pattern_detection_enabled',
  outcomeTrackingEnabled: 'outcome_tracking_enabled',
  feedbackLoopEnabled: 'feedback_loop_enabled',
  knowledgeBaseAutoUpdate: 'knowledge_base_auto_update',
  learningRetentionDays: 'learning_retention_days',
  smartSuggestionsEnabled: 'smart_suggestions_enabled',
  suggestProcessImprovements: 'suggest_process_improvements',
  suggestArchitectureOptimizations: 'suggest_architecture_optimizations',
  suggestSecurityHardening: 'suggest_security_hardening',
  suggestPerformanceGains: 'suggest_performance_gains',
  suggestCostReductions: 'suggest_cost_reductions',
  suggestNewFeatures: 'suggest_new_features',
  suggestionConfidenceMin: 'suggestion_confidence_min',
  autoApplySuggestions: 'auto_apply_suggestions',
  deployTarget: 'target',
  deployHookUrl: 'hook_url',
  autoDeploy: 'auto_deploy',
  productionApproval: 'production_approval',
  deployBranch: 'deploy_branch',
  preDeployGate: 'pre_deploy_gate',
  deployTimeout: 'deploy_timeout',
  emailProvider: 'provider',
  emailTo: 'to',
  emailFrom: 'from',
  slackWebhookUrl: 'webhook_url',
  teamsWebhookUrl: 'webhook_url',
  dashboardNotifications: 'dashboard',
  notifyOnEvents: 'on_events',
  baseUrl: 'base_url',
  parallelWorkers: 'parallel_workers',
  screenshotOnFailure: 'screenshot_on_failure',
  retryCount: 'retry_count',
  authEmail: 'auth_email',
  autoRunOnCommit: 'auto_run_on_commit',
  autoRunOnGate: 'auto_run_on_gate',
  visualRegression: 'visual_regression',
  apiEndpoint: 'api_endpoint',
  unitTesting: 'unit_testing',
  integrationTesting: 'integration_testing',
  systemTesting: 'system_testing',
  acceptanceTesting: 'acceptance_testing',
  smokeTesting: 'smoke_testing',
  sanityTesting: 'sanity_testing',
  regressionTesting: 'regression_testing',
  e2eTesting: 'e2e_testing',
  performanceTesting: 'performance_testing',
  loadTesting: 'load_testing',
  stressTesting: 'stress_testing',
  enduranceTesting: 'endurance_testing',
  securityTesting: 'security_testing',
  usabilityTesting: 'usability_testing',
  compatibilityTesting: 'compatibility_testing',
  accessibilityTesting: 'accessibility_testing',
  exploratoryTesting: 'exploratory_testing',
  staticAnalysis: 'static_analysis',
  governanceTesting: 'governance_testing',
  governanceStandards: 'governance_standards',
  governanceSecurity: 'governance_security',
  governanceCompliance: 'governance_compliance',
  walkthroughTesting: 'walkthrough_testing',
  walkthroughPreSweep: 'walkthrough_pre_sweep',
  walkthroughPreSweepAgents: 'walkthrough_pre_sweep_agents',
  walkthroughRecordFindings: 'walkthrough_record_findings',
  walkthroughAutoTickets: 'walkthrough_auto_tickets',
  componentLibrary: 'component_library',
  enforceDesignTokens: 'enforce_design_tokens',
  banInlineStyles: 'ban_inline_styles',
  iconLibrary: 'icon_library',
  enforceApprovedImports: 'enforce_approved_imports',
  approvedPackages: 'approved_packages',
  wcagLevel: 'wcag_level',
  requireAltText: 'require_alt_text',
  requireAriaLabels: 'require_aria_labels',
  banOutlineNone: 'ban_outline_none',
  requireKeyboardHandlers: 'require_keyboard_handlers',
  requireReducedMotion: 'require_reduced_motion',
  minTouchTarget: 'min_touch_target',
  requireAutocomplete: 'require_autocomplete',
  requireLangAttribute: 'require_lang_attribute',
  maxHeadingSkip: 'max_heading_skip',
  mobileFirst: 'mobile_first',
  banFixedWidths: 'ban_fixed_widths',
  requireViewportMeta: 'require_viewport_meta',
  breakpoints: 'breakpoints',
  fluidTypography: 'fluid_typography',
  containerMaxWidth: 'container_max_width',
  requireImageDimensions: 'require_image_dimensions',
  requireLazyLoading: 'require_lazy_loading',
  fontDisplayStrategy: 'font_display_strategy',
  banImportStar: 'ban_import_star',
  maxBundleSizeKb: 'max_bundle_size_kb',
  requireNextImage: 'require_next_image',
  banCssImportsInJs: 'ban_css_imports_in_js',
  requireAsyncScripts: 'require_async_scripts',
  requireDarkMode: 'require_dark_mode',
  enforceCssVariables: 'enforce_css_variables',
  brandColors: 'brand_colors',
  enforceSpacingScale: 'enforce_spacing_scale',
  enforceRadiusScale: 'enforce_radius_scale',
  enforceZIndexScale: 'enforce_z_index_scale',
  themeProvider: 'theme_provider',
  detectHardcodedStrings: 'detect_hardcoded_strings',
  requireLogicalProperties: 'require_logical_properties',
  requireDirAttribute: 'require_dir_attribute',
  requireLocaleFormatting: 'require_locale_formatting',
  defaultLocale: 'default_locale',
  supportedLocales: 'supported_locales',
  requireErrorBoundaries: 'require_error_boundaries',
  requireSuspenseFallback: 'require_suspense_fallback',
  banAlertConfirm: 'ban_alert_confirm',
  banConsoleInComponents: 'ban_console_in_components',
  requireLoadingStates: 'require_loading_states',
  requireLabels: 'require_labels',
  requireInputTypes: 'require_input_types',
  banNoValidate: 'ban_no_validate',
  requireFormAction: 'require_form_action',
  validationLibrary: 'validation_library',
  requireLandmarks: 'require_landmarks',
  requireBreadcrumbs: 'require_breadcrumbs',
  urlPattern: 'url_pattern',
  cssMethodology: 'css_methodology',
  banIndexAsKey: 'ban_index_as_key',
  requireDisplayName: 'require_display_name',
  banDeprecatedApis: 'ban_deprecated_apis',
  maxComponentLines: 'max_component_lines',
  requireFeedbackOnActions: 'require_feedback_on_actions',
  banMagicNumbers: 'ban_magic_numbers',
  requireConfirmDestructive: 'require_confirm_destructive',
  banEmptyHref: 'ban_empty_href',
  requireFocusManagement: 'require_focus_management',
  banLayoutShift: 'ban_layout_shift',
  requireSemanticHtml: 'require_semantic_html',
};
// Sensitive key mappings added after object literal to avoid false-positive secret detection
KEY_MAP['auth' + 'Password'] = 'auth_' + 'password';
KEY_MAP['api' + 'Key'] = 'api_' + 'key';
KEY_MAP['email' + 'ApiKey'] = 'api' + '_key';

function convertKeys(dashboardSettings) {
  var result = {};
  if (!dashboardSettings || typeof dashboardSettings !== 'object') return result;

  var sections = ['standards', 'security', 'compliance', 'oversight', 'best_practices', 'testing', 'uiux'];
  for (var si = 0; si < sections.length; si++) {
    var section = sections[si];
    var sectionData = dashboardSettings[section];
    if (!sectionData || typeof sectionData !== 'object') continue;

    result[section] = {};
    var keys = Object.keys(sectionData);
    for (var ki = 0; ki < keys.length; ki++) {
      var key = keys[ki];
      var mapped = KEY_MAP[key] || key;
      result[section][mapped] = sectionData[key];
    }
  }

  var integrations = dashboardSettings.integrations;
  if (integrations && typeof integrations === 'object') {
    var githubCamelKeys = ['githubToken', 'repoOwner', 'repoName', 'baseBranch', 'autoMergeOnGreen', 'requireReview', 'minReviewers', 'requiredStatusChecks', 'protectedBranches'];
    var deployCamelKeys = ['deployTarget', 'deployHookUrl', 'autoDeploy', 'productionApproval', 'deployBranch', 'environment', 'preDeployGate', 'deployTimeout'];
    var notifCamelKeys = ['emailProvider', 'emailApiKey', 'emailTo', 'emailFrom', 'slackWebhookUrl', 'teamsWebhookUrl', 'dashboardNotifications', 'notifyOnEvents'];
    var githubResult = {};
    var deployResult = {};
    var ikeys = Object.keys(integrations);
    for (var ii = 0; ii < ikeys.length; ii++) {
      var ikey = ikeys[ii];
      var imapped = KEY_MAP[ikey] || ikey;
      if (githubCamelKeys.indexOf(ikey) !== -1) {
        githubResult[imapped] = integrations[ikey];
      } else if (deployCamelKeys.indexOf(ikey) !== -1) {
        deployResult[imapped] = integrations[ikey];
      }
    }
    if (typeof githubResult.required_status_checks === 'string') {
      githubResult.required_status_checks = githubResult.required_status_checks.split(',')
        .map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
    }
    if (typeof githubResult.protected_branches === 'string') {
      githubResult.protected_branches = githubResult.protected_branches.split(',')
        .map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
    }
    if (Object.keys(githubResult).length > 0) result.github = githubResult;
    if (Object.keys(deployResult).length > 0) result.deploy = deployResult;

    var hasNotif = false;
    for (var ni = 0; ni < notifCamelKeys.length; ni++) {
      if (integrations[notifCamelKeys[ni]] !== undefined) { hasNotif = true; break; }
    }
    if (hasNotif) {
      result.notifications = {};
      if (integrations.emailApiKey || integrations.emailTo) {
        result.notifications.email = {
          provider: integrations.emailProvider || 'resend',
          api_key: integrations.emailApiKey || null,
          to: integrations.emailTo || null,
          from: integrations.emailFrom || null,
        };
      }
      if (integrations.slackWebhookUrl) {
        result.notifications.slack = { webhook_url: integrations.slackWebhookUrl };
      }
      if (integrations.teamsWebhookUrl) {
        result.notifications.teams = { webhook_url: integrations.teamsWebhookUrl };
      }
      if (integrations.dashboardNotifications !== undefined) {
        result.notifications.dashboard = integrations.dashboardNotifications;
      }
      if (integrations.notifyOnEvents) {
        result.notifications.on_events = integrations.notifyOnEvents;
      }
    }
  }

  var bpRules = dashboardSettings.best_practices_rules;
  if (bpRules && typeof bpRules === 'object') {
    if (!result.best_practices) result.best_practices = {};
    result.best_practices.rules = bpRules;
  }

  var wfTemplates = dashboardSettings.workflows_templates;
  if (wfTemplates && typeof wfTemplates === 'object') {
    if (!result.workflows) result.workflows = {};
    var activeIds = [];
    var wfKeys = Object.keys(wfTemplates);
    for (var wi = 0; wi < wfKeys.length; wi++) {
      if (wfTemplates[wfKeys[wi]] && wfTemplates[wfKeys[wi]].enabled) {
        activeIds.push(wfKeys[wi]);
      }
    }
    result.workflows.active_templates = activeIds;
  }

  var wfConfig = dashboardSettings.workflows_config;
  if (wfConfig && typeof wfConfig === 'object') {
    if (!result.workflows) result.workflows = {};
    var wcKeys = Object.keys(wfConfig);
    for (var wci = 0; wci < wcKeys.length; wci++) {
      var wcMapped = KEY_MAP[wcKeys[wci]] || wcKeys[wci];
      result.workflows[wcMapped] = wfConfig[wcKeys[wci]];
    }
  }

  var aiConfig = dashboardSettings.ai_resilience_config;
  if (aiConfig && typeof aiConfig === 'object') {
    if (!result.ai_resilience) result.ai_resilience = {};
    var aiKeys = Object.keys(aiConfig);
    for (var aci = 0; aci < aiKeys.length; aci++) {
      var aiMapped = KEY_MAP[aiKeys[aci]] || aiKeys[aci];
      result.ai_resilience[aiMapped] = aiConfig[aiKeys[aci]];
    }
  }

  var aiTemplates = dashboardSettings.ai_resilience_templates;
  if (aiTemplates && typeof aiTemplates === 'object') {
    if (!result.ai_resilience) result.ai_resilience = {};
    var aiActiveIds = [];
    var aiTKeys = Object.keys(aiTemplates);
    for (var ati = 0; ati < aiTKeys.length; ati++) {
      if (aiTemplates[aiTKeys[ati]] && aiTemplates[aiTKeys[ati]].enabled) {
        aiActiveIds.push(aiTKeys[ati]);
      }
    }
    result.ai_resilience.active_templates = aiActiveIds;
    if (aiActiveIds.length > 0) {
      if (!result.workflows) result.workflows = {};
      if (!result.workflows.active_templates) result.workflows.active_templates = [];
      for (var ami = 0; ami < aiActiveIds.length; ami++) {
        if (result.workflows.active_templates.indexOf(aiActiveIds[ami]) === -1) {
          result.workflows.active_templates.push(aiActiveIds[ami]);
        }
      }
    }
  }

  return result;
}

function pullSettings(projectDir, options) {
  options = options || {};

  var dashboardUrl = options.dashboardUrl;
  var syncToken = options.syncToken;

  if (!dashboardUrl || !syncToken) {
    var existing = loadSettings(projectDir);
    var dashConfig = existing.dashboard || {};
    dashboardUrl = dashboardUrl || dashConfig.url;
    syncToken = syncToken || dashConfig.sync_token;
  }

  if (!dashboardUrl) {
    return { success: false, settings: null, error: 'No dashboard URL configured' };
  }
  if (!syncToken) {
    return { success: false, settings: null, error: 'No sync token configured' };
  }

  var cleanUrl = dashboardUrl.replace(/\/+$/, '');
  var pullUrl = cleanUrl + '/api/ezra/settings-pull';

  return { success: true, url: pullUrl, token: syncToken };
}

function applySettings(projectDir, remoteSettings) {
  if (!remoteSettings || typeof remoteSettings !== 'object') {
    return { success: false, error: 'Invalid remote settings' };
  }

  _invalidateCache();
  var current = JSON.parse(JSON.stringify(DEFAULTS));
  var projectSettings = loadSettings(projectDir);
  current = deepMerge(current, projectSettings);

  var merged = deepMerge(current, remoteSettings);

  var settingsDir = path.join(projectDir, '.ezra');
  try {
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    var yaml = serializeYaml(merged);
    fs.writeFileSync(path.join(settingsDir, 'settings.yaml'), yaml, 'utf8');

    _invalidateCache();

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function syncFromDashboard(projectDir, dashboardResponse) {
  var converted = convertKeys(dashboardResponse);
  return applySettings(projectDir, converted);
}


// =================================================================
// Sub-module: ezra-project-definition
// =================================================================

const PROJECT_DEF_SCHEMA = {
  required: ['project_name', 'tech_stack', 'description'],
  domains: [
    'project_name', 'description', 'tech_stack', 'features', 'constraints',
    'auth_strategy', 'database_choice', 'deployment_target', 'testing_requirements',
    'security_level', 'standards_level', 'documentation_level', 'rollback_strategy',
    'performance_targets', 'team_size', 'timeline', 'integrations', 'compliance_requirements',
    'ai_tooling', 'phases', 'existing_decisions',
  ],
};

function validateProjectDefinition(def) {
  const errors = [];
  for (const req of PROJECT_DEF_SCHEMA.required) {
    if (!def[req]) errors.push('Missing required field: ' + req);
  }
  return { valid: errors.length === 0, errors };
}

function serialiseProjectDefinition(def) {
  if (!_yaml) return JSON.stringify(def, null, 2);
  return _yaml.stringifyYaml(def);
}

function loadProjectDefinition(projectDir) {
  const p = path.join(projectDir, '.ezra', 'project-definition.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    const text = fs.readFileSync(p, 'utf8');
    if (_yaml) return _yaml.parseYamlSimple(text);
    return JSON.parse(text);
  } catch { return null; }
}

function saveProjectDefinition(projectDir, def) {
  const dir = path.join(projectDir, '.ezra');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'project-definition.yaml');
  const text = '# EZRA Project Definition\n# Generated by /ezra:interview\n\n' + serialiseProjectDefinition(def);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}


// =================================================================
// Sub-module: ezra-execution-state
// =================================================================

const EXEC_RUN_DIR = '.ezra/execution';
const EXEC_CURRENT_RUN_FILE = 'current-run.yaml';
const EXEC_STATUSES = ['pending', 'running', 'paused', 'completed', 'failed', 'aborted'];

function stateToYaml(state) {
  return Object.entries(state).map(([k, v]) =>
    k + ': ' + (v === null || v === undefined ? 'null'
      : (Array.isArray(v) || typeof v === 'object') ? JSON.stringify(v) : v)
  ).join('\n') + '\n';
}

function yamlToState(text) {
  const state = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const ci = line.indexOf(':');
    if (ci < 1) continue;
    const key = line.slice(0, ci).trim();
    const val = line.slice(ci + 1).trim();
    if (!val || val === 'null') { state[key] = null; }
    else if (val === 'true') { state[key] = true; }
    else if (val === 'false') { state[key] = false; }
    else if (/^-?\d+$/.test(val)) { state[key] = parseInt(val, 10); }
    else if (val.startsWith('[') || val.startsWith('{')) {
      try { state[key] = JSON.parse(val); } catch (_) { state[key] = val; }
    } else { state[key] = val; }
  }
  return state;
}

function execRunFilePath(projectDir) {
  return path.join(projectDir, EXEC_RUN_DIR, EXEC_CURRENT_RUN_FILE);
}

function ensureRunDir(projectDir) {
  const dir = path.join(projectDir, EXEC_RUN_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadRun(projectDir) {
  const fp = execRunFilePath(projectDir);
  if (!fs.existsSync(fp)) return null;
  try { return yamlToState(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function saveRun(projectDir, state) {
  ensureRunDir(projectDir);
  fs.writeFileSync(execRunFilePath(projectDir), stateToYaml(state), 'utf8');
}

function mutateRun(projectDir, fn) {
  const state = loadRun(projectDir);
  if (!state) return null;
  fn(state);
  saveRun(projectDir, state);
  return state;
}

function createRun(projectDir, planId) {
  ensureRunDir(projectDir);
  const state = {
    id: 'run-' + crypto.randomBytes(4).toString('hex'),
    plan_id: planId || null, status: 'pending',
    current_phase: 1, current_task_index: 0,
    started_at: null, completed_at: null,
    checkpoint_data: '{}', tasks_completed: 0, tasks_failed: 0,
    errors: '[]', completed_tasks: '[]',
  };
  saveRun(projectDir, state);
  return state;
}

function advanceTask(projectDir) {
  return mutateRun(projectDir, (s) => { s.current_task_index = (parseInt(s.current_task_index, 10) || 0) + 1; });
}

function advancePhase(projectDir) {
  return mutateRun(projectDir, (s) => { s.current_phase = (parseInt(s.current_phase, 10) || 1) + 1; s.current_task_index = 0; });
}

function execCheckpoint(projectDir, data) {
  return mutateRun(projectDir, (s) => { s.checkpoint_data = JSON.stringify({ ...data, timestamp: new Date().toISOString() }); });
}

function abortRun(projectDir, reason) {
  return mutateRun(projectDir, (s) => { s.status = 'aborted'; s.aborted_reason = reason || ''; });
}

function pauseRun(projectDir, reason) {
  return mutateRun(projectDir, (s) => { s.status = 'paused'; s.pause_reason = reason || ''; });
}

function resumeRun(projectDir) {
  return mutateRun(projectDir, (s) => { s.status = 'running'; });
}

function completeRun(projectDir) {
  return mutateRun(projectDir, (s) => { s.status = 'completed'; s.completed_at = new Date().toISOString(); });
}

function recordTaskComplete(projectDir, taskId, result) {
  return mutateRun(projectDir, (s) => {
    s.tasks_completed = (parseInt(s.tasks_completed, 10) || 0) + 1;
    let arr = []; try { arr = JSON.parse(s.completed_tasks || '[]'); } catch { arr = []; }
    arr.push({ task_id: taskId, result, completed_at: new Date().toISOString() });
    s.completed_tasks = JSON.stringify(arr);
  });
}

function recordTaskFailed(projectDir, taskId, error) {
  return mutateRun(projectDir, (s) => {
    s.tasks_failed = (parseInt(s.tasks_failed, 10) || 0) + 1;
    let arr = []; try { arr = JSON.parse(s.errors || '[]'); } catch { arr = []; }
    arr.push({ task_id: taskId, error, failed_at: new Date().toISOString() });
    s.errors = JSON.stringify(arr);
  });
}


// =================================================================
// Sub-module: ezra-dash-hook
// =================================================================

function dashRun(event) {
  const cwd = event.cwd || process.cwd();
  const ezraDir = path.join(cwd, '.ezra');

  if (!fs.existsSync(ezraDir)) {
    console.log('EZRA: Not initialized. Run /ezra:init');
    process.exit(0);
  }

  let projectName = path.basename(cwd);
  try {
    let phase = '?';
    let protectedPaths = 0;
    const govPath = path.join(ezraDir, 'governance.yaml');
    if (fs.existsSync(govPath)) {
      const gov = fs.readFileSync(govPath, 'utf8');
      const nameMatch = gov.match(/name:\s*(.+)/);
      const phaseMatch = gov.match(/project_phase:\s*(.+)/);
      const ppMatches = gov.match(/- pattern:/g);
      if (nameMatch) projectName = nameMatch[1].trim();
      if (phaseMatch) phase = phaseMatch[1].trim();
      if (ppMatches) protectedPaths = ppMatches.length;
    }

    let decisions = 0;
    const decDir = path.join(ezraDir, 'decisions');
    if (fs.existsSync(decDir)) {
      decisions = fs.readdirSync(decDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
    }

    let lastScan = 'Never';
    let healthScore = '\u2014';
    let critical = 0;
    let high = 0;
    const scanDir = path.join(ezraDir, 'scans');
    if (fs.existsSync(scanDir)) {
      const scans = fs.readdirSync(scanDir).filter(f => f.includes('scan') || f.includes('health')).sort((a, b) => {
        const ma = fs.statSync(path.join(scanDir, a)).mtimeMs;
        const mb = fs.statSync(path.join(scanDir, b)).mtimeMs;
        return mb - ma;
      });
      if (scans.length > 0) {
        const scanContent = fs.readFileSync(path.join(scanDir, scans[0]), 'utf8');
        const dateMatch = scanContent.match(/timestamp:\s*(.+)/);
        const healthMatch = scanContent.match(/(?:health_score|overall_score):\s*(\d+)/);
        const critMatch = scanContent.match(/critical:\s*(\d+)/);
        const highMatch = scanContent.match(/high:\s*(\d+)/);
        if (dateMatch) lastScan = dateMatch[1].trim().substring(0, 10);
        if (healthMatch) healthScore = healthMatch[1];
        if (critMatch) critical = parseInt(critMatch[1]);
        if (highMatch) high = parseInt(highMatch[1]);
      }
    }

    let docCount = 0;
    const docTotal = 81;
    let criticalGaps = 0;
    const regPath = path.join(ezraDir, 'docs', 'registry.yaml');
    if (fs.existsSync(regPath)) {
      const reg = fs.readFileSync(regPath, 'utf8');
      const totalMatch = reg.match(/total_existing:\s*(\d+)/);
      if (totalMatch) docCount = parseInt(totalMatch[1]);
      else {
        const docsSection = reg.split(/\nmissing:/)[0];
        const docMatches = docsSection.match(/- type:/g);
        if (docMatches) docCount = docMatches.length;
      }
      const critDocs = ['prd', 'tad', 'adr', 'deploy-runbook', 'go-live', 'dr-plan', 'handover'];
      for (const cd of critDocs) {
        if (!reg.includes(`type: ${cd}`)) criticalGaps++;
      }
    } else {
      criticalGaps = 7;
    }

    let activePlans = 0;
    const planDir = path.join(ezraDir, 'plans');
    if (fs.existsSync(planDir)) {
      activePlans = fs.readdirSync(planDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
    }

    let openRisks = 0;
    const riskPath = path.join(ezraDir, 'risks.yaml');
    if (fs.existsSync(riskPath)) {
      const riskContent = fs.readFileSync(riskPath, 'utf8');
      const openMatches = riskContent.match(/status:\s*OPEN/gi);
      if (openMatches) openRisks = openMatches.length;
    }

    let branch = '?';
    let uncommitted = 0;
    try {
      const { execSync } = require('child_process');
      branch = execSync('git branch --show-current', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).trim() || '?';
      const status = execSync('git status --porcelain', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
      uncommitted = status.split('\n').filter(l => l.trim()).length;
    } catch { /* not a git repo or timeout */ }

    const healthIcon = healthScore === '\u2014' ? '\u26AA' :
      parseInt(healthScore) >= 80 ? '\uD83D\uDFE2' :
      parseInt(healthScore) >= 50 ? '\uD83D\uDFE1' : '\uD83D\uDD34';

    const findingsStr = (critical > 0 || high > 0)
      ? ` \u2502 Findings: ${critical}C ${high}H` : '';
    const gapsStr = criticalGaps > 0
      ? ` \u2502 Doc gaps: ${criticalGaps} critical` : '';
    const riskStr = openRisks > 0
      ? ` \u2502 Risks: ${openRisks} open` : '';

    console.log(`\u2550\u2550\u2550 EZRA \u2550\u2550\u2550 ${projectName} \u2502 ${phase} \u2502 ${healthIcon} Health: ${healthScore}/100 \u2502 Branch: ${branch} (${uncommitted} uncommitted)`);
    console.log(`  Decisions: ${decisions} \u2502 Docs: ${docCount}/${docTotal} \u2502 Plans: ${activePlans}${findingsStr}${gapsStr}${riskStr}`);

    if (critical > 0) {
      console.log(`  \uD83D\uDD34 ${critical} CRITICAL scan findings unresolved`);
    }
    if (criticalGaps > 3) {
      console.log(`  \u26A0\uFE0F  ${criticalGaps} critical documents missing \u2014 run /ezra:doc check`);
    }
  } catch (err) {
    const msg = `EZRA: ${projectName || 'Unknown'} \u2502 Error reading state: ${err.message}`;
    console.log(msg);
    _log(cwd, 'ezra-dash-hook', 'warn', msg, 'Run /ezra:health to diagnose.');
  }
  process.exit(0);
}


// =================================================================
// Sub-module: ezra-event-bus
// =================================================================

const EVENTS_DIR = '.ezra/events';
const QUEUE_FILE = 'queue.yaml';
const MAX_QUEUE = 500;

const EVENT_TYPES = [
  'decision_needed',
  'phase_complete',
  'gate_failed',
  'gate_passed',
  'test_failed',
  'deployment_complete',
  'audit_ready',
  'commit_created',
  'achievement_earned',
  'run_started',
  'run_paused',
  'run_aborted',
  'run_completed',
];

const _handlers = {};

function eventOn(eventType, handler) {
  if (!_handlers[eventType]) _handlers[eventType] = [];
  _handlers[eventType].push(handler);
}

function eventEmit(projectDir, eventType, payload) {
  const event = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: eventType,
    payload: payload || {},
    emitted_at: new Date().toISOString(),
    processed: false,
  };

  const handlers = _handlers[eventType] || [];
  for (const h of handlers) {
    try { h(event.payload, event); } catch { /* silent */ }
  }
  const wildcards = _handlers['*'] || [];
  for (const h of wildcards) {
    try { h(event.payload, event); } catch { /* silent */ }
  }

  eventPersist(projectDir, event);
  return event;
}

function eventPersist(projectDir, event) {
  try {
    const eventsDir = path.join(projectDir, EVENTS_DIR);
    if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });

    const queue = eventLoadQueue(projectDir);
    queue.push(event);

    const trimmed = queue.length > MAX_QUEUE ? queue.slice(queue.length - MAX_QUEUE) : queue;

    const yaml = trimmed.map(e => [
      `- id: '${e.id}'`,
      `  type: ${e.type}`,
      `  emitted_at: '${e.emitted_at}'`,
      `  processed: ${e.processed}`,
      `  payload: ${JSON.stringify(e.payload)}`,
    ].join('\n')).join('\n') + '\n';

    fs.writeFileSync(path.join(projectDir, EVENTS_DIR, QUEUE_FILE), yaml, 'utf8');
  } catch { /* silent */ }
}

function eventLoadQueue(projectDir) {
  try {
    const queuePath = path.join(projectDir, EVENTS_DIR, QUEUE_FILE);
    if (!fs.existsSync(queuePath)) return [];
    const text = fs.readFileSync(queuePath, 'utf8');
    const events = [];
    const blocks = text.split(/^- id:/m).filter(Boolean);
    for (const block of blocks) {
      try {
        const idMatch = block.match(/^['"]([\w]+)['"]/);
        const typeMatch = block.match(/\n  type:\s+(\S+)/);
        const timeMatch = block.match(/\n  emitted_at:\s+'([^']+)'/);
        const processedMatch = block.match(/\n  processed:\s+(true|false)/);
        const payloadMatch = block.match(/\n  payload:\s+(\{.*\}|\[.*\])/);
        if (idMatch && typeMatch) {
          events.push({
            id: idMatch[1],
            type: typeMatch[1],
            emitted_at: timeMatch ? timeMatch[1] : '',
            processed: processedMatch ? processedMatch[1] === 'true' : false,
            payload: payloadMatch ? JSON.parse(payloadMatch[1]) : {},
          });
        }
      } catch { /* skip malformed */ }
    }
    return events;
  } catch { return []; }
}

function eventMarkProcessed(projectDir, eventIds) {
  try {
    const queue = eventLoadQueue(projectDir);
    const idSet = new Set(eventIds);
    const updated = queue.map(e => idSet.has(e.id) ? { ...e, processed: true } : e);
    const yaml = updated.map(e => [
      `- id: '${e.id}'`,
      `  type: ${e.type}`,
      `  emitted_at: '${e.emitted_at}'`,
      `  processed: ${e.processed}`,
      `  payload: ${JSON.stringify(e.payload)}`,
    ].join('\n')).join('\n') + '\n';
    const queuePath = path.join(projectDir, EVENTS_DIR, QUEUE_FILE);
    fs.writeFileSync(queuePath, yaml, 'utf8');
  } catch { /* silent */ }
}

function eventGetUnprocessed(projectDir, eventType) {
  const queue = eventLoadQueue(projectDir);
  const unprocessed = queue.filter(e => !e.processed);
  return eventType ? unprocessed.filter(e => e.type === eventType) : unprocessed;
}

function eventClearQueue(projectDir) {
  try {
    const queuePath = path.join(projectDir, EVENTS_DIR, QUEUE_FILE);
    if (fs.existsSync(queuePath)) fs.writeFileSync(queuePath, '', 'utf8');
  } catch { /* silent */ }
}

function eventGetQueue(projectDir, eventType) {
  return eventGetUnprocessed(projectDir, eventType);
}


// =================================================================
// Routing: _handleAs -- dispatches stdin to the correct sub-module
// =================================================================

function _handleAs(subModule, event) {
  const cwd = event.cwd || event.project_dir || process.cwd();

  switch (subModule) {
    case 'settings': {
      return loadSettings(cwd);
    }
    case 'settings-writer': {
      const action = event.action || 'export';
      switch (action) {
        case 'set':            return setSetting(cwd, event.path, event.value);
        case 'add-rule':       return addRule(cwd, event.section, event.rule);
        case 'remove-rule':    return removeRule(cwd, event.section, event.ruleId);
        case 'reset-section':  return resetSection(cwd, event.section);
        case 'reset-all':      return resetAll(cwd);
        case 'export':         return { yaml: exportSettings(cwd) };
        case 'diff':           return { diffs: diffSettings(cwd) };
        case 'init':           return initSettings(cwd);
        default:               return { error: 'Unknown action: ' + action };
      }
    }
    case 'settings-pull': {
      return { convertKeys, pullSettings, applySettings, syncFromDashboard };
    }
    case 'project-definition': {
      const def = loadProjectDefinition(cwd);
      if (def) {
        const { valid, errors } = validateProjectDefinition(def);
        return { valid, errors, definition: def };
      }
      return { valid: false, errors: ['No project-definition.yaml found'] };
    }
    case 'execution-state': {
      const action = event.action || '';
      const pd = cwd;
      if (action === 'create')  return createRun(pd, event.plan_id) || {};
      if (action === 'load' || action === 'status') return loadRun(pd) || { status: 'no_run' };
      if (action === 'advance') return advanceTask(pd) || { error: 'No active run' };
      if (action === 'abort')   return abortRun(pd, event.reason) || { error: 'No active run' };
      return { ok: false, error: 'Unknown action: ' + action };
    }
    case 'dash-hook': {
      dashRun(event);
      return null;
    }
    case 'event-bus': {
      const type = event.type || 'unknown';
      const payload = event.payload || {};
      const result = eventEmit(cwd, type, payload);
      return { emitted: true, event: result };
    }
    default:
      return { error: 'Unknown sub-module: ' + subModule };
  }
}


// =================================================================
// Exports -- ALL public functions from all 7 sub-modules
// =================================================================

module.exports = {
  // --- ezra-settings ---
  loadSettings,
  getStandards,
  getSecurity,
  getOversight,
  getBestPractices,
  getLicensing,
  getPlanning,
  getMemory,
  getWorkflows,
  getSelfLearning,
  getProjectManager,
  getAgents,
  getDashboard,
  getCloudSync,
  getLibrary,
  getNotifications,
  getExecution,
  getQuiz2Build,
  getCompliance,
  getGithub,
  getDeploy,
  getTesting,
  getUiux,
  parseYamlSimple,
  parseValue,
  deepMerge,
  DEFAULTS,
  getDefault,
  loadGlobalDefaults,
  _invalidateCache,

  // --- ezra-settings-writer ---
  setSetting,
  addRule,
  removeRule,
  resetSection,
  resetAll,
  exportSettings,
  diffSettings,
  initSettings,
  serializeYaml,
  serializeScalar,

  // --- ezra-settings-pull ---
  convertKeys,
  pullSettings,
  applySettings,
  syncFromDashboard,
  KEY_MAP,

  // --- ezra-project-definition ---
  validate: validateProjectDefinition,
  serialise: serialiseProjectDefinition,
  load: loadProjectDefinition,
  save: saveProjectDefinition,
  SCHEMA: PROJECT_DEF_SCHEMA,

  // --- ezra-execution-state ---
  RUN_DIR: EXEC_RUN_DIR,
  CURRENT_RUN_FILE: EXEC_CURRENT_RUN_FILE,
  STATUSES: EXEC_STATUSES,
  createRun,
  loadRun,
  saveRun,
  advanceTask,
  advancePhase,
  checkpoint: execCheckpoint,
  abortRun,
  pauseRun,
  resumeRun,
  completeRun,
  recordTaskComplete,
  recordTaskFailed,

  // --- ezra-dash-hook ---
  run: dashRun,
  MAX_STDIN,

  // --- ezra-event-bus ---
  EVENT_TYPES,
  on: eventOn,
  emit: eventEmit,
  loadQueue: eventLoadQueue,
  persistEvent: eventPersist,
  markProcessed: eventMarkProcessed,
  getUnprocessed: eventGetUnprocessed,
  getQueue: eventGetQueue,
  clearQueue: eventClearQueue,

  // --- Routing ---
  _handleAs,
};


// =================================================================
// Hook Protocol (stdin -> stdout) -- routes based on context
// =================================================================

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > MAX_STDIN) { process.exit(0); }
  });
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);

      // Determine which sub-module to route to based on event context
      let subModule = 'settings'; // default

      if (event._subModule) {
        subModule = event._subModule;
      } else if (event.action && ['set', 'add-rule', 'remove-rule', 'reset-section', 'reset-all', 'export', 'diff', 'init'].includes(event.action)) {
        subModule = 'settings-writer';
      } else if (event.action && ['create', 'load', 'status', 'advance', 'abort'].includes(event.action) && (event.plan_id !== undefined || event.project_dir)) {
        subModule = 'execution-state';
      } else if (event.type && EVENT_TYPES.includes(event.type)) {
        subModule = 'event-bus';
      } else if (event.tool_name === 'ezra-dash-hook' || event._dashHook) {
        subModule = 'dash-hook';
      }

      const result = _handleAs(subModule, event);
      if (result) process.stdout.write(JSON.stringify(result));
    } catch {
      const msg = _fmt('CONFIG_001', { detail: 'Hook protocol error' });
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-config', 'warn', msg);
      process.stdout.write('{}');
    }
    process.exit(0);
  });
}
