#!/usr/bin/env node
/**
 * H8 — plan-first-prompt
 *
 * Event: UserPromptSubmit
 *
 * When the user submits a coding task prompt (verbs like "fix", "add",
 * "implement", "build", "create", "refactor") AND there's no APPROVED plan
 * marker in scope, inject a reminder that Claude should:
 *   1. invoke /ezra:advisor for best-practice check
 *   2. invoke /spec for the plan
 *   3. wait for APPROVED before coding
 *
 * Philosophy:
 *   - Cheap — no subprocess, just regex + fs.existsSync
 *   - Reversible — user can bypass with prefix "!" or "raw:" or "#"
 *   - Non-blocking — just appends context, doesn't block the prompt
 *   - Skip trivial asks — short prompts, questions, navigation all pass through
 *
 * Output contract:
 *   Exit 0 with JSON {"additionalContext": "..."} to inject reminder
 *   Exit 0 with empty stdout to pass through
 *   Fail-open on errors
 */

const fs = require("node:fs");
const path = require("node:path");

// Verbs that indicate the user wants changes made (not info questions)
const CODING_VERB_RE = /\b(fix|add|implement|build|create|refactor|rewrite|change|update|modify|patch|resolve|correct|wire|connect|integrate|deploy|install|configure|scaffold|delete|remove)\b/i;

// Prompts that are clearly NOT "write code now" and should pass through
const QUESTION_RE = /^(what|why|how|when|where|who|which|is|are|does|do|can|could|should|would|will|explain|describe|show|tell|list|analyse|analyze|review|audit|research|find|search|check|compare)\b/i;

// Explicit bypass prefixes (first non-whitespace chars)
const BYPASS_PREFIXES = ["!", "#", "/", "raw:", "skip:"];

function readStdinSync() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function extractPrompt(input) {
  try {
    const p = JSON.parse(input || "{}");
    return p.prompt || p.user_prompt || p.content || "";
  } catch {
    return "";
  }
}

function isBypassed(prompt) {
  const trimmed = prompt.trimStart();
  return BYPASS_PREFIXES.some(p => trimmed.startsWith(p));
}

function hasApprovedMarker(startDir) {
  let cur = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    try {
      const docs = path.join(cur, "docs");
      if (fs.existsSync(docs) && fs.statSync(docs).isDirectory()) {
        const slugs = fs.readdirSync(docs, { withFileTypes: true });
        for (const s of slugs) {
          if (!s.isDirectory()) continue;
          if (fs.existsSync(path.join(docs, s.name, "APPROVED"))) return true;
        }
      }
    } catch { /* ignore */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

function looksLikeCodingTask(prompt) {
  // Short prompts (< 15 chars) → probably navigation/confirmation, pass through
  if (prompt.trim().length < 15) return false;
  // Question form → pass through (research / info, not action)
  if (QUESTION_RE.test(prompt.trimStart())) return false;
  // Has a coding verb → candidate
  if (!CODING_VERB_RE.test(prompt)) return false;
  return true;
}

function main() {
  const input = readStdinSync();
  const prompt = extractPrompt(input);
  if (!prompt) process.exit(0);

  if (isBypassed(prompt)) {
    // User explicitly overriding — respect it, pass through silently
    process.exit(0);
  }

  if (!looksLikeCodingTask(prompt)) {
    process.exit(0);
  }

  if (hasApprovedMarker(process.cwd())) {
    // Plan already approved — no need to nag
    process.exit(0);
  }

  // Coding task, no approved plan — inject reminder via additionalContext
  const reminder =
    "[plan-first-prompt] This prompt looks like a coding task, but there's no " +
    "`docs/<slug>/APPROVED` marker in scope. Before writing or editing any source code:\n\n" +
    "  1. Run `/ezra:advisor` to surface relevant governance rules and best practices\n" +
    "  2. Run `/spec` to produce `requirements.md + design.md + tasks.md` under `docs/<slug>/`\n" +
    "  3. Hand back to the user for review; they'll drop the `APPROVED` marker when ready\n" +
    "  4. Only then start coding (the plan-gate hook enforces this regardless)\n\n" +
    "If this task is genuinely trivial (typo, one-liner, doc tweak), prefix the prompt with `!` " +
    "or edit only inside `docs/**` / `.claude/**` to bypass this check.\n";

  process.stdout.write(JSON.stringify({ additionalContext: reminder }) + "\n");
  process.exit(0);
}

try { main(); } catch (err) {
  process.exit(0);
}
