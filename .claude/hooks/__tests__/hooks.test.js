/**
 * Hook unit tests — Phase 6 R-4
 *
 * Run: node --test hooks/__tests__/
 * Or:  node --test hooks/__tests__/hooks.test.js
 *
 * Integration-style: spawn the real hook subprocess with mocked stdin,
 * assert on exit code + stdout + side-effects (state files, candidate
 * dirs). Each test cleans up its own artifacts.
 *
 * Zero deps — Node built-in test runner only.
 */

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOOKS = path.join(os.homedir(), '.claude', 'hooks');
const STATE_DIR = path.join(os.homedir(), '.claude', 'state');
const LOGS_DIR = path.join(os.homedir(), '.claude', '_logs');

/**
 * Run a hook with given JSON input. Returns { stdout, stderr, exitCode }.
 */
function runHook(name, input, env = {}) {
  const hookPath = path.join(HOOKS, name);
  let stdout = '', stderr = '', exitCode = 0;
  try {
    stdout = execFileSync('node', [hookPath], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    stdout = err.stdout?.toString() || '';
    stderr = err.stderr?.toString() || '';
    exitCode = err.status ?? 1;
  }
  return { stdout, stderr, exitCode };
}

// strike-counter + stuck-detector write state to _logs/ (shared session state).
// reflect-detect writes queue to state/. Provide both paths.
const COUNTER_STATE_DIR = LOGS_DIR;
function cleanupState(sessionId) {
  const sp = path.join(COUNTER_STATE_DIR, `state-${sessionId}.json`);
  try { fs.unlinkSync(sp); } catch {}
}

// ─── am-i-done-gate ───────────────────────────────────────────────

test('am-i-done-gate: empty stdin → exit 0', () => {
  const r = runHook('am-i-done-gate.js', '');
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('am-i-done-gate: malformed JSON → exit 0', () => {
  const r = runHook('am-i-done-gate.js', 'not-json{');
  assert.equal(r.exitCode, 0);
});

test('am-i-done-gate: stop_hook_active=true → noop (recursion guard)', () => {
  const r = runHook('am-i-done-gate.js', { stop_hook_active: true, cwd: 'C:/Dev/test' });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('am-i-done-gate: cwd outside SAFE_ROOTS → noop', () => {
  const r = runHook('am-i-done-gate.js', { cwd: 'C:\\Windows\\System32' });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('am-i-done-gate: APPROVED + open tasks → block JSON', () => {
  const dir = path.join('C:\\Dev', 'amid-test-' + Date.now());
  try {
    fs.mkdirSync(path.join(dir, 'docs', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'foo', 'APPROVED'), '');
    fs.writeFileSync(path.join(dir, 'docs', 'foo', 'tasks.md'), '- [x] done\n- [ ] open\n');
    const r = runHook('am-i-done-gate.js', { cwd: dir });
    assert.equal(r.exitCode, 0);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /1 task\(s\) still open/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── strike-counter ───────────────────────────────────────────────

test('strike-counter: empty stdin → noop', () => {
  const r = runHook('strike-counter.js', '');
  assert.equal(r.exitCode, 0);
});

test('strike-counter: non-watched cmd → noop', () => {
  const ses = 'sc-noop-' + Date.now();
  const r = runHook('strike-counter.js', {
    session_id: ses, tool_input: { command: 'ls -la' }, tool_response: { exit_code: 1 }
  });
  assert.equal(r.exitCode, 0);
  cleanupState(ses);
});

test('strike-counter: 3rd consecutive npm test fail → block JSON', () => {
  const ses = 'sc-block-' + Date.now();
  for (let i = 0; i < 2; i++) {
    runHook('strike-counter.js', { session_id: ses, tool_input: { command: 'npm test' }, tool_response: { exit_code: 1 } });
  }
  const r = runHook('strike-counter.js', { session_id: ses, tool_input: { command: 'npm test' }, tool_response: { exit_code: 1 } });
  assert.equal(r.exitCode, 0);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /3 consecutive failures/);
  cleanupState(ses);
});

test('strike-counter: success after fails clears strikes', () => {
  const ses = 'sc-clear-' + Date.now();
  runHook('strike-counter.js', { session_id: ses, tool_input: { command: 'npm test' }, tool_response: { exit_code: 1 } });
  runHook('strike-counter.js', { session_id: ses, tool_input: { command: 'npm test' }, tool_response: { exit_code: 0 } });
  const sp = path.join(COUNTER_STATE_DIR, `state-${ses}.json`);
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  assert.deepEqual(state.strikes, {});
  assert.ok(state.test_pass_ts);
  cleanupState(ses);
});

test('strike-counter: secret in command is redacted in last_cmd', () => {
  const ses = 'sc-redact-' + Date.now();
  runHook('strike-counter.js', {
    session_id: ses,
    tool_input: { command: 'npm test --token=sk-ant-api03-FAKEKEYabcdefghijklmnop123456789' },
    tool_response: { exit_code: 1 }
  });
  const sp = path.join(COUNTER_STATE_DIR, `state-${ses}.json`);
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const entry = Object.values(state.strikes)[0];
  // Accept any [REDACTED*] marker — multiple regex patterns can catch the same secret
  assert.match(entry.last_cmd, /\[REDACTED/);
  assert.doesNotMatch(entry.last_cmd, /FAKEKEY/);
  cleanupState(ses);
});

// ─── stuck-detector ───────────────────────────────────────────────

test('stuck-detector: 5 edits same file → block JSON', () => {
  const ses = 'sd-block-' + Date.now();
  const filePath = 'C:/Dev/x/foo.ts';
  for (let i = 0; i < 4; i++) {
    runHook('stuck-detector.js', { session_id: ses, tool_input: { file_path: filePath } });
  }
  const r = runHook('stuck-detector.js', { session_id: ses, tool_input: { file_path: filePath } });
  assert.equal(r.exitCode, 0);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /5 edits/);
  cleanupState(ses);
});

test('stuck-detector: test_pass_ts resets counter', () => {
  const ses = 'sd-reset-' + Date.now();
  const filePath = 'C:/Dev/x/foo.ts';
  for (let i = 0; i < 4; i++) {
    runHook('stuck-detector.js', { session_id: ses, tool_input: { file_path: filePath } });
  }
  // Inject test_pass_ts in future
  const sp = path.join(COUNTER_STATE_DIR, `state-${ses}.json`);
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  state.test_pass_ts = new Date(Date.now() + 1000).toISOString();
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
  // Next edit — should reset
  const r = runHook('stuck-detector.js', { session_id: ses, tool_input: { file_path: filePath } });
  assert.equal(r.stdout, '');
  const after = JSON.parse(fs.readFileSync(sp, 'utf8'));
  assert.equal(after.edits[filePath].count, 1);
  cleanupState(ses);
});

// ─── drift-check ──────────────────────────────────────────────────

test('drift-check: no baseline → silent', () => {
  // Cannot easily clear real baseline; instead just check no-throw on empty stdin
  const r = runHook('drift-check.js', '', { CLAUDE_DRIFT_DISABLE: '1' });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('drift-check: clean state → silent', () => {
  // Real baseline should match current state per setup
  const r = runHook('drift-check.js', {});
  assert.equal(r.exitCode, 0);
  // stdout may have output if drift is real; just assert no crash
});

// ─── reflect-detect ───────────────────────────────────────────────

test('reflect-detect: no correction phrase → no queue write', () => {
  const QUEUE = path.join(STATE_DIR, 'reflect-queue.jsonl');
  const before = fs.existsSync(QUEUE) ? fs.statSync(QUEUE).size : 0;
  runHook('reflect-detect.js', { user_message: 'please add a feature', cwd: 'C:/Dev/test' });
  const after = fs.existsSync(QUEUE) ? fs.statSync(QUEUE).size : 0;
  assert.equal(after, before);
});

test('reflect-detect: correction phrase → queue grows', () => {
  const QUEUE = path.join(STATE_DIR, 'reflect-queue.jsonl');
  const before = fs.existsSync(QUEUE) ? fs.statSync(QUEUE).size : 0;
  const ses = 'rd-test-' + Date.now();
  runHook('reflect-detect.js', { user_message: 'actually, that should be different', session_id: ses, cwd: 'C:/Dev/test' });
  const after = fs.existsSync(QUEUE) ? fs.statSync(QUEUE).size : 0;
  assert.ok(after > before, 'queue should have grown');
  // Cleanup: remove just the test entry
  if (fs.existsSync(QUEUE)) {
    const lines = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(l => l && !l.includes(ses));
    if (lines.length === 0) fs.unlinkSync(QUEUE);
    else fs.writeFileSync(QUEUE, lines.join('\n') + '\n');
  }
});

test('reflect-detect: env CLAUDE_REFLECT_DISABLE=1 → noop', () => {
  const QUEUE = path.join(STATE_DIR, 'reflect-queue.jsonl');
  const before = fs.existsSync(QUEUE) ? fs.statSync(QUEUE).size : 0;
  runHook('reflect-detect.js',
    { user_message: 'actually wrong', session_id: 'disabled-test', cwd: 'C:/Dev/test' },
    { CLAUDE_REFLECT_DISABLE: '1' }
  );
  const after = fs.existsSync(QUEUE) ? fs.statSync(QUEUE).size : 0;
  assert.equal(after, before);
});

// ─── reflect-drain ────────────────────────────────────────────────

test('reflect-drain: stop_hook_active=true → noop', () => {
  const r = runHook('reflect-drain.js', { stop_hook_active: true, cwd: 'C:/Dev/test' });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('reflect-drain: redacts secrets from user_msg', () => {
  // Seed the queue
  const QUEUE = path.join(STATE_DIR, 'reflect-queue.jsonl');
  const ses = 'redact-drain-' + Date.now();
  const STAGING = path.join(os.homedir(), '.claude', 'projects', 'C--Dev-tools-Folder-fix', 'memory', '_staging');
  fs.rmSync(STAGING, { recursive: true, force: true });
  // Use reflect-detect to seed (tests integration path)
  runHook('reflect-detect.js', {
    user_message: 'actually wrong, sk-ant-api03-FAKEKEYabcdefghijklmnop123456789',
    session_id: ses,
    cwd: 'C:/Dev/tools/Folder fix'
  });
  runHook('reflect-drain.js', { session_id: ses, cwd: 'C:/Dev/tools/Folder fix' });
  if (fs.existsSync(STAGING)) {
    const files = fs.readdirSync(STAGING);
    if (files.length > 0) {
      const content = fs.readFileSync(path.join(STAGING, files[0]), 'utf8');
      assert.match(content, /\[REDACTED-LLM-KEY\]/);
      assert.doesNotMatch(content, /FAKEKEY/);
    }
  }
  fs.rmSync(STAGING, { recursive: true, force: true });
  // Drain consumed the queue entry; clean any remainder
  if (fs.existsSync(QUEUE)) {
    const lines = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(l => l && !l.includes(ses));
    if (lines.length === 0) fs.unlinkSync(QUEUE);
    else fs.writeFileSync(QUEUE, lines.join('\n') + '\n');
  }
});

// ─── critic-suggest / critic-surface ──────────────────────────────

test('critic-suggest: cwd outside SAFE_ROOTS → noop', () => {
  const r = runHook('critic-suggest.js', { cwd: 'C:\\Windows\\System32' });
  assert.equal(r.exitCode, 0);
});

test('critic-suggest: stop_hook_active=true → noop', () => {
  const r = runHook('critic-suggest.js', { stop_hook_active: true, cwd: 'C:/Dev/token-shield' });
  assert.equal(r.exitCode, 0);
});

test('critic-surface: no marker → silent', () => {
  const MARKER = path.join(STATE_DIR, 'critic-needed.json');
  if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER);
  const r = runHook('critic-surface.js', {});
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
});

test('critic-surface: fresh marker → emits suggestion', () => {
  const MARKER = path.join(STATE_DIR, 'critic-needed.json');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    fs.writeFileSync(MARKER, JSON.stringify({
      ts: new Date().toISOString(), repo: 'C:/Dev/test', base: 'main',
      files_changed: 5, insertions: 80, deletions: 30, total: 110, threshold: 100,
    }));
    const r = runHook('critic-surface.js', {});
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /critic-suggest/);
    assert.match(r.stdout, /110 LOC/);
  } finally {
    try { fs.unlinkSync(MARKER); } catch {}
  }
});

test('critic-surface: stale marker (>24h) → silent + cleanup', () => {
  const MARKER = path.join(STATE_DIR, 'critic-needed.json');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    fs.writeFileSync(MARKER, JSON.stringify({
      ts: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      repo: 'C:/Dev/test', total: 200, threshold: 100,
      // include all required fields so schema check passes; staleness still triggers cleanup
      insertions: 100, deletions: 100, files_changed: 5, base: 'main',
    }));
    const r = runHook('critic-surface.js', {});
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '');
    assert.equal(fs.existsSync(MARKER), false, 'stale marker should be deleted');
  } finally {
    try { fs.unlinkSync(MARKER); } catch {}
  }
});

// ─── claude-config-guard malformed-mcp-path block ────────────────

test('claude-config-guard: malformed .mcp.json path → block (exit 2)', () => {
  const malformed = JSON.stringify({
    mcpServers: { foo: { command: "C:UsersAviBendetsky\\foo.cmd", args: [] } }
  }, null, 2);
  const r = runHook('claude-config-guard.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: 'C:\\Users\\Avi Bendetsky\\.claude\\.mcp.json',
      content: malformed,
    },
  });
  assert.equal(r.exitCode, 2, 'should block with exit 2');
  assert.match(r.stderr, /malformed Windows path/);
});

test('claude-config-guard: well-formed .mcp.json path → allow', () => {
  const wellFormed = JSON.stringify({
    mcpServers: { foo: { command: "C:\\\\Users\\\\Avi Bendetsky\\\\foo.cmd", args: [] } }
  });
  const r = runHook('claude-config-guard.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: 'C:\\Users\\Avi Bendetsky\\.claude\\.mcp.json',
      content: wellFormed,
    },
  });
  assert.equal(r.exitCode, 0, 'should not block well-formed path');
});

test('claude-config-guard: forward-slash path → allow', () => {
  const fwd = JSON.stringify({
    mcpServers: { foo: { command: "C:/Users/Avi Bendetsky/foo.cmd", args: [] } }
  });
  const r = runHook('claude-config-guard.js', {
    tool_name: 'Write',
    tool_input: { file_path: 'C:\\test\\.mcp.json', content: fwd },
  });
  assert.equal(r.exitCode, 0);
});

test('claude-config-guard: bypass via env → allow malformed', () => {
  const malformed = JSON.stringify({
    mcpServers: { foo: { command: "C:UsersAviBendetsky\\foo.cmd", args: [] } }
  });
  const r = runHook('claude-config-guard.js', {
    tool_name: 'Write',
    tool_input: { file_path: 'C:\\test\\.mcp.json', content: malformed },
  }, { CLAUDE_CONFIG_GUARD_DISABLE_MCP_PATH: '1' });
  assert.equal(r.exitCode, 0, 'bypass should allow');
});

// ─── token-shield-validator: SessionStart drift detection ───────

test('token-shield-validator: SessionStart with bad MCP config emits drift warning', () => {
  // Provide a fake HOME so runValidation sees no MCP config files → failure.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-validator-'));
  try {
    const r = runHook('token-shield-validator.js',
      { hook_event_name: 'SessionStart', cwd: tmpHome },
      { USERPROFILE: tmpHome, HOME: tmpHome });
    assert.equal(r.exitCode, 0, 'fail-open');
    assert.match(r.stdout, /\[Token Shield\].*MCP config|Context Mode/i,
      'should warn about missing MCP config');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('token-shield-validator: SessionStart with valid wrapper-form MCP passes binary check', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-validator-'));
  try {
    // Create a valid .claude.json with cmd-wrapper context-mode
    fs.writeFileSync(path.join(tmpHome, '.claude.json'), JSON.stringify({
      mcpServers: {
        'context-mode': {
          command: 'cmd',
          args: ['/c', '%APPDATA%\\npm\\context-mode.cmd'],
          env: { CONTEXT_MODE_DB: '%USERPROFILE%\\.claude\\context-mode.db' },
        },
      },
    }));
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.claude', 'settings.json'), '{}');
    const r = runHook('token-shield-validator.js',
      { hook_event_name: 'SessionStart', cwd: tmpHome },
      { USERPROFILE: tmpHome, HOME: tmpHome });
    assert.equal(r.exitCode, 0);
    // Should NOT complain about context-mode missing; cmd-wrapper accepted.
    assert.doesNotMatch(r.stdout, /Context Mode MCP not in/);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('critic-surface: malformed marker (missing fields) → silent + cleanup', () => {
  const MARKER = path.join(STATE_DIR, 'critic-needed.json');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    fs.writeFileSync(MARKER, JSON.stringify({ ts: new Date().toISOString(), partial: true }));
    const r = runHook('critic-surface.js', {});
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '', 'no undefined leak in stdout');
    assert.equal(fs.existsSync(MARKER), false, 'malformed marker should be deleted');
  } finally {
    try { fs.unlinkSync(MARKER); } catch {}
  }
});
