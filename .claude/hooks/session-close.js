#!/usr/bin/env node
/**
 * H4 — session-close
 *
 * Event: Stop
 *
 * Writes session persistence layer-by-layer:
 *   1. Local log  — ~/.claude/session-logs/YYYY-MM-DD.md (append)
 *   2. CLAUDE.md  — patch the "last state" block in the project root
 *   3. In-chat    — 4-line summary to stdout
 *
 * (Layer 2: avios-context save is handled by the existing EZRA memory-hook.
 *  We don't duplicate that from this hook.)
 *
 * Fail-open: if anything errors, still print the in-chat summary so the user
 * has SOMETHING to see.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CWD = process.cwd();
const LOG_DIR = path.join(os.homedir(), ".claude", "session-logs");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function projectSlug() {
  try {
    return path.basename(CWD);
  } catch {
    return "unknown";
  }
}

function detectBranch() {
  try {
    const { execSync } = require("node:child_process");
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: CWD,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).toString().trim();
  } catch {
    return null;
  }
}

function countDirtyFiles() {
  try {
    const { execSync } = require("node:child_process");
    const out = execSync("git status --porcelain", {
      cwd: CWD,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).toString();
    return out.split("\n").filter(Boolean).length;
  } catch {
    return -1;
  }
}

function appendLog(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${today()}.md`);
    fs.appendFileSync(file, entry);
  } catch (err) {
    process.stderr.write(`[session-close] log write failed: ${err.message}\n`);
  }
}

function patchClaudeMd(summary) {
  const file = path.join(CWD, "CLAUDE.md");
  if (!fs.existsSync(file)) return;
  try {
    let content = fs.readFileSync(file, "utf8");
    const marker = "<!-- LAST-STATE -->";
    const block =
      `${marker}\n` +
      `<!-- Auto-updated by session-close hook. Claude reads this on SessionStart. -->\n` +
      `**Last session:** ${nowIso()}\n` +
      `**Branch:** ${summary.branch || "(unknown)"}\n` +
      `**Dirty files:** ${summary.dirty >= 0 ? summary.dirty : "(unknown)"}\n\n`;
    if (content.includes(marker)) {
      // Replace existing block — find marker, replace to next blank line after block header
      content = content.replace(
        /<!-- LAST-STATE -->[\s\S]*?(?=\n#|\n---|\n<!--|$)/,
        block
      );
    } else {
      content += "\n\n" + block;
    }
    fs.writeFileSync(file, content);
  } catch (err) {
    process.stderr.write(`[session-close] CLAUDE.md patch failed: ${err.message}\n`);
  }
}

/**
 * Kill orphaned child processes left by this session.
 * Uses PowerShell (Windows-only) to find node/bash/cmd processes whose
 * immediate parent PID is dead and that are older than 2 minutes.
 * The 2-minute grace period protects processes that just started from
 * a concurrent active session.
 * Fail-open — errors are swallowed so session-close never blocks.
 */
function killOrphanedChildren() {
  try {
    const { execSync } = require("node:child_process");
    const script = `
$allPids = (Get-Process).Id
$killed = @()
'node.exe','bash.exe','cmd.exe' | ForEach-Object {
  $name = $_
  Get-CimInstance Win32_Process -Filter "Name='$name'" | Where-Object {
    $allPids -notcontains $_.ParentProcessId -and
    ((Get-Date) - $_.CreationDate).TotalMinutes -gt 2
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $killed += $_.ProcessId
  }
}
if ($killed.Count -gt 0) { "killed:$($killed -join ',')" } else { "none" }
`.trim();
    const result = execSync(`pwsh -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    }).toString().trim();
    return result !== "none" ? `  Orphan processes killed: ${result.replace("killed:", "")}` : null;
  } catch {
    return null;
  }
}

function main() {
  const branch = detectBranch();
  const dirty = countDirtyFiles();
  const slug = projectSlug();

  const summary = { branch, dirty, slug };

  const entry =
    `\n### ${nowIso()} — ${slug}\n` +
    `- Branch: \`${branch || "(none)"}\`\n` +
    `- Dirty files: ${dirty >= 0 ? dirty : "(unknown)"}\n`;
  appendLog(entry);
  patchClaudeMd(summary);

  const orphanResult = killOrphanedChildren();

  // 4-line in-chat summary — user sees this at session end
  const lines = [
    `[session-close] Session ended for \`${slug}\``,
    `  Branch: ${branch || "(none)"}`,
    `  Dirty files: ${dirty >= 0 ? dirty : "(unknown)"}`,
    `  Log: ~/.claude/session-logs/${today()}.md`,
  ];
  if (orphanResult) lines.push(orphanResult);
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[session-close] soft fail: ${err.message}\n`);
  process.exit(0);
}
