#!/usr/bin/env node
// Workaround for https://github.com/npm/cli/issues/4460
//
// npm silently omits `resolved` and `integrity` fields from some
// package-lock.json entries in workspace monorepos (especially for
// workspace-hoisted packages). npm acknowledged this as a bug in 2022
// but has never shipped a fix.
//
// This is harmless for regular `npm ci`, but breaks offline installers
// like Nix that need every entry to have a resolved URL + integrity hash
// so they can pre-fetch all tarballs in a sandbox with no network access.
//
// This script finds incomplete entries and fills them in by querying the
// npm registry directly (concurrent HTTP, much faster than `npm view`).
// It's idempotent — running it on an already-complete lockfile is a no-op.
//
// See also: https://github.com/npm/cli/issues/4263
//           https://github.com/npm/cli/issues/6301
//
// Usage:
//   node scripts/fix-lockfile.mjs
//   node scripts/fix-lockfile.mjs path/to/package-lock.json

import fs from "fs";

const CONCURRENCY = 30;
const REGISTRY = "https://registry.npmjs.org";

const lockPath = process.argv[2] || "package-lock.json";
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

const workspaceRoots = new Set();
for (const [key, val] of Object.entries(lock.packages || {})) {
  if (val.link) {
    workspaceRoots.add(val.resolved || key);
  }
}

const toFix = [];
for (const [key, val] of Object.entries(lock.packages || {})) {
  if (
    !key ||
    val.link ||
    (val.resolved && val.integrity) ||
    !val.version ||
    workspaceRoots.has(key)
  )
    continue;
  const pkgName = val.name || key.replace(/.*node_modules\//, "");
  toFix.push({ key, val, pkgName, version: val.version });
}

if (toFix.length === 0) {
  console.log("Lockfile is already complete");
  process.exit(0);
}

console.log(`Fixing ${toFix.length} lockfile entries...`);

const versionCache = new Map();
let fixed = 0;
let errors = 0;

async function fetchDist(pkgName, version) {
  const cacheKey = `${pkgName}@${version}`;
  if (versionCache.has(cacheKey)) return versionCache.get(cacheKey);

  const url = `${REGISTRY}/${pkgName}/${version}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      versionCache.set(cacheKey, null);
      return null;
    }
    const data = await res.json();
    const dist = data.dist || null;
    versionCache.set(cacheKey, dist);
    return dist;
  } catch {
    versionCache.set(cacheKey, null);
    return null;
  }
}

async function processBatch(batch) {
  await Promise.all(
    batch.map(async ({ val, pkgName, version }) => {
      const dist = await fetchDist(pkgName, version);
      if (dist && dist.tarball && dist.integrity) {
        val.resolved = dist.tarball;
        val.integrity = dist.integrity;
        fixed++;
      } else {
        errors++;
        console.error(`Warning: could not fetch info for ${pkgName}@${version}`);
      }
    }),
  );
}

for (let i = 0; i < toFix.length; i += CONCURRENCY) {
  const batch = toFix.slice(i, i + CONCURRENCY);
  await processBatch(batch);
  if ((i + CONCURRENCY) % 300 === 0 || i + CONCURRENCY >= toFix.length) {
    console.log(`  ${Math.min(i + CONCURRENCY, toFix.length)}/${toFix.length} done`);
  }
}

fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");

console.log(`Fixed ${fixed} lockfile entries${errors > 0 ? ` (${errors} errors)` : ""}`);
