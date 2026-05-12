#!/usr/bin/env node
/**
 * Filter `npm audit --json` output against a hand-maintained allowlist of
 * advisories that have been verified safe in our lockfile.
 *
 * Usage:
 *   npm audit --omit=dev --json | node scripts/audit-allowlist.mjs
 *
 * Exits 1 only if a high or critical finding remains AFTER the allowlist is
 * applied. Lower severities are reported but do not fail.
 *
 * Each allowlist entry MUST include:
 *   - ghsa     : the advisory ID
 *   - package  : the root package the GHSA targets (used to suppress every
 *                transitive dependent in the same `via` chain)
 *   - reason   : one-line justification visible in CI logs
 *   - expires  : ISO date string. Past expiry → entry is ignored (re-fails).
 *   - link     : URL for an operator to verify the status
 *
 * Remove an entry once the upstream is fixed or the advisory is retracted.
 */

const ALLOWLIST = [
  {
    ghsa: "GHSA-rmmr-r34h-pfm5",
    package: "@tanstack/history",
    reason:
      "Attacker published @tanstack/history 1.161.9 + 1.161.12 on 2026-05-11; npm has unpublished both. Our lockfile pins 1.161.6 (2026-03-15) which is pre-attack and legitimate. GitHub Advisory flags all versions defensively. TanStack/router#7384 tracks upstream response.",
    expires: "2026-06-15T00:00:00Z",
    link: "https://github.com/advisories/GHSA-rmmr-r34h-pfm5",
  },
  {
    ghsa: "GHSA-3q49-cfcf-g5fm",
    package: "@mistralai/mistralai",
    reason:
      "Attacker published @mistralai/mistralai 2.2.2 + 2.2.3 + 2.2.4 on 2026-05-11; npm has unpublished all three. Our lockfile pins 2.2.1 (2026-04-21) which is pre-attack and legitimate. GitHub Advisory flags all versions defensively.",
    expires: "2026-06-15T00:00:00Z",
    link: "https://github.com/advisories/GHSA-3q49-cfcf-g5fm",
  },
];

const FAILING = new Set(["high", "critical"]);

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

function extractGhsaFromVia(via) {
  const ids = new Set();
  if (!Array.isArray(via)) return ids;
  for (const v of via) {
    if (typeof v === "string") continue;
    if (v && typeof v === "object" && typeof v.url === "string") {
      const m = v.url.match(/GHSA-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/i);
      if (m) ids.add(m[0]);
    }
  }
  return ids;
}

/**
 * Resolve the root advisory(ies) responsible for a vulnerability by walking
 * the `via` chain. `via` entries may be either:
 *   - objects with .url (a direct advisory) → its GHSA is the root
 *   - strings (the name of a parent package) → recurse into that package
 */
function resolveRootGhsas(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const ids = new Set();
  const vuln = vulnerabilities[name];
  if (!vuln) return ids;
  for (const id of extractGhsaFromVia(vuln.via)) ids.add(id);
  if (Array.isArray(vuln.via)) {
    for (const v of vuln.via) {
      if (typeof v === "string") {
        for (const id of resolveRootGhsas(v, vulnerabilities, seen)) ids.add(id);
      }
    }
  }
  return ids;
}

function main(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`audit-allowlist: failed to parse npm audit JSON: ${err.message}`);
    process.exit(2);
  }

  const now = Date.now();
  const activeByGhsa = new Map();
  const expired = [];
  for (const entry of ALLOWLIST) {
    if (Date.parse(entry.expires) < now) {
      expired.push(entry);
      continue;
    }
    activeByGhsa.set(entry.ghsa, entry);
  }
  if (expired.length > 0) {
    console.error("audit-allowlist: EXPIRED allowlist entries (now failing again):");
    for (const e of expired) {
      console.error(`  - ${e.ghsa} (${e.package}): expired ${e.expires} — ${e.reason}`);
    }
  }

  const vulns = parsed.vulnerabilities ?? {};
  const failures = [];
  const allowed = [];
  const informational = [];

  for (const [name, vuln] of Object.entries(vulns)) {
    const severity = typeof vuln.severity === "string" ? vuln.severity : "info";
    const rootGhsas = resolveRootGhsas(name, vulns);
    const matched = [...rootGhsas].find((id) => activeByGhsa.has(id));

    const title = Array.isArray(vuln.via)
      ? vuln.via
          .map((v) => (typeof v === "object" && v && typeof v.title === "string" ? v.title : ""))
          .filter(Boolean)[0] ?? ""
      : "";

    const summary = { package: name, severity, title, rootGhsas: [...rootGhsas] };

    if (matched) {
      allowed.push({ ...summary, allowedBy: activeByGhsa.get(matched) });
      continue;
    }
    if (FAILING.has(severity)) {
      failures.push(summary);
    } else {
      informational.push(summary);
    }
  }

  if (allowed.length > 0) {
    console.error(`audit-allowlist: ${allowed.length} finding(s) suppressed by allowlist:`);
    const byEntry = new Map();
    for (const item of allowed) {
      const key = item.allowedBy.ghsa;
      if (!byEntry.has(key)) byEntry.set(key, { entry: item.allowedBy, pkgs: [] });
      byEntry.get(key).pkgs.push(item.package);
    }
    for (const { entry, pkgs } of byEntry.values()) {
      console.error(`  - ${entry.ghsa} (${entry.package}): ${pkgs.length} pkg(s)`);
      console.error(`    reason: ${entry.reason}`);
    }
  }

  if (informational.length > 0) {
    console.error(`audit-allowlist: ${informational.length} non-failing finding(s):`);
    for (const item of informational) {
      console.error(`  - ${item.package} (${item.severity}) ${item.title}`);
    }
  }

  if (failures.length > 0) {
    console.error(`audit-allowlist: ${failures.length} high/critical finding(s) NOT in allowlist:`);
    for (const item of failures) {
      console.error(
        `  - ${item.package} (${item.severity}) ${item.title} [${item.rootGhsas.join(", ") || "no GHSA"}]`,
      );
    }
    process.exit(1);
  }

  console.error("audit-allowlist: OK — no unsuppressed high/critical findings.");
}

readStdin()
  .then(main)
  .catch((err) => {
    console.error(`audit-allowlist: ${err.message}`);
    process.exit(2);
  });
