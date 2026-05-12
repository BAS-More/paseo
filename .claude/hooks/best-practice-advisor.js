#!/usr/bin/env node
/**
 * best-practice-advisor
 *
 * Event: UserPromptSubmit
 *
 * Loads stack-specific best-practice rules from ~/.claude/rules/ and injects
 * the ones relevant to the current prompt + project context as additionalContext.
 *
 * Matching strategy (per rule file, highest-weighted signal wins):
 *   • prompt keyword match   (weight 2)
 *   • project marker files   (weight 3)  — package.json, pyproject.toml, next.config.*, etc.
 *   • cwd file extensions    (weight 1)  — scan up to 40 files in cwd, count extensions
 *   • path segments          (weight 1)  — app/, components/, pages/
 *
 * Top 1-2 rules with score >= 2 are injected. Output capped at ~4000 chars total.
 *
 * Philosophy:
 *   - Fast: no subprocess, bounded fs scan, completes in <50ms typical
 *   - Quiet: only fires when it has something useful to say
 *   - Non-blocking: always exits 0
 *   - Bypassable: prompts starting with !, #, /, raw:, skip: pass through
 *
 * Output contract:
 *   Exit 0 with JSON {"additionalContext": "..."} to inject rules
 *   Exit 0 with empty stdout to pass through
 *   Fail-open on errors
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const RULES_DIR = path.join(os.homedir(), ".claude", "rules");
const INDEX_FILE = path.join(RULES_DIR, "_index.json");

const BYPASS_PREFIXES = ["!", "#", "/", "raw:", "skip:"];
const MIN_PROMPT_LEN = 12;          // shorter = probably nav/confirm, skip
const MAX_CWD_SCAN = 40;            // cap cwd scan to stay fast
const MIN_SCORE = 2;                // rule must score >= this to inject
const MAX_RULES_INJECTED = 2;       // cap stack-specific rules per prompt
const MAX_TOTAL_CHARS = 4000;       // cap total injected content
const MAX_RULE_FILE_BYTES = 65536;  // per-rule .md size cap (QAL-001)

const WEIGHT = { keyword: 2, extension: 1, projectFile: 3, path: 1 };

// Rule filename whitelist — prevents path traversal even if _index.json is tampered.
// Only letters, digits, hyphens, underscores, one dot, and .md extension.
const SAFE_RULE_NAME = /^[a-zA-Z0-9_-]+\.md$/;

// SEC-003: defense-in-depth against a compromised rule .md injecting system-level
// prompts into Claude's context. Lines matching these patterns are commented out
// before injection. Each pattern is a raw substring check (no regex backtracking).
const INJECTION_MARKERS = [
  "<!-- system:",
  "<!--system:",
  "[INST]",
  "[/INST]",
  "<|system|>",
  "<|im_start|>",
  "<|im_end|>",
  "### System",
  "### Instruction",
  "ignore previous instructions",
  "ignore all previous",
  "disregard the above",
  "disregard all previous",
  "you are now",
  "new instructions:",
  "system prompt:",
  "admin override",
  "developer mode"
];

function logDiag(msg) {
  // Fail-open stderr diagnostic — visible in `claude --debug` but not returned as hook output.
  try { process.stderr.write(`[best-practice-advisor] ${msg}\n`); } catch { /* ignore */ }
}

function readStdinSync() {
  try { return fs.readFileSync(0, "utf8"); } catch (e) { logDiag(`stdin: ${e.message}`); return ""; }
}

function extractPrompt(input) {
  try {
    const p = JSON.parse(input || "{}");
    return (p.prompt || p.user_prompt || p.content || "").toString();
  } catch (e) { logDiag(`prompt parse: ${e.message}`); return ""; }
}

function isBypassed(prompt) {
  const trimmed = prompt.trimStart();
  return BYPASS_PREFIXES.some(p => trimmed.startsWith(p));
}

// QAL-002: allowed keys on every rule object — anything else is rejected.
const ALLOWED_RULE_KEYS = new Set(["file", "label", "keywords", "extensions", "files", "paths"]);
const STRING_ARRAY_KEYS = new Set(["keywords", "extensions", "files", "paths"]);

function isStringArray(v) {
  return Array.isArray(v) && v.every(s => typeof s === "string");
}

function validateRule(r, idx) {
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    logDiag(`rule[${idx}]: not a plain object`); return null;
  }
  // Reject unknown keys (catches proto pollution vectors + typos).
  for (const k of Object.keys(r)) {
    if (!ALLOWED_RULE_KEYS.has(k)) {
      logDiag(`rule[${idx}]: unknown key '${k}' rejected`);
      return null;
    }
  }
  if (typeof r.file !== "string" || !SAFE_RULE_NAME.test(r.file)) {
    logDiag(`rule[${idx}]: invalid 'file' field`); return null;
  }
  if (typeof r.label !== "string" || r.label.length > 80) {
    logDiag(`rule[${idx}]: invalid 'label' field`); return null;
  }
  for (const k of STRING_ARRAY_KEYS) {
    if (r[k] !== undefined && !isStringArray(r[k])) {
      logDiag(`rule[${idx}]: field '${k}' must be string[]`); return null;
    }
  }
  // Return a clean object built only from validated keys — blocks prototype pollution.
  const clean = Object.create(null);
  clean.file = r.file;
  clean.label = r.label;
  clean.keywords = r.keywords || [];
  clean.extensions = r.extensions || [];
  clean.files = r.files || [];
  clean.paths = r.paths || [];
  return clean;
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return null;
    const stat = fs.statSync(INDEX_FILE);
    if (stat.size > MAX_RULE_FILE_BYTES) {
      logDiag(`index oversized: ${stat.size}B > ${MAX_RULE_FILE_BYTES}B`);
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    if (!parsed || !Array.isArray(parsed.rules)) {
      logDiag("index: missing or non-array 'rules'"); return null;
    }
    const validated = [];
    for (let i = 0; i < parsed.rules.length; i++) {
      const clean = validateRule(parsed.rules[i], i);
      if (clean) validated.push(clean);
    }
    return { rules: validated };
  } catch (e) { logDiag(`loadIndex: ${e.message}`); return null; }
}

function scanCwd(cwd) {
  // Returns { extensions: Set<string>, files: Set<string> } for cwd root-level only.
  const out = { extensions: new Set(), files: new Set() };
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    let seen = 0;
    for (const e of entries) {
      if (seen >= MAX_CWD_SCAN) break;
      if (e.name.startsWith(".") && e.name !== ".python-version") continue;
      if (e.isFile()) {
        out.files.add(e.name.toLowerCase());
        const dot = e.name.lastIndexOf(".");
        if (dot > 0) out.extensions.add(e.name.slice(dot).toLowerCase());
        seen++;
      } else if (e.isDirectory()) {
        // Also note well-known directory names (for React paths, etc.)
        out.files.add(e.name.toLowerCase() + "/");
      }
    }
  } catch { /* ignore */ }
  return out;
}

// SEC-002: tokenize once, Set.has() per keyword. Eliminates per-keyword RegExp
// construction and removes ReDoS surface. Multi-word keywords fall back to a
// bounded substring check (no regex).
function tokenize(prompt) {
  // Split on any non-word run, lowercase, drop empties. O(n).
  const tokens = prompt.toLowerCase().split(/\W+/).filter(Boolean);
  return new Set(tokens);
}

function scoreRule(rule, promptTokens, promptLower, cwdScan) {
  let score = 0;
  const reasons = [];

  // Keyword matches in prompt (O(1) per single-word keyword, O(n) substring per multi-word)
  for (const kw of rule.keywords || []) {
    if (typeof kw !== "string" || !kw) continue;
    const kwLower = kw.toLowerCase();
    let hit = false;
    if (/\s/.test(kwLower)) {
      // Multi-word phrase: bounded substring check (no regex, no backtracking).
      if (promptLower.includes(kwLower)) hit = true;
    } else {
      // Single word: O(1) Set lookup.
      if (promptTokens.has(kwLower)) hit = true;
    }
    if (hit) {
      score += WEIGHT.keyword;
      reasons.push(`kw:${kw}`);
      break;
    }
  }

  // Project marker files (strongest signal)
  for (const f of rule.files || []) {
    if (cwdScan.files.has(f.toLowerCase())) {
      score += WEIGHT.projectFile;
      reasons.push(`file:${f}`);
      break;
    }
  }

  // File extensions in cwd
  for (const ext of rule.extensions || []) {
    if (cwdScan.extensions.has(ext.toLowerCase())) {
      score += WEIGHT.extension;
      reasons.push(`ext:${ext}`);
      break;
    }
  }

  // Path segments (React-style)
  for (const p of rule.paths || []) {
    if (cwdScan.files.has(p.toLowerCase())) {
      score += WEIGHT.path;
      reasons.push(`path:${p}`);
      break;
    }
  }

  return { score, reasons };
}

function loadRuleBody(ruleFile) {
  try {
    // SEC-001: whitelist filename format — no separators, no traversal.
    if (typeof ruleFile !== "string" || !SAFE_RULE_NAME.test(ruleFile)) {
      logDiag(`rejected rule name: ${JSON.stringify(ruleFile)}`);
      return "";
    }
    const filePath = path.join(RULES_DIR, ruleFile);
    // Belt-and-braces: confirm resolved path stays inside RULES_DIR.
    const resolved = path.resolve(filePath);
    const rulesRoot = path.resolve(RULES_DIR) + path.sep;
    if (!resolved.startsWith(rulesRoot)) {
      logDiag(`traversal attempt: ${resolved}`);
      return "";
    }
    // QAL-001: size-cap before read so a giant .md can't exhaust memory.
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_RULE_FILE_BYTES) {
      logDiag(`rule oversized: ${ruleFile} ${stat.size}B > ${MAX_RULE_FILE_BYTES}B`);
      return "";
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return sanitizeRuleContent(raw, ruleFile);
  } catch (e) { logDiag(`loadRuleBody ${ruleFile}: ${e.message}`); return ""; }
}

// SEC-003: neutralize injection markers by prefixing suspicious lines with a
// comment marker + warning. Keeps the rule text visible for audit but defuses
// any attempt to hijack Claude's instructions via tampered rule files.
function sanitizeRuleContent(raw, ruleFile) {
  let flagged = 0;
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    for (const marker of INJECTION_MARKERS) {
      if (lower.includes(marker.toLowerCase())) {
        lines[i] = `[INJECTION-FILTERED] ${lines[i]}`;
        flagged++;
        break;
      }
    }
  }
  if (flagged > 0) logDiag(`sanitized ${flagged} suspicious line(s) in ${ruleFile}`);
  return lines.join("\n");
}

function buildContext(matched) {
  if (matched.length === 0) return "";

  const header = `[best-practice-advisor] Relevant rule${matched.length > 1 ? "s" : ""} detected (score ≥ ${MIN_SCORE}): ${matched.map(m => `${m.label} (${m.score})`).join(", ")}\n\n`;
  let body = header;
  let budget = MAX_TOTAL_CHARS - header.length;

  for (const m of matched) {
    const ruleText = loadRuleBody(m.file);
    if (!ruleText) continue;
    const separator = `\n---\n`;
    const footer = `\n`;

    let chunk = ruleText;
    // If this single chunk exceeds budget, truncate with a marker
    const available = budget - separator.length - footer.length;
    if (chunk.length > available) {
      chunk = chunk.slice(0, Math.max(0, available - 30)) + "\n... [rule truncated] ...";
    }
    const piece = separator + chunk + footer;
    if (piece.length > budget) break;
    body += piece;
    budget -= piece.length;
  }

  return body;
}

function main() {
  const input = readStdinSync();
  const prompt = extractPrompt(input);
  if (!prompt || prompt.length < MIN_PROMPT_LEN) process.exit(0);
  if (isBypassed(prompt)) process.exit(0);

  const index = loadIndex();
  if (!index || !Array.isArray(index.rules)) process.exit(0);

  const cwdScan = scanCwd(process.cwd());
  const promptLower = prompt.toLowerCase();
  const promptTokens = tokenize(prompt);

  const scored = index.rules
    .map(r => {
      // QAL-004: destructure explicitly so scoreRule output can't shadow index keys.
      const { score, reasons } = scoreRule(r, promptTokens, promptLower, cwdScan);
      return { file: r.file, label: r.label, score, reasons };
    })
    .filter(r => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RULES_INJECTED);

  if (scored.length === 0) process.exit(0);

  const context = buildContext(scored);
  if (!context) process.exit(0);

  process.stdout.write(JSON.stringify({ additionalContext: context }) + "\n");
  process.exit(0);
}

try { main(); } catch { process.exit(0); }
