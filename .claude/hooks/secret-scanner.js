#!/usr/bin/env node
/**
 * secret-scanner
 *
 * Event: UserPromptSubmit
 *
 * Hard-blocks a prompt if gitleaks finds a secret in it. Uses gitleaks'
 * built-in ruleset (150+ providers) extended by secret-scanner.toml with
 * patterns gitleaks misses (Cloudflare cfut_, Supabase sbp_, Turso tl_).
 *
 * Bypass prefixes (matches best-practice-advisor convention):
 *   !  #  /  raw:  skip:
 *
 * Fail-open — errors during scan let the prompt through. Better to miss one
 * than to deadlock the user if gitleaks hiccups.
 */

const fs         = require("node:fs");
const os         = require("node:os");
const path       = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const HOOKS_DIR  = path.dirname(__filename);
const CONFIG     = path.join(HOOKS_DIR, "secret-scanner.toml");
const GITLEAKS   = process.env.GITLEAKS_BIN || "gitleaks";

const BYPASS_PREFIXES = ["!", "#", "/", "raw:", "skip:"];

function isBypassed(prompt) {
    const trimmed = prompt.trimStart();
    return BYPASS_PREFIXES.some(p => trimmed.startsWith(p));
}

function scanWithGitleaks(prompt) {
    const tmp = path.join(os.tmpdir(), `tr-prompt-${randomUUID()}.txt`);
    const report = path.join(os.tmpdir(), `tr-report-${randomUUID()}.json`);

    try {
        fs.writeFileSync(tmp, prompt, "utf8");
        const args = [
            "detect",
            "--no-git",
            `--source=${tmp}`,
            `--report-format=json`,
            `--report-path=${report}`,
            "--exit-code=0",
            "--no-banner",
            "--log-level=error",
        ];
        if (fs.existsSync(CONFIG)) args.push(`--config=${CONFIG}`);

        const res = spawnSync(GITLEAKS, args, {
            encoding: "utf8",
            timeout: 2500,
        });

        if (res.error) return { ok: false, reason: res.error.message, hits: [] };

        let hits = [];
        if (fs.existsSync(report)) {
            try {
                const raw = fs.readFileSync(report, "utf8");
                hits = JSON.parse(raw) || [];
            } catch (_e) { /* fail-open */ }
        }
        return { ok: true, hits };
    } finally {
        try { fs.unlinkSync(tmp); } catch {}
        try { fs.unlinkSync(report); } catch {}
    }
}

function maskSecret(s) {
    if (!s || s.length < 10) return "***";
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

async function main() {
    let raw = "";
    try {
        for await (const chunk of process.stdin) raw += chunk;
    } catch {
        process.exit(0);
    }

    let input;
    try { input = JSON.parse(raw); } catch { process.exit(0); }

    const prompt = input.prompt || input.user_message || "";
    if (!prompt || typeof prompt !== "string") process.exit(0);

    if (isBypassed(prompt)) process.exit(0);

    const { ok, hits } = scanWithGitleaks(prompt);
    if (!ok || hits.length === 0) process.exit(0);

    // Group hits by rule ID for readable output
    const groups = new Map();
    for (const h of hits) {
        const key = h.RuleID || h.Rule || "unknown";
        const arr = groups.get(key) || [];
        arr.push(h);
        groups.set(key, arr);
    }

    const lines = [
        "🛑 secret-scanner BLOCKED this prompt (via gitleaks).",
        "",
        `Detected ${hits.length} secret${hits.length > 1 ? "s" : ""}:`,
    ];
    for (const [ruleId, arr] of groups) {
        const desc = arr[0].Description || ruleId;
        lines.push(`  • ${desc}  [${ruleId}] × ${arr.length}`);
        for (const h of arr.slice(0, 3)) {
            const masked = maskSecret(h.Secret || h.Match || "");
            lines.push(`      ${masked}`);
        }
    }
    lines.push(
        "",
        "Your prompt was NOT sent to Claude. The secret never entered the transcript.",
        "",
        "To proceed:",
        "  1. ROTATE the leaked secret immediately (the provider's dashboard).",
        "  2. Re-submit with the secret replaced by <REDACTED>.",
        "  3. To bypass this check for one prompt, prefix with 'skip:' (NOT recommended).",
    );

    process.stderr.write(lines.join("\n") + "\n");
    process.exit(2);
}

main();
