#!/usr/bin/env node
/**
 * H6 — permission-auto
 *
 * Event: PermissionRequest
 *
 * Auto-approves common safe Bash patterns before the permission dialog is
 * shown to the user. Dramatically cuts the "yes, allow" click-through noise
 * on routine operations (npm test, tsc, git status, gh pr view, etc.).
 *
 * Response contract (stdout JSON):
 *   {"decision": "allow"}  → approve silently
 *   {"decision": "deny"}   → hard-deny (not used here)
 *   {}                     → fall through to normal dialog
 *
 * We are conservative: anything not on the allowlist falls through. The
 * allowlist is intentionally narrow and observable (read-only or test-type
 * commands). NEVER allow anything mutating: no `npm install`, `git push`,
 * `rm`, `kill`, etc.
 */

const fs = require("node:fs");

const ALLOW_REGEX = [
  // npm / node test + typecheck + dry ops
  /^npm (run|test)(\s|$)/,
  /^npm (ls|outdated|view|doctor)(\s|$)/,
  /^npx (--no -- )?(tsc|vitest|jest|c8|eslint|biome|prettier) /,
  /^node --version$/,
  /^npm --version$/,

  // git — read-only
  /^git (status|log|diff|show|blame|branch|tag|remote|ls-files|rev-parse|describe|reflog|shortlog|for-each-ref|worktree list)(\s|$)/,
  /^git stash list(\s|$)/,
  /^git config --get(\s|$)/,

  // gh — read-only
  /^gh (pr|issue|run|workflow|repo|release) (view|list|status|diff|checks)(\s|$)/,
  /^gh auth status$/,
  /^gh api [^|;&`]* -X GET/,

  // filesystem — read-only
  /^ls(\s|$)/,
  /^cat\s/,
  /^head\s/,
  /^tail\s/,
  /^wc\s/,
  /^find\s/,
  /^grep\s/,
  /^rg\s/,
  /^fd\s/,
  /^jq\s/,
  /^pwd$/,
  /^echo\s/,

  // security tools — read-only scans
  /^gitleaks (detect|protect|version)(\s|$)/,
  /^semgrep (ci|scan|--version)(\s|$)/,

  // project runtime checks
  /^docker (ps|images|logs|inspect)(\s|$)/,
  /^kubectl (get|describe|logs)(\s|$)/,
];

function readStdinSync() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function getCommand(input) {
  try {
    const p = JSON.parse(input || "{}");
    return (
      p.tool_input?.command ||
      p.tool_input?.cmd ||
      p.command ||
      ""
    );
  } catch {
    return "";
  }
}

function getToolName(input) {
  try {
    const p = JSON.parse(input || "{}");
    return p.tool_name || p.tool || "";
  } catch {
    return "";
  }
}

function main() {
  const raw = readStdinSync();
  const toolName = getToolName(raw);
  const command = getCommand(raw);

  // Only auto-approve Bash tool calls
  if (toolName !== "Bash" || !command) {
    process.stdout.write("{}\n");
    process.exit(0);
  }

  // Strip sudo / timeout / env prefixes
  const stripped = command
    .replace(/^sudo\s+/, "")
    .replace(/^timeout(\s+\S+)+\s+/, "")
    .replace(/^(\w+=\S+\s+)+/, "")
    .trim();

  for (const re of ALLOW_REGEX) {
    if (re.test(stripped)) {
      process.stdout.write('{"decision":"allow"}\n');
      process.exit(0);
    }
  }

  // Fall through to normal dialog
  process.stdout.write("{}\n");
  process.exit(0);
}

try {
  main();
} catch (err) {
  // Fail-open to the dialog
  process.stdout.write("{}\n");
  process.exit(0);
}
