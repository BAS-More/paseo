#!/usr/bin/env node
/**
 * claude-config-guard
 *
 * Event:   PreToolUse
 * Matcher: Write|Edit|MultiEdit
 *
 * Fires when Claude attempts to modify its own configuration surface.
 * Non-blocking by design: records the edit to an audit log and injects a
 * reminder that the change should be reviewed with ezra-guardian.
 *
 * Watched paths (matched case-insensitively on the resolved file path):
 *   - ~/.claude/hooks/**           (executable hooks)
 *   - ~/.claude/rules/**           (advisor rule content)
 *   - ~/.claude/agents/**          (subagent definitions)
 *   - ~/.claude/skills/**          (skill definitions)
 *   - ~/.claude/bin/**             (maintenance scripts)
 *   - ~/.claude/settings.json
 *   - ~/.claude.json                (MCP config)
 *   - any path ending in /hooks-manifest.json  (integrity manifest)
 *
 * Audit trail: ~/.claude/_logs/config-audit.jsonl (append-only, one JSON per line).
 * Capped at ~1000 lines to avoid unbounded growth.
 *
 * Fail-open: any error → exit 0 silently. Never blocks.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CLAUDE_DIR = path.resolve(path.join(os.homedir(), ".claude"));
const AUDIT_LOG = path.join(CLAUDE_DIR, "_logs", "config-audit.jsonl");
const AUDIT_MAX_LINES = 1000;

// Sensitive sub-paths (relative to ~/.claude/) that trigger the guard.
const SENSITIVE_SUBDIRS = ["hooks", "rules", "agents", "skills", "bin"];
const SENSITIVE_FILES = [
  path.join(CLAUDE_DIR, "settings.json"),
  path.resolve(path.join(os.homedir(), ".claude.json")),
];

function readStdinSync() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function extractFilePath(input) {
  try {
    const p = JSON.parse(input || "{}");
    return (p.tool_input?.file_path || p.tool_input?.path || p.tool_input?.filePath || "").toString();
  } catch { return ""; }
}

function extractToolName(input) {
  try { return (JSON.parse(input || "{}").tool_name || "").toString(); }
  catch { return ""; }
}

/**
 * Extract candidate-text the tool will write into the target file.
 * - Write: full new content
 * - Edit:  new_string fragment
 * - MultiEdit: concat of every edits[].new_string
 * Returns "" when no content is available (read tools, etc.).
 */
function extractWriteContent(input) {
  try {
    const p = JSON.parse(input || "{}");
    const ti = p.tool_input || {};
    const tool = (p.tool_name || "").toString();
    if (tool === "Write" && typeof ti.content === "string") return ti.content;
    if (tool === "Edit" && typeof ti.new_string === "string") return ti.new_string;
    if (tool === "MultiEdit" && Array.isArray(ti.edits)) {
      return ti.edits.map(e => (e && typeof e.new_string === "string") ? e.new_string : "").join("\n");
    }
    return "";
  } catch { return ""; }
}

/**
 * Detect Windows path-stripping bug (learning_bash_heredoc_backslash.md).
 *
 * Valid path in JSON source has escaped backslashes: "C:\\\\Users\\\\..." (4 chars per separator).
 * Corrupted path looks like "C:UsersAvi..." (drive letter immediately followed by a directory name letter).
 *
 * Returns the first offending fragment OR null if clean.
 *
 * Only fires for `.mcp.json` writes — content for other files is not inspected.
 */
function detectMalformedMcpPaths(content) {
  if (!content || typeof content !== "string") return null;
  // Match a JSON string value where drive-letter is followed by a non-backslash, non-slash, non-quote char.
  // i.e.  "command": "C:Users..."  or  "C:\nUsers..."  (literal newline-N) etc.
  // GOOD: "C:\\\\..." (4 chars in JSON source) or "C:/..." (forward slash also acceptable).
  const RE = /"[A-Za-z][A-Za-z]*"\s*:\s*"([A-Z]):([A-Za-z])/;
  const m = RE.exec(content);
  if (m) {
    return `"${m[0]}..." — drive letter "${m[1]}:" should be followed by "\\\\" (escaped backslash) or "/" (forward slash), not "${m[2]}". See learning_bash_heredoc_backslash.md.`;
  }
  return null;
}

function classify(filePath) {
  if (!filePath) return null;
  let resolved;
  try { resolved = path.resolve(filePath); } catch { return null; }
  const lower = resolved.toLowerCase();

  // Exact sensitive files
  for (const f of SENSITIVE_FILES) {
    if (lower === f.toLowerCase()) return { category: "config-file", path: resolved };
  }

  // Sensitive subdirs under ~/.claude/
  const claudeLower = CLAUDE_DIR.toLowerCase() + path.sep.toLowerCase();
  if (lower.startsWith(claudeLower)) {
    const rel = lower.slice(claudeLower.length);
    const firstSeg = rel.split(path.sep)[0];
    if (SENSITIVE_SUBDIRS.includes(firstSeg)) {
      return { category: firstSeg, path: resolved };
    }
  }

  // Any hooks-manifest.json anywhere
  if (path.basename(lower) === "hooks-manifest.json") {
    return { category: "manifest", path: resolved };
  }

  return null;
}

function truncateAuditLog() {
  try {
    if (!fs.existsSync(AUDIT_LOG)) return;
    const stat = fs.statSync(AUDIT_LOG);
    if (stat.size < 256 * 1024) return; // Don't bother unless >256 KB
    const lines = fs.readFileSync(AUDIT_LOG, "utf8").split("\n");
    if (lines.length <= AUDIT_MAX_LINES) return;
    const kept = lines.slice(-AUDIT_MAX_LINES);
    fs.writeFileSync(AUDIT_LOG, kept.join("\n"));
  } catch { /* ignore */ }
}

function appendAudit(entry) {
  try {
    truncateAuditLog();
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    try { process.stderr.write(`[claude-config-guard] audit write failed: ${e.message}\n`); } catch { /* ignore */ }
  }
}

function buildReminder(hit) {
  const verb = hit.category === "manifest"
    ? "modify the integrity manifest"
    : `edit a ${hit.category === "config-file" ? "config file" : hit.category + "/"} entry`;
  return (
    `[claude-config-guard] Detected attempt to ${verb}:\n` +
    `  ${hit.path}\n\n` +
    `This is part of the Claude Code configuration surface. Before finalizing:\n` +
    `  1. Confirm the change is intentional and scoped (no drive-by edits).\n` +
    `  2. After editing hooks, run: node "${path.join(CLAUDE_DIR, "hooks", "rebuild-manifest.js")}"\n` +
    `  3. For architectural changes, consider: /ezra:guardian for governance review.\n` +
    `  4. Audit trail written to: ${AUDIT_LOG}\n`
  );
}

function main() {
  const input = readStdinSync();
  const toolName = extractToolName(input);
  const filePath = extractFilePath(input);
  if (!filePath) process.exit(0);

  // Hard-block guard for `.mcp.json` malformed Windows paths.
  // Bypass: env CLAUDE_CONFIG_GUARD_DISABLE_MCP_PATH=1
  const isMcpJson = filePath.toLowerCase().endsWith(".mcp.json");
  if (isMcpJson && process.env.CLAUDE_CONFIG_GUARD_DISABLE_MCP_PATH !== "1") {
    const content = extractWriteContent(input);
    const malformed = detectMalformedMcpPaths(content);
    if (malformed) {
      process.stderr.write(
        `[claude-config-guard] BLOCKED: malformed Windows path detected in ${filePath}.\n` +
        `  ${malformed}\n` +
        `  Common cause: bash heredoc strips backslashes when piped to \`node -e\`. Use the Edit tool with literal \\\\ escapes, OR a temp .js file with single-quote heredoc, OR forward slashes.\n` +
        `  Bypass: set CLAUDE_CONFIG_GUARD_DISABLE_MCP_PATH=1 in env (audit trail still records).\n`
      );
      appendAudit({
        ts: new Date().toISOString(),
        tool: toolName,
        category: "BLOCK_MALFORMED_MCP_PATH",
        path: filePath,
        cwd: process.cwd(),
        evidence: malformed,
      });
      process.exit(2);
    }
  }

  const hit = classify(filePath);
  if (!hit) process.exit(0);

  appendAudit({
    ts: new Date().toISOString(),
    tool: toolName,
    category: hit.category,
    path: hit.path,
    cwd: process.cwd(),
  });

  // Non-blocking: inject a reminder via additionalContext so it shows up in the
  // tool-use feedback but doesn't reject the operation.
  const reminder = buildReminder(hit);
  process.stdout.write(JSON.stringify({ additionalContext: reminder }) + "\n");
  process.exit(0);
}

try { main(); } catch (err) {
  try { process.stderr.write(`[claude-config-guard] ${err.message}\n`); } catch { /* ignore */ }
  process.exit(0);
}
