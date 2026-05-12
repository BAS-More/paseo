#!/usr/bin/env node
// mass-delete-guard.js — PreToolUse hook
// Blocks commands that would wipe .claude/ or >10 .jsonl chat files at once.
// Fail-open on errors (don't block if hook itself breaks).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const LOG_FILE = path.join(CLAUDE_DIR, '_logs', 'mass-delete-guard.log');
const THRESHOLD_JSONL = 10; // block deletion >10 chat files

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) { /* ignore */ }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // guard: if no stdin within 200ms, resolve empty
    setTimeout(() => resolve(data), 200);
  });
}

function checkDangerous(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  const lower = cmd.toLowerCase();

  // Nuke .claude (the directory itself, not files inside).
  // Only triggers on recursive-delete syntax + .claude at END of path (dir boundary).
  const nukeClaude = [
    // rm -rf .../.claude  OR  rm -rf .../.claude/
    /rm\s+-[a-z]*[rf][a-z]*(\s+-[a-z]+)*\s+["']?([^"'\s]*\/)?\.claude[\/\\]?\s*(?:["']|$)/i,
    // PowerShell: Remove-Item -Recurse .../.claude
    /remove-item\s+(-[a-z]+\s+)*["']?([^"'\s]*[\/\\])?\.claude[\/\\]?\s*(?:["']|$)/i,
    // Windows cmd: rmdir /s  .claude   OR   rd /s .claude
    /\b(rmdir|rd)\s+\/s[^"']*\.claude[\/\\]?\s*(?:["']|$)/i,
    // Windows cmd: del /s /q .claude\*
    /\bdel\s+\/[sq][^"']*\.claude[\/\\]/i,
  ];
  for (const rx of nukeClaude) {
    if (rx.test(cmd)) return 'Command appears to recursively delete .claude directory';
  }

  // Wildcard jsonl delete
  if (/(rm|del|remove-item|rmdir)[^;]*\*\.jsonl/i.test(cmd)) {
    return 'Command appears to delete .jsonl files via wildcard';
  }

  // `rm -rf $HOME` or equivalent
  if (/rm\s+-[a-z]*r[a-z]*\s+(-[a-z]+\s+)*(\$HOME|~|%USERPROFILE%)\b/i.test(cmd)) {
    return 'Command deletes user home directory recursively';
  }

  return null;
}

async function main() {
  try {
    const raw = await readStdin();
    if (!raw) { process.exit(0); }

    let event;
    try { event = JSON.parse(raw); } catch (_) { process.exit(0); }

    const toolName = event.tool_name || event.toolName || '';
    const toolInput = event.tool_input || event.toolInput || {};

    // Only guard shell-ish tools
    if (!/^(Bash|PowerShell|mcp__.*run_command|mcp__.*execute_shell_command)$/i.test(toolName)) {
      process.exit(0);
    }

    const cmd = toolInput.command || toolInput.cmd || '';
    const reason = checkDangerous(cmd);

    if (reason) {
      log(`BLOCKED [${toolName}]: ${reason} | cmd=${cmd.substring(0, 200)}`);
      // Emit JSON response to deny (schema per Claude Code PreToolUse hook)
      process.stdout.write(JSON.stringify({
        continue: false,
        stopReason: `mass-delete-guard BLOCKED: ${reason}. If intentional, run via interactive shell outside Claude Code or disable this hook.`,
        suppressOutput: false,
      }));
      process.exit(2); // non-zero blocks tool
    }

    process.exit(0);
  } catch (err) {
    log(`HOOK_ERROR: ${err.message}`);
    process.exit(0); // fail-open
  }
}

main();
