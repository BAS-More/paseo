#!/usr/bin/env node
// Reaps orphaned MCP servers, node/python/cmd processes spawned by prior Claude Code
// sessions that weren't cleaned up (Windows doesn't deliver SIGTERM on terminal close).
// Runs as a Stop + SessionStart hook. Also standalone: node zombie-reaper.mjs

import { execFileSync, execSync } from 'node:child_process';

const MAX_AGE_MINUTES = 5;
const self = process.pid;
const parent = process.ppid;

function isSafe(pid) {
  return pid > 0 && pid !== self && pid !== parent;
}

if (process.platform !== 'win32') process.exit(0);

const cutoff = new Date(Date.now() - MAX_AGE_MINUTES * 60 * 1000);
let killed = 0;

// Patterns that identify MCP server processes in their command lines.
// Matches substring anywhere in the cmdline — covers both the node.exe child
// and cmd.exe /d /s /c wrappers that Claude Desktop uses to launch MCP servers.
const MCP_PATTERNS = [
  // Node MCP servers
  'knowledge-graph',
  'playwright',          // covers @playwright/mcp and playwright-mcp
  'context7',
  'synthlang-mcp',
  'total-recall',
  'fact-mcp',
  'graphiti',
  'design-extract',
  'claude-bridge',
  'context-mode',
  'code-review-graph',
  'sentry',
  'sequential-thinking',
  'chrome-devtools',
  'avios-context-mcp',
  'mcp-pdf',             // covers mcp-pdf-server
  'server-pdf',          // covers @modelcontextprotocol/server-pdf
  // Python MCP servers
  'vault_mcp',
  'serena',
  'cursortouch',         // windows-mcp extension
  'windows-mcp',
  // Misc spawns that leak
  'watchdog-security',
  'caveman-activate',
  // Python virtualenv temp builds (MCP server installs via uv)
  'uv\\cache\\builds',
  'uv/cache/builds',
  'uv\\cache\\archive',
  'uv/cache/archive',
];

// Phase 1: Kill MCP server processes (node, python, cmd) older than MAX_AGE
try {
  const ps = execFileSync(
    'powershell',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='python.exe' OR Name='cmd.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CreationDate.ToString('o'))`t$($_.CommandLine)\" }",
    ],
    { encoding: 'utf8', timeout: 15_000 }
  );

  // Build live PID set for parent-alive checks
  const alivePids = new Set();
  try {
    const all = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | ForEach-Object { $_.Id }'], { encoding: 'utf8', timeout: 5000 });
    for (const l of all.split(/\r?\n/)) { const n = parseInt(l, 10); if (n > 0) alivePids.add(n); }
  } catch {}

  for (const line of ps.split(/\r?\n/)) {
    const [pidStr, ppidStr, dateStr, ...cmdParts] = line.split('\t');
    const pid = parseInt(pidStr, 10);
    const ppid = parseInt(ppidStr, 10);
    const cmd = cmdParts.join('\t');
    if (!pid || !isSafe(pid) || !cmd) continue;

    const created = new Date(dateStr);
    if (created >= cutoff) continue;

    const isMcpZombie = MCP_PATTERNS.some(p => cmd.includes(p));
    const isNpxMcp = cmd.includes('npx-cli.js') && cmd.includes('npm-cache');
    const isOrphanMcp = (isMcpZombie || isNpxMcp) && ppid > 0 && !alivePids.has(ppid);

    // Kill if: matches MCP pattern, OR is an npx MCP launcher, OR parent is dead
    if (isMcpZombie || isNpxMcp || isOrphanMcp) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
        killed++;
      } catch {}
    }
  }
} catch {}

// Phase 2: Clean up orphaned conhost.exe from dead parents.
try {
  const ps = execFileSync(
    'powershell',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='conhost.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CreationDate.ToString('o'))\" }",
    ],
    { encoding: 'utf8', timeout: 10_000 }
  );

  const alivePids = new Set();
  try {
    const all = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | ForEach-Object { $_.Id }'], { encoding: 'utf8', timeout: 5000 });
    for (const l of all.split(/\r?\n/)) { const n = parseInt(l, 10); if (n > 0) alivePids.add(n); }
  } catch {}

  for (const line of ps.split(/\r?\n/)) {
    const [pidStr, ppidStr, dateStr] = line.split('\t');
    const pid = parseInt(pidStr, 10);
    const ppid = parseInt(ppidStr, 10);
    if (!pid || !isSafe(pid)) continue;

    const created = new Date(dateStr);
    if (created >= cutoff) continue;

    if (ppid > 0 && !alivePids.has(ppid)) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 3000 });
        killed++;
      } catch {}
    }
  }
} catch {}

if (killed > 0) {
  process.stderr.write(`[zombie-reaper] Cleaned up ${killed} orphaned process(es)\n`);
}
