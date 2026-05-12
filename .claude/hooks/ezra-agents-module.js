#!/usr/bin/env node
'use strict';

/**
 * hooks/ezra-agents-module.js — Consolidated Agents Module
 *
 * Merges 4 hooks into one:
 *   1. ezra-agents.js          — Multi-agent orchestration engine
 *   2. ezra-agent-dispatcher.js — Agent dispatch and routing
 *   3. ezra-mah-client.js       — MAH SDK integration client
 *   4. ezra-achievement-engine.js — Achievement/gamification engine
 *
 * Zero external dependencies.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

// ─── Hub Imports ─────────────────────────────────────────────────────────────

let _log, _fmt;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }
try { _fmt = require('./ezra-error-codes').formatError; } catch { _fmt = (c) => 'EZRA: ' + c; }

let _eventBus;
try { _eventBus = require('./ezra-event-bus'); } catch (_e) { _eventBus = null; }

// =============================================================================
// SECTION 1: MULTI-AGENT ORCHESTRATION ENGINE (from ezra-agents.js)
// =============================================================================

// --- HTTP dependency (injectable for testing) ---

let _httpsPost = null;
function getHttpsPost() {
  if (!_httpsPost) {
    _httpsPost = require(path.join(__dirname, 'ezra-http.js')).httpsPost;
  }
  return _httpsPost;
}
function setHttpsPost(fn) { _httpsPost = fn; }

// --- Supported Providers ---

const SUPPORTED_PROVIDERS = [
  { name: 'claude', type: 'llm', integration: ['api', 'mcp'] },
  { name: 'codex', type: 'llm', integration: ['api'] },
  { name: 'cursor', type: 'ide-agent', integration: ['extension'] },
  { name: 'copilot', type: 'ide-agent', integration: ['extension', 'api'] },
  { name: 'gemini', type: 'llm', integration: ['api'] },
  { name: 'grok', type: 'llm', integration: ['api'] },
  { name: 'mistral', type: 'llm', integration: ['api'] },
  { name: 'llama', type: 'llm', integration: ['local', 'api'] },
  { name: 'deepseek', type: 'llm', integration: ['api'] },
];

// --- Assignment Strategies ---

const ASSIGNMENT_STRATEGIES = ['auto', 'manual', 'round-robin', 'cost-optimised', 'quality-optimised'];

// --- Scoring Weights ---

const SCORING_WEIGHTS = {
  skill_match: 0.35,
  cost_efficiency: 0.25,
  speed: 0.15,
  quality_score: 0.15,
  availability: 0.10,
};

// --- Pricing ---

const PRICING = {
  anthropic: { input_per_mtok: 3, output_per_mtok: 15 },
  openai: { input_per_mtok: 2.5, output_per_mtok: 10 },
};

// --- Path Helpers ---

function getAgentsDir(projectDir) {
  return path.join(projectDir, '.ezra', 'agents');
}

function getRosterPath(projectDir) {
  return path.join(getAgentsDir(projectDir), 'roster.yaml');
}

function getBudgetPath(projectDir) {
  return path.join(getAgentsDir(projectDir), 'budget.yaml');
}

function getTaskLogPath(projectDir) {
  return path.join(getAgentsDir(projectDir), 'task-log.yaml');
}

function getPerformancePath(projectDir, agentName) {
  return path.join(getAgentsDir(projectDir), 'performance', agentName + '.yaml');
}

// --- Simple YAML helpers ---

function writeYaml(filePath, obj) {
  const lines = [];
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      lines.push(key + ': [' + val.join(', ') + ']');
    } else if (typeof val === 'object' && val !== null) {
      lines.push(key + ':');
      for (const [k2, v2] of Object.entries(val)) {
        lines.push('  ' + k2 + ': ' + v2);
      }
    } else {
      lines.push(key + ': ' + val);
    }
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  const result = {};
  let currentSection = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent === 0) {
      const m = line.match(/^([\w_-]+):\s*(.*)?$/);
      if (!m) continue;
      const key = m[1];
      if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
      const val = (m[2] || '').trim();
      if (val === '' || val === undefined) {
        currentSection = key;
        result[key] = {};
      } else if (val.startsWith('[') && val.endsWith(']')) {
        currentSection = null;
        const inner = val.slice(1, -1).trim();
        result[key] = inner === '' ? [] : inner.split(',').map(s => s.trim());
      } else if (val === 'true') { result[key] = true; currentSection = null; }
      else if (val === 'false') { result[key] = false; currentSection = null; }
      else if (/^-?\d+\.\d+$/.test(val)) { result[key] = parseFloat(val); currentSection = null; }
      else if (/^-?\d+$/.test(val)) { result[key] = parseInt(val, 10); currentSection = null; }
      else { result[key] = val; currentSection = null; }
    } else if (currentSection) {
      const trimmed = line.trim();
      const m = trimmed.match(/^([\w_-]+):\s*(.*)?$/);
      if (m) {
        const key = m[1];
        if (/^(__proto__|constructor|prototype)$/.test(key)) continue;
        const val = (m[2] || '').trim();
        if (typeof result[currentSection] !== 'object') result[currentSection] = {};
        if (val === 'true') result[currentSection][key] = true;
        else if (val === 'false') result[currentSection][key] = false;
        else if (/^-?\d+\.\d+$/.test(val)) result[currentSection][key] = parseFloat(val);
        else if (/^-?\d+$/.test(val)) result[currentSection][key] = parseInt(val, 10);
        else result[currentSection][key] = val;
      }
    }
  }
  return result;
}

// --- Resolve API Key ---

function resolveApiKey(providerType, projectDir) {
  try {
    const settings = require(path.join(__dirname, 'ezra-settings.js'));
    const agentsCfg = settings.loadSettings(projectDir).agents || {};
    const key = agentsCfg[providerType + '_api_key'];
    if (key && key !== 'null' && key !== 'mock') {
      return key;
    }
  } catch {
    const msg = _fmt('AGENTS_002', {});
    process.stderr.write(msg + "\n");
    _log(projectDir || process.cwd(), 'ezra-agents', 'info', msg);
  }
  if (providerType === 'anthropic') return process.env.ANTHROPIC_API_KEY || null;
  if (providerType === 'openai') return process.env.OPENAI_API_KEY || null;
  return null;
}

function resolveModel(providerType, projectDir) {
  try {
    const settings = require(path.join(__dirname, 'ezra-settings.js'));
    const agentsCfg = settings.loadSettings(projectDir).agents || {};
    const model = agentsCfg[providerType + '_model'];
    if (model) return model;
  } catch {
    const msg = _fmt('AGENTS_002', {});
    process.stderr.write(msg + "\n");
    _log(projectDir || process.cwd(), 'ezra-agents', 'info', msg);
  }
  if (providerType === 'anthropic') return 'claude-sonnet-4-20250514';
  if (providerType === 'openai') return 'gpt-4o';
  return 'unknown';
}

// --- Cost Calculation ---

function calcCost(providerType, tokensIn, tokensOut) {
  const pricing = PRICING[providerType];
  if (!pricing) return 0;
  const inputCost = (tokensIn / 1000000) * pricing.input_per_mtok;
  const outputCost = (tokensOut / 1000000) * pricing.output_per_mtok;
  return Math.round((inputCost + outputCost) * 1000000) / 1000000;
}

// --- Provider Factory ---

function createMockProvider(config) {
  const name = config.name || 'mock';
  const type = config.type || 'llm';
  const model = config.model || name;
  let busy = false;

  return {
    name,
    type,
    model,
    provider: 'mock',
    execute: async (task) => {
      busy = true;
      const tokens_in = 200 + Math.floor(Math.random() * 300);
      const tokens_out = 300 + Math.floor(Math.random() * 700);
      const cost = tokens_in * 0.000003 + tokens_out * 0.000015;
      await new Promise(r => setTimeout(r, 10));
      busy = false;
      return {
        success: true,
        output: 'Mock response for: ' + (task.prompt || task.description || task),
        tokens_in,
        tokens_out,
        tokens: tokens_in + tokens_out,
        cost_usd: Math.round(cost * 1000000) / 1000000,
        cost: Math.round(cost * 10000) / 10000,
        duration_ms: 100 + Math.floor(Math.random() * 200),
        duration: 100 + Math.floor(Math.random() * 200),
      };
    },
    status: () => busy ? 'busy' : 'ready',
  };
}

function createAnthropicProvider(config) {
  const name = 'claude';
  const type = 'llm';
  const providerType = 'anthropic';
  const projectDir = config.projectDir || process.cwd();
  const model = config.model || resolveModel(providerType, projectDir);
  let busy = false;

  return {
    name,
    type,
    model,
    provider: providerType,
    execute: async (task) => {
      const apiKey = resolveApiKey(providerType, projectDir);
      if (!apiKey || apiKey === 'mock') {
        return createMockProvider({ name, type, model }).execute(task);
      }

      busy = true;
      const start = Date.now();
      try {
        const prompt = task.prompt || task.description || String(task);
        const body = {
          model: model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        };
        const headers = {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        };
        const httpPost = getHttpsPost();
        const res = await httpPost('https://api.anthropic.com/v1/messages', body, headers);
        const duration_ms = Date.now() - start;

        if (res.statusCode !== 200) {
          busy = false;
          return { success: false, output: '', error: 'API error: ' + res.statusCode, duration_ms };
        }

        const resBody = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        let output = (resBody.content && resBody.content[0] && resBody.content[0].text) || '';
        if (output.length > 102400) output = output.slice(0, 102400) + '\n[EZRA: output truncated at 100KB]';
        const usage = resBody.usage || {};
        const tokens_in = usage.input_tokens || 0;
        const tokens_out = usage.output_tokens || 0;
        const cost_usd = calcCost(providerType, tokens_in, tokens_out);

        busy = false;
        return { success: true, output, tokens_in, tokens_out, cost_usd, duration_ms };
      } catch (err) {
        busy = false;
        const safeMsg = apiKey ? err.message.split(apiKey).join('[REDACTED]') : err.message;
        return { success: false, output: '', error: safeMsg, duration_ms: Date.now() - start };
      }
    },
    status: () => busy ? 'busy' : 'ready',
  };
}

function createOpenAIProvider(config) {
  const name = 'gpt';
  const type = 'llm';
  const providerType = 'openai';
  const projectDir = config.projectDir || process.cwd();
  const model = config.model || resolveModel(providerType, projectDir);
  let busy = false;

  return {
    name,
    type,
    model,
    provider: providerType,
    execute: async (task) => {
      const apiKey = resolveApiKey(providerType, projectDir);
      if (!apiKey || apiKey === 'mock') {
        return createMockProvider({ name, type, model }).execute(task);
      }

      busy = true;
      const start = Date.now();
      try {
        const prompt = task.prompt || task.description || String(task);
        const body = {
          model: model,
          messages: [{ role: 'user', content: prompt }],
        };
        const headers = {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        };
        const httpPost = getHttpsPost();
        const res = await httpPost('https://api.openai.com/v1/chat/completions', body, headers);
        const duration_ms = Date.now() - start;

        if (res.statusCode !== 200) {
          busy = false;
          return { success: false, output: '', error: 'API error: ' + res.statusCode, duration_ms };
        }

        const resBody = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        let output = (resBody.choices && resBody.choices[0] && resBody.choices[0].message && resBody.choices[0].message.content) || '';
        if (output.length > 102400) output = output.slice(0, 102400) + '\n[EZRA: output truncated at 100KB]';
        const usage = resBody.usage || {};
        const tokens_in = usage.prompt_tokens || 0;
        const tokens_out = usage.completion_tokens || 0;
        const cost_usd = calcCost(providerType, tokens_in, tokens_out);

        busy = false;
        return { success: true, output, tokens_in, tokens_out, cost_usd, duration_ms };
      } catch (err) {
        busy = false;
        const safeMsg = apiKey ? err.message.split(apiKey).join('[REDACTED]') : err.message;
        return { success: false, output: '', error: safeMsg, duration_ms: Date.now() - start };
      }
    },
    status: () => busy ? 'busy' : 'ready',
  };
}

// --- Stub Providers ---

const STUB_PROVIDERS = ['ollama', 'cursor', 'windsurf', 'copilot', 'codestral', 'deepseekcoder', 'qoder'];

function createStubProvider(config) {
  const name = config.name || config.type || 'stub';
  return {
    name,
    type: config.type || 'llm',
    model: config.model || name,
    provider: name,
    execute: async () => {
      return { success: false, reason: 'provider_not_implemented', provider: name };
    },
    status: () => 'ready',
  };
}

// --- Unified Provider Factory ---

function createProvider(config) {
  const providerType = config.type || config.name || 'mock';

  if (providerType === 'anthropic') return createAnthropicProvider(config);
  if (providerType === 'openai') return createOpenAIProvider(config);
  if (STUB_PROVIDERS.includes(providerType)) return createStubProvider(config);

  // Default: mock provider (backwards-compatible)
  return createMockProvider(config);
}

// --- Execute With Fallback ---

async function executeWithFallback(projectDir, task, primaryType, fallbackType) {
  const config = loadAgentConfig(projectDir);
  primaryType = primaryType || config.default_provider || 'anthropic';
  fallbackType = fallbackType || config.fallback_provider || (primaryType === 'anthropic' ? 'openai' : 'anthropic');

  // Budget check
  const budget = checkBudget(projectDir);
  if (budget.overspend) {
    return { success: false, reason: 'budget_exceeded', budget };
  }

  // Try primary
  const primary = createProvider({ type: primaryType, projectDir });
  const result = await primary.execute(task);
  if (result.success) {
    return { ...result, provider_used: primaryType };
  }

  // Try fallback (max 1 attempt)
  const fallback = createProvider({ type: fallbackType, projectDir });
  const fallbackResult = await fallback.execute(task);
  return { ...fallbackResult, provider_used: fallbackType, fallback: true };
}

// --- Load Agent Config ---

function loadAgentConfig(projectDir) {
  try {
    const settings = require(path.join(__dirname, 'ezra-settings.js'));
    return settings.loadSettings(projectDir).agents || {};
  } catch {
    const msg = _fmt('AGENTS_002', {});
    _log(projectDir || process.cwd(), 'ezra-agents', 'info', msg);
    return {};
  }
}

// --- Roster Management ---

function getAgentRoster(projectDir) {
  const rosterPath = getRosterPath(projectDir);
  if (!fs.existsSync(rosterPath)) {
    _log('agents', 'warn', 'Agent roster not found: ' + rosterPath);
    return [];
  }
  const data = readYaml(rosterPath);
  const agents = [];
  for (const [key, val] of Object.entries(data)) {
    if (typeof val === 'object' && val !== null) {
      agents.push({ name: key, ...val });
    }
  }
  return agents;
}

// --- Task Assignment ---

function assignTask(projectDir, task, strategy) {
  strategy = strategy || 'auto';
  const roster = getAgentRoster(projectDir);
  if (roster.length === 0) {
    return { agent: SUPPORTED_PROVIDERS[0].name, strategy, reason: 'no_roster_fallback_to_default' };
  }

  if (strategy === 'manual') {
    return { agent: roster[0].name, strategy: 'manual', reason: 'manual_selection' };
  }

  if (strategy === 'round-robin') {
    const log = readYaml(getTaskLogPath(projectDir));
    const lastIdx = log.last_index || 0;
    const nextIdx = (lastIdx + 1) % roster.length;
    return { agent: roster[nextIdx].name, strategy: 'round-robin', reason: 'round_robin_index_' + nextIdx };
  }

  // Auto / cost-optimised / quality-optimised: use weighted scoring
  const taskType = (task && task.type) || 'general';
  const scores = [];

  for (const agent of roster) {
    const perf = getAgentPerformance(projectDir, agent.name);
    const skillMatch = perf.success_rate || 0.5;
    const costEff = perf.avg_cost ? (1 / (perf.avg_cost + 0.001)) : 0.5;
    const speed = perf.avg_duration ? (1 / (perf.avg_duration + 1)) : 0.5;
    const quality = perf.acceptance_rate || 0.5;
    const avail = agent.status === 'offline' ? 0 : 1;

    let weights = { ...SCORING_WEIGHTS };
    if (strategy === 'cost-optimised') {
      weights = { skill_match: 0.2, cost_efficiency: 0.45, speed: 0.15, quality_score: 0.1, availability: 0.1 };
    } else if (strategy === 'quality-optimised') {
      weights = { skill_match: 0.25, cost_efficiency: 0.1, speed: 0.1, quality_score: 0.45, availability: 0.1 };
    }

    const score = (skillMatch * weights.skill_match) +
      (Math.min(costEff, 1) * weights.cost_efficiency) +
      (Math.min(speed, 1) * weights.speed) +
      (quality * weights.quality_score) +
      (avail * weights.availability);

    scores.push({ agent: agent.name, score: Math.round(score * 1000) / 1000 });
  }

  scores.sort((a, b) => b.score - a.score);
  return { agent: scores[0].agent, strategy, scores, reason: 'weighted_scoring' };
}

// --- Performance Tracking ---

function recordTaskResult(projectDir, agentName, task, result) {
  const perfDir = path.join(getAgentsDir(projectDir), 'performance');
  if (!fs.existsSync(perfDir)) fs.mkdirSync(perfDir, { recursive: true });

  const perfPath = getPerformancePath(projectDir, agentName);
  const perf = fs.existsSync(perfPath) ? readYaml(perfPath) : {};

  const tasks_completed = (perf.tasks_completed || 0) + 1;
  const total_cost = (perf.total_cost || 0) + (result.cost || result.cost_usd || 0);
  const total_duration = (perf.total_duration || 0) + (result.duration || result.duration_ms || 0);
  const successes = (perf.successes || 0) + (result.success !== false ? 1 : 0);

  const updated = {
    agent: agentName,
    tasks_completed,
    successes,
    total_cost: Math.round(total_cost * 10000) / 10000,
    total_duration,
    avg_cost: Math.round((total_cost / tasks_completed) * 10000) / 10000,
    avg_duration: Math.round(total_duration / tasks_completed),
    success_rate: Math.round((successes / tasks_completed) * 100) / 100,
    acceptance_rate: Math.round((successes / tasks_completed) * 100) / 100,
    last_task: new Date().toISOString().slice(0, 19),
  };

  writeYaml(perfPath, updated);

  // Also log to task-log
  const logPath = getTaskLogPath(projectDir);
  const log = fs.existsSync(logPath) ? readYaml(logPath) : {};
  log.total_tasks = (log.total_tasks || 0) + 1;
  log.last_agent = agentName;
  log.last_task_time = updated.last_task;
  writeYaml(logPath, log);

  return updated;
}

function getAgentPerformance(projectDir, agentName) {
  const perfPath = getPerformancePath(projectDir, agentName);
  if (!fs.existsSync(perfPath)) {
    return { agent: agentName, tasks_completed: 0, successes: 0, total_cost: 0, avg_cost: 0, avg_duration: 0, success_rate: 0.5, acceptance_rate: 0.5 };
  }
  return readYaml(perfPath);
}

function getAgentLeaderboard(projectDir) {
  const perfDir = path.join(getAgentsDir(projectDir), 'performance');
  if (!fs.existsSync(perfDir)) return [];
  const files = fs.readdirSync(perfDir).filter(f => f.endsWith('.yaml'));
  const agents = files.map(f => {
    const data = readYaml(path.join(perfDir, f));
    const qualityAdjustedCost = data.avg_cost && data.success_rate
      ? Math.round((data.avg_cost / Math.max(data.success_rate, 0.01)) * 10000) / 10000
      : 999;
    return { ...data, quality_adjusted_cost: qualityAdjustedCost };
  });
  agents.sort((a, b) => a.quality_adjusted_cost - b.quality_adjusted_cost);
  return agents;
}

// --- Budget ---

function checkBudget(projectDir) {
  const budgetPath = getBudgetPath(projectDir);
  const config = loadAgentConfig(projectDir);
  const dailyCeiling = config.daily_budget_usd || config.budget_ceiling_daily || 10;
  const monthlyCeiling = config.monthly_budget_usd || config.budget_ceiling_monthly || 200;
  const currency = config.budget_ceiling_currency || 'USD';

  const budget = fs.existsSync(budgetPath) ? readYaml(budgetPath) : { daily_spend: 0, monthly_spend: 0 };

  return {
    daily_spend: budget.daily_spend || 0,
    monthly_spend: budget.monthly_spend || 0,
    daily_ceiling: dailyCeiling,
    monthly_ceiling: monthlyCeiling,
    currency: currency,
    daily_remaining: dailyCeiling - (budget.daily_spend || 0),
    monthly_remaining: monthlyCeiling - (budget.monthly_spend || 0),
    overspend: (budget.daily_spend || 0) > dailyCeiling || (budget.monthly_spend || 0) > monthlyCeiling,
  };
}

// =============================================================================
// SECTION 2: AGENT DISPATCH AND ROUTING (from ezra-agent-dispatcher.js)
// =============================================================================

const SPECIALIST_ROLES = [
  'security-specialist',
  'architecture-reviewer',
  'test-engineer',
  'devops-engineer',
  'documentation-writer',
];

const DIRECT_ROLES = ['code-agent'];

/**
 * Returns 'specialist' if agentRole is in SPECIALIST_ROLES, else 'direct'.
 */
function getDispatchStrategy(agentRole) {
  return SPECIALIST_ROLES.includes(agentRole) ? 'specialist' : 'direct';
}

/**
 * Builds a formatted task prompt string from a task object.
 */
function buildTaskPrompt(task) {
  const title = task.title || '(untitled)';
  const description = task.description || '';
  const criteria = task.acceptance_criteria || '';
  const files = Array.isArray(task.file_targets)
    ? task.file_targets.join(', ')
    : (task.file_targets || 'none');

  return (
    'Task: ' + title +
    '\n\nDescription: ' + description +
    '\n\nAcceptance Criteria: ' + criteria +
    '\n\nFile targets: ' + files
  );
}

/**
 * Dispatches a task using the appropriate strategy.
 * - 'direct': returns prompt and task_id immediately (no network call).
 * - 'specialist': delegates to routeTask().
 */
async function dispatchTask(projectDir, task) {
  const strategy = getDispatchStrategy(task.agent_role || '');

  if (strategy === 'direct') {
    return {
      dispatched: true,
      strategy: 'direct',
      prompt: buildTaskPrompt(task),
      task_id: task.id || task.task_id,
    };
  }

  // specialist — route via MAH client (now local)
  try {
    const result = await routeTask(projectDir, task);
    return {
      dispatched: result.routed === true,
      strategy: 'specialist',
      task_id: task.id || task.task_id,
      result: result.result,
      error: result.error,
    };
  } catch (e) {
    return {
      dispatched: false,
      strategy: 'specialist',
      task_id: task.id || task.task_id,
      error: e.message,
    };
  }
}

/**
 * Validates a task dispatch result.
 * Returns { valid: bool, issues: string[] }.
 */
function validateTaskResult(task, result) {
  const issues = [];
  if (!result) {
    issues.push('Result is null or undefined');
  } else {
    if (result.dispatched !== true) {
      issues.push('result.dispatched is not true' + (result.error ? ': ' + result.error : ''));
    }
  }
  return { valid: issues.length === 0, issues };
}

// =============================================================================
// SECTION 3: MAH SDK INTEGRATION CLIENT (from ezra-mah-client.js)
// =============================================================================

const MAH_ENDPOINT_DEFAULT = 'http://localhost:3001';

/**
 * Reads .ezra/settings.yaml and returns the value at mah.endpoint,
 * or MAH_ENDPOINT_DEFAULT if not found.
 */
function getMahEndpoint(projectDir) {
  try {
    const settingsPath = path.join(projectDir, '.ezra', 'settings.yaml');
    if (!fs.existsSync(settingsPath)) return MAH_ENDPOINT_DEFAULT;
    const text = fs.readFileSync(settingsPath, 'utf8');
    let inMah = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (/^mah\s*:/.test(line)) { inMah = true; continue; }
      if (inMah && /^\S/.test(line) && !/^mah\s*:/.test(line)) { inMah = false; }
      if (inMah && /^\s+endpoint\s*:\s*(.+)/.test(line)) {
        const val = line.replace(/^\s+endpoint\s*:\s*/, '').trim();
        return val.replace(/^['"]|['"]$/g, '') || MAH_ENDPOINT_DEFAULT;
      }
    }
  } catch (_) { /* fall through */ }
  return MAH_ENDPOINT_DEFAULT;
}

/**
 * Low-level JSON POST using built-in http/https.
 * Falls back gracefully on network errors.
 */
function postJson(endpoint, urlPath, body) {
  return new Promise((resolve) => {
    let ezraHttp;
    try { ezraHttp = require('./ezra-http'); } catch (_) { ezraHttp = null; }

    if (ezraHttp && typeof ezraHttp.request === 'function') {
      ezraHttp.request(endpoint + urlPath, { method: 'POST', body: JSON.stringify(body) })
        .then(resolve)
        .catch((e) => resolve({ ok: false, error: e.message }));
      return;
    }

    // Built-in fallback
    const parsed = (() => { try { return new URL(endpoint + urlPath); } catch (_) { return null; } })();
    if (!parsed) { resolve({ ok: false, error: 'Invalid URL: ' + endpoint + urlPath }); return; }

    const transport = parsed.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ ok: true, status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ ok: true, status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'Request timeout' }); });
    req.write(payload);
    req.end();
  });
}

async function routeTask(projectDir, task) {
  const endpoint = getMahEndpoint(projectDir);
  const payload = {
    task_id: task.task_id || task.id,
    title: task.title,
    agent_role: task.agent_role,
    description: task.description,
    acceptance_criteria: task.acceptance_criteria,
  };
  try {
    const res = await postJson(endpoint, '/tasks', payload);
    if (!res.ok) return { routed: false, error: res.error || 'HTTP ' + res.status };
    return { routed: true, result: res.body };
  } catch (e) {
    return { routed: false, error: e.message };
  }
}

async function routeSecurityAudit(projectDir, context) {
  const endpoint = getMahEndpoint(projectDir);
  try {
    const res = await postJson(endpoint, '/audit/security', context);
    if (!res.ok) return { routed: false, error: res.error || 'HTTP ' + res.status };
    return { routed: true, result: res.body };
  } catch (e) {
    return { routed: false, error: e.message };
  }
}

async function routeArchitectureReview(projectDir, context) {
  const endpoint = getMahEndpoint(projectDir);
  try {
    const res = await postJson(endpoint, '/audit/architecture', context);
    if (!res.ok) return { routed: false, error: res.error || 'HTTP ' + res.status };
    return { routed: true, result: res.body };
  } catch (e) {
    return { routed: false, error: e.message };
  }
}

async function routeDocumentParse(projectDir, filePath, mimeType) {
  const endpoint = getMahEndpoint(projectDir);
  try {
    const res = await postJson(endpoint, '/documents/parse', { file_path: filePath, mime_type: mimeType });
    if (!res.ok) return { routed: false, error: res.error || 'HTTP ' + res.status };
    return { routed: true, result: res.body };
  } catch (e) {
    return { routed: false, error: e.message };
  }
}

// =============================================================================
// SECTION 4: ACHIEVEMENT / GAMIFICATION ENGINE (from ezra-achievement-engine.js)
// =============================================================================

const BUILT_IN_ACHIEVEMENTS = [
  {
    id: 'first_decision',
    name: 'First Decision',
    description: 'Record your first architectural decision',
    icon: '\u{1F3DB}\uFE0F',
    points: 10,
    rules: [{ type: 'count', metric: 'decisions', operator: '>=', value: 1 }],
  },
  {
    id: 'governance_foundation',
    name: 'Governance Foundation',
    description: 'Record 5 architectural decisions',
    icon: '\u{1F4DC}',
    points: 25,
    rules: [{ type: 'count', metric: 'decisions', operator: '>=', value: 5 }],
  },
  {
    id: 'first_scan',
    name: 'First Scan',
    description: 'Run your first codebase scan',
    icon: '\u{1F50D}',
    points: 10,
    rules: [{ type: 'count', metric: 'scans', operator: '>=', value: 1 }],
  },
  {
    id: 'health_a',
    name: 'Grade A Health',
    description: 'Achieve a health score of 90 or above',
    icon: '\u{1F3C6}',
    points: 50,
    rules: [{ type: 'score', metric: 'health_score', operator: '>=', value: 90 }],
  },
  {
    id: 'health_b',
    name: 'Grade B Health',
    description: 'Achieve a health score of 75 or above',
    icon: '\u2B50',
    points: 25,
    rules: [{ type: 'score', metric: 'health_score', operator: '>=', value: 75 }],
  },
  {
    id: 'phase_complete',
    name: 'Phase Complete',
    description: 'Complete your first execution phase',
    icon: '\u{1F3AF}',
    points: 30,
    rules: [{ type: 'count', metric: 'phases_completed', operator: '>=', value: 1 }],
  },
  {
    id: 'gate_champion',
    name: 'Gate Champion',
    description: 'Pass 5 phase gates',
    icon: '\u{1F6E1}\uFE0F',
    points: 40,
    rules: [{ type: 'count', metric: 'gates_passed', operator: '>=', value: 5 }],
  },
  {
    id: 'commit_streak',
    name: 'Commit Streak',
    description: 'Create 10 commits',
    icon: '\u{1F4BE}',
    points: 20,
    rules: [{ type: 'count', metric: 'commits', operator: '>=', value: 10 }],
  },
  {
    id: 'docs_complete',
    name: 'Documentation Complete',
    description: 'Have at least 10 SDLC documents created',
    icon: '\u{1F4DA}',
    points: 35,
    rules: [{ type: 'count', metric: 'documents', operator: '>=', value: 10 }],
  },
  {
    id: 'security_clean',
    name: 'Security Clean',
    description: 'Achieve a security gate score of 90+',
    icon: '\u{1F512}',
    points: 45,
    rules: [{ type: 'score', metric: 'security_score', operator: '>=', value: 90 }],
  },
  {
    id: 'zero_drift',
    name: 'Zero Drift',
    description: 'Sync all documents \u2014 no stale docs',
    icon: '\u2728',
    points: 30,
    rules: [{ type: 'count', metric: 'stale_docs', operator: '===', value: 0 }],
  },
  {
    id: 'library_builder',
    name: 'Library Builder',
    description: 'Add 20 entries to the best practice library',
    icon: '\u{1F3D7}\uFE0F',
    points: 25,
    rules: [{ type: 'count', metric: 'library_entries', operator: '>=', value: 20 }],
  },
];

// --- Achievement state paths ---

function achievementsDir(projectDir) {
  return path.join(projectDir, '.ezra', 'achievements');
}

function earnedPath(projectDir) {
  return path.join(achievementsDir(projectDir), 'earned.json');
}

// --- Achievement load / save ---

function loadEarned(projectDir) {
  const p = earnedPath(projectDir);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return []; }
}

function saveEarned(projectDir, earned) {
  const dir = achievementsDir(projectDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(earnedPath(projectDir), JSON.stringify(earned, null, 2), 'utf8');
}

// --- Rule evaluation ---

function evalRule(rule, metrics) {
  const val = metrics[rule.metric];
  if (val === undefined || val === null) return false;
  const n = Number(val);
  const t = Number(rule.value);
  switch (rule.operator) {
    case '>=': return n >= t;
    case '>':  return n > t;
    case '<=': return n <= t;
    case '<':  return n < t;
    case '===': return n === t;
    case '==':  return n == rule.value; // eslint-disable-line eqeqeq
    default:    return false;
  }
}

function checkAchievement(achievement, metrics) {
  return achievement.rules.every(r => evalRule(r, metrics));
}

// --- Collect metrics from .ezra/ state ---

function collectMetrics(projectDir) {
  const metrics = {
    decisions: 0, scans: 0, health_score: 0, phases_completed: 0,
    gates_passed: 0, commits: 0, documents: 0, security_score: 0,
    stale_docs: 0, library_entries: 0,
  };

  try {
    const decisionsDir = path.join(projectDir, '.ezra', 'decisions');
    if (fs.existsSync(decisionsDir)) {
      metrics.decisions = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml')).length;
    }
  } catch (_e) { /* ignore */ }

  try {
    const scansDir = path.join(projectDir, '.ezra', 'scans');
    if (fs.existsSync(scansDir)) {
      metrics.scans = fs.readdirSync(scansDir).filter(f => f.endsWith('.yaml')).length;
    }
  } catch (_e) { /* ignore */ }

  try {
    const versionPath = path.join(projectDir, '.ezra', 'versions', 'current.yaml');
    if (fs.existsSync(versionPath)) {
      const content = fs.readFileSync(versionPath, 'utf8');
      const scoreMatch = content.match(/health_score:\s*(\d+)/);
      if (scoreMatch) metrics.health_score = parseInt(scoreMatch[1], 10);
    }
  } catch (_e) { /* ignore */ }

  try {
    const gatesDir = path.join(projectDir, '.ezra', 'gates');
    if (fs.existsSync(gatesDir)) {
      const gateFiles = fs.readdirSync(gatesDir).filter(f => f.endsWith('.yaml'));
      let passed = 0;
      for (const f of gateFiles) {
        const content = fs.readFileSync(path.join(gatesDir, f), 'utf8');
        if (content.includes('passed: true')) passed++;
      }
      metrics.gates_passed = passed;
    }
  } catch (_e) { /* ignore */ }

  return metrics;
}

// --- Achievement evaluate ---

function evaluate(projectDir, metricsOverride) {
  const metrics = metricsOverride || collectMetrics(projectDir);
  const earned = loadEarned(projectDir);
  const earnedIds = new Set(earned.map(e => e.id));
  const newlyEarned = [];

  for (const achievement of BUILT_IN_ACHIEVEMENTS) {
    if (earnedIds.has(achievement.id)) continue;
    if (checkAchievement(achievement, metrics)) {
      const record = { id: achievement.id, earned_at: new Date().toISOString() };
      earned.push(record);
      newlyEarned.push({ ...achievement, earned_at: record.earned_at });
      earnedIds.add(achievement.id);

      // Emit event
      if (_eventBus) {
        try {
          _eventBus.emit(projectDir, 'achievement_earned', {
            achievement_id: achievement.id,
            name: achievement.name,
            points: achievement.points,
          });
        } catch (_e) { /* ignore */ }
      }
    }
  }

  if (newlyEarned.length > 0) {
    saveEarned(projectDir, earned);
  }

  return {
    newly_earned: newlyEarned,
    total_earned: earned.length,
    total_points: earned.reduce((sum, e) => {
      const def = BUILT_IN_ACHIEVEMENTS.find(a => a.id === e.id);
      return sum + (def ? def.points : 0);
    }, 0),
    metrics,
  };
}

function listAchievements(projectDir) {
  const earned = loadEarned(projectDir);
  const earnedMap = new Map(earned.map(e => [e.id, e]));
  return BUILT_IN_ACHIEVEMENTS.map(a => ({
    ...a,
    earned: earnedMap.has(a.id),
    earned_at: earnedMap.get(a.id)?.earned_at ?? null,
  }));
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // --- Section 1: Multi-Agent Orchestration ---
  SUPPORTED_PROVIDERS,
  ASSIGNMENT_STRATEGIES,
  SCORING_WEIGHTS,
  PRICING,
  STUB_PROVIDERS,
  createProvider,
  createAnthropicProvider,
  createOpenAIProvider,
  createStubProvider,
  createMockProvider,
  executeWithFallback,
  resolveApiKey,
  resolveModel,
  calcCost,
  setHttpsPost,
  loadAgentConfig,
  getAgentRoster,
  assignTask,
  recordTaskResult,
  getAgentPerformance,
  getAgentLeaderboard,
  checkBudget,
  writeYaml,
  readYaml,

  // --- Section 2: Agent Dispatch ---
  SPECIALIST_ROLES,
  DIRECT_ROLES,
  getDispatchStrategy,
  buildTaskPrompt,
  dispatchTask,
  validateTaskResult,

  // --- Section 3: MAH Client ---
  MAH_ENDPOINT_DEFAULT,
  getMahEndpoint,
  routeTask,
  routeSecurityAudit,
  routeArchitectureReview,
  routeDocumentParse,

  // --- Section 4: Achievement Engine ---
  BUILT_IN_ACHIEVEMENTS,
  evaluate,
  listAchievements,
  collectMetrics,
  checkAchievement,
  loadEarned,
  saveEarned,
};

// =============================================================================
// HOOK PROTOCOL (stdin handler)
// =============================================================================

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > MAX_STDIN) { process.exit(0); }
  });
  process.stdin.on('end', async () => {
    try {
      const event = JSON.parse(input);
      const cwd = event.cwd || event.project_dir || process.cwd();
      const action = event.action || 'roster';

      // --- Section 1 actions (agents) ---
      if (action === 'roster') {
        process.stdout.write(JSON.stringify(getAgentRoster(cwd)));
      } else if (action === 'assign') {
        process.stdout.write(JSON.stringify(assignTask(cwd, event.task, event.strategy)));
      } else if (action === 'performance') {
        process.stdout.write(JSON.stringify(getAgentPerformance(cwd, event.agent)));
      } else if (action === 'leaderboard') {
        process.stdout.write(JSON.stringify(getAgentLeaderboard(cwd)));
      } else if (action === 'budget') {
        process.stdout.write(JSON.stringify(checkBudget(cwd)));

      // --- Section 2 actions (dispatcher) ---
      } else if (action === 'dispatch') {
        const out = await dispatchTask(cwd, event.task || {});
        process.stdout.write(JSON.stringify(out) + '\n');
      } else if (action === 'validate') {
        const out = validateTaskResult(event.task || {}, event.result || null);
        process.stdout.write(JSON.stringify(out) + '\n');

      // --- Section 3 actions (MAH client) ---
      } else if (action === 'route_task') {
        const out = await routeTask(cwd, event.task || {});
        process.stdout.write(JSON.stringify(out) + '\n');
      } else if (action === 'security_audit') {
        const out = await routeSecurityAudit(cwd, event.context || {});
        process.stdout.write(JSON.stringify(out) + '\n');
      } else if (action === 'architecture_review') {
        const out = await routeArchitectureReview(cwd, event.context || {});
        process.stdout.write(JSON.stringify(out) + '\n');

      // --- Section 4 actions (achievements) ---
      } else if (action === 'list') {
        process.stdout.write(JSON.stringify({ achievements: listAchievements(cwd) }) + '\n');
      } else if (action === 'evaluate') {
        process.stdout.write(JSON.stringify(evaluate(cwd, event.metrics || null)) + '\n');

      } else {
        process.stdout.write('{}');
      }
    } catch (hookErr) {
      const msg = 'EZRA [AGENTS-MODULE]: Hook error \u2014 ' + (hookErr && hookErr.message ? hookErr.message : 'unknown');
      process.stderr.write(msg + "\n");
      _log(process.cwd(), 'ezra-agents-module', 'error', msg);
      process.stdout.write('{}');
    }
    process.exit(0);
  });
}
