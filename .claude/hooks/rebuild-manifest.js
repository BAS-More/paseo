#!/usr/bin/env node
/**
 * Rebuild hooks-manifest.json from the current .js files in this directory.
 * Run after any intentional hook edit:
 *   node "$HOME/.claude/hooks/rebuild-manifest.js"
 * (or `node "$env:USERPROFILE\.claude\hooks\rebuild-manifest.js"` from PowerShell)
 *
 * The session-boot.js integrity check compares live SHA256 against this
 * manifest and emits a warning if they drift.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const dir = __dirname;
const out = path.join(dir, "hooks-manifest.json");

const hashes = {};
for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".js"))) {
  if (f === "rebuild-manifest.js") continue;  // skip self
  hashes[f] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex");
}

const manifest = {
  version: 1,
  generated: new Date().toISOString(),
  algo: "sha256",
  note: "Regenerate with `node rebuild-manifest.js` after intentional hook edits. Mismatches logged to ~/.claude/_logs/integrity-log.jsonl and surfaced at session start.",
  hashes,
};

fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${out} — ${Object.keys(hashes).length} hook files hashed.`);
