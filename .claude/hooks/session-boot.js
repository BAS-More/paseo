#!/usr/bin/env node
/**
 * H5 — session-boot
 *
 * Event: SessionStart
 *
 * Proposes the next action in a 3-line summary by reading:
 *   1. CLAUDE.md         (if present — "last state" block)
 *   2. git branch state  (are we on a `project/*` branch with in-flight work?)
 *   3. avios-context     (via EZRA session-sync; this hook doesn't duplicate)
 *
 * Prints to stdout. stdout becomes an additionalContext message on
 * SessionStart — Claude reads it as part of session orientation.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { execSync } = require("node:child_process");

const CWD = process.cwd();

/**
 * Hook integrity check (added 2026-04-20 per SA5 hardening).
 * Compares live SHA256 of every .js hook against hooks-manifest.json.
 * On mismatch: logs to ~/.claude/_logs/integrity-log.jsonl AND emits a WARNING
 * to stdout so Claude sees it on session start. Fail-open on all errors.
 */
function verifyHookIntegrity() {
  try {
    const hookDir = path.join(os.homedir(), ".claude", "hooks");
    const manifestPath = path.join(hookDir, "hooks-manifest.json");
    const logPath = path.join(os.homedir(), ".claude", "_logs", "integrity-log.jsonl");
    if (!fs.existsSync(manifestPath)) return null;  // no manifest → skip
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const mismatches = [];
    for (const [file, expected] of Object.entries(manifest.hashes || {})) {
      const p = path.join(hookDir, file);
      if (!fs.existsSync(p)) { mismatches.push({ file, reason: "missing" }); continue; }
      const actual = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      if (actual !== expected) mismatches.push({ file, expected, actual });
    }
    if (mismatches.length === 0) return null;
    const entry = { ts: new Date().toISOString(), event: "hook_integrity_mismatch", mismatches };
    try { fs.appendFileSync(logPath, JSON.stringify(entry) + "\n"); } catch { /* ignore */ }
    return `WARNING: hook integrity drift (${mismatches.length} file${mismatches.length === 1 ? "" : "s"}): ${mismatches.map(m => m.file).join(", ")}. If intentional, run \`node ~/.claude/hooks/rebuild-manifest.js\`.`;
  } catch (e) {
    return null;  // fail-open
  }
}

function readClaudeMdLastState() {
  const file = path.join(CWD, "CLAUDE.md");
  if (!fs.existsSync(file)) return null;
  try {
    const content = fs.readFileSync(file, "utf8");
    // Capture everything after the LAST-STATE marker until the next heading,
    // horizontal rule, or end-of-file. Skip HTML comments inside the block.
    const m = content.match(/<!-- LAST-STATE -->([\s\S]*?)(?=\n#[^#]|\n---|$)/);
    if (!m) return null;
    return m[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("<!--"))
      .slice(0, 6);
  } catch {
    return null;
  }
}

function detectProjectBranches() {
  try {
    const out = execSync('git branch --list "project/*" --format="%(refname:short)"', {
      cwd: CWD,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).toString().trim();
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: CWD,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).toString().trim();
  } catch {
    return null;
  }
}

function uncheckedPlanItems() {
  // Find docs/*/plan.md and count `- [ ]` items
  try {
    const docs = path.join(CWD, "docs");
    if (!fs.existsSync(docs)) return [];
    const slugs = fs.readdirSync(docs, { withFileTypes: true });
    const pending = [];
    for (const s of slugs) {
      if (!s.isDirectory()) continue;
      const plan = path.join(docs, s.name, "plan.md");
      if (!fs.existsSync(plan)) continue;
      try {
        const content = fs.readFileSync(plan, "utf8");
        const unchecked = (content.match(/^- \[ \]/gm) || []).length;
        if (unchecked > 0) pending.push({ slug: s.name, unchecked });
      } catch { /* ignore */ }
    }
    return pending;
  } catch {
    return [];
  }
}

/**
 * Vault hint — emit a one-liner on session start telling Claude that
 * claude-vault is available and how to pre-load its tools. Without this,
 * claude-vault's MCP tools sit in the deferred pool and Claude reaches for
 * them as a last resort instead of a first option when handling credentials.
 *
 * Gate on `~/.claude-vault/index.json` existing (that's where vault_mcp.py
 * lives; its presence means the MCP server can actually respond).
 */
function vaultHint() {
  try {
    const vaultIndex = path.join(os.homedir(), ".claude-vault", "index.json");
    if (!fs.existsSync(vaultIndex)) return null;
    return (
      "claude-vault is available. For any credential/token/password/API-key/OAuth/PAT/secret/TOTP task, " +
      "PREFER the vault over hardcoding, env-var scaffolding, or asking Avi to paste values. " +
      "Pre-load its deferred tools in one call: " +
      "ToolSearch({query:\"select:mcp__claude-vault__get_credential,mcp__claude-vault__list_credentials,mcp__claude-vault__get_totp,mcp__claude-vault__list_recipes\",max_results:4}). " +
      "If the credential isn't in the vault, tell Avi to run `python C:/Dev/tools/vault/vault.py set <service> <key>` — don't invent placeholders."
    );
  } catch {
    return null;
  }
}

/**
 * Prune dead claude/* worktrees from .claude/worktrees/.
 * "Dead" = has a .git file (real worktree), no staged/modified changes,
 * and last-modified more than 30 minutes ago. Skips the current session.
 * Returns a summary string if anything was pruned, null otherwise.
 */
function pruneDeadWorktrees() {
  try {
    // Find the git root by walking up from CWD
    let root = CWD;
    while (root !== path.dirname(root)) {
      if (fs.existsSync(path.join(root, ".git"))) break;
      root = path.dirname(root);
    }
    if (!fs.existsSync(path.join(root, ".git"))) return null;

    const wtDir = path.join(root, ".claude", "worktrees");
    if (!fs.existsSync(wtDir)) return null;

    const entries = fs.readdirSync(wtDir, { withFileTypes: true })
      .filter(e => e.isDirectory());

    const currentSession = path.basename(CWD);
    const pruned = [];
    const THIRTY_MIN_MS = 30 * 60 * 1000;

    for (const entry of entries) {
      if (entry.name === currentSession) continue;

      const wtPath = path.join(wtDir, entry.name);
      const gitFile = path.join(wtPath, ".git");
      if (!fs.existsSync(gitFile)) {
        // Orphaned directory with no .git — delete it outright
        try {
          fs.rmSync(wtPath, { recursive: true, force: true });
          pruned.push(`${entry.name} (orphan dir)`);
        } catch { /* ignore locked dirs */ }
        continue;
      }

      // Check age — skip if modified in the last 30 minutes
      const stat = fs.statSync(wtPath);
      if (Date.now() - stat.mtimeMs < THIRTY_MIN_MS) continue;

      // Check for uncommitted changes (staged or modified; not untracked)
      try {
        const out = execSync("git status --porcelain --untracked-files=no", {
          cwd: wtPath,
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 4000,
        }).toString().trim();
        if (out !== "") continue; // has staged/modified files — skip
      } catch { continue; }

      // Safe to prune: remove worktree and its branch
      try {
        const branchName = `claude/${entry.name}`;
        execSync(`git -C "${root}" worktree remove --force "${wtPath}"`, {
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 8000,
        });
        try {
          execSync(`git -C "${root}" branch -D "${branchName}"`, {
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 4000,
          });
        } catch { /* branch may not exist */ }
        pruned.push(entry.name);
      } catch { /* skip if worktree remove fails */ }
    }

    if (pruned.length === 0) return null;
    return `  Auto-pruned ${pruned.length} dead worktree${pruned.length === 1 ? "" : "s"}: ${pruned.join(", ")}`;
  } catch {
    return null;
  }
}

function main() {
  const slug = path.basename(CWD);
  const branch = currentBranch();
  const projectBranches = detectProjectBranches();
  const pending = uncheckedPlanItems();
  const lastState = readClaudeMdLastState();

  const lines = [];
  lines.push(`[session-boot] Project: \`${slug}\` · Branch: ${branch || "(none)"}`);

  const integrity = verifyHookIntegrity();
  if (integrity) lines.push(`  ${integrity}`);

  const pruneResult = pruneDeadWorktrees();
  if (pruneResult) lines.push(pruneResult);

  const vh = vaultHint();
  if (vh) lines.push(`  ${vh}`);

  if (pending.length > 0) {
    const p = pending[0];
    lines.push(
      `  In-flight: docs/${p.slug}/plan.md has ${p.unchecked} unchecked item${p.unchecked === 1 ? "" : "s"}`
    );
  } else if (projectBranches.length > 0) {
    lines.push(`  Open project branches: ${projectBranches.join(", ")}`);
  } else {
    lines.push(`  No in-flight project detected — ready for a new kickoff.`);
  }

  if (lastState) {
    lines.push(`  Last session: ${lastState.join(" · ").slice(0, 200)}`);
  } else {
    lines.push(`  No CLAUDE.md last-state — fresh session.`);
  }

  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[session-boot] soft fail: ${err.message}\n`);
  process.exit(0);
}
