# restore-baseline.ps1 — Layer 4 recovery for drift-protection.
#
# Usage:
#   pwsh restore-baseline.ps1                       # show diff vs latest baseline
#   pwsh restore-baseline.ps1 -Diff                 # same as above
#   pwsh restore-baseline.ps1 -BaselineId blessed-2026-04-28 -Diff
#   pwsh restore-baseline.ps1 -Apply                # interactive restore (PROMPTS for each file)
#   pwsh restore-baseline.ps1 -Apply -Force         # restore all without prompts (DANGEROUS — use only after manual review)
#
# Restore source: $HOME\.claude\baselines\<id>\<reldata>
# (baseline manifests record hashes only; this script falls back to git for content recovery)
#
# Always BACKS UP current state to baselines/_pre-restore-<ts>/ before any write.

[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$BaselineId,
  [switch]$Diff,
  [switch]$Apply,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$claudeRoot = Join-Path $env:USERPROFILE ".claude"
$baselinesRoot = Join-Path $claudeRoot "baselines"

if (-not (Test-Path $baselinesRoot)) {
  Write-Error "No baselines/ directory at $baselinesRoot. Run baseline snapshot first."
  exit 1
}

# Pick baseline
if (-not $BaselineId) {
  $candidates = @(Get-ChildItem $baselinesRoot -Directory | Where-Object { $_.Name -like "blessed-*" } | Sort-Object Name -Descending)
  if ($candidates.Count -eq 0) { Write-Error "No blessed-* baseline found in $baselinesRoot."; exit 1 }
  $BaselineId = $candidates[0].Name
}
$baselineDir = Join-Path $baselinesRoot $BaselineId
$manifestPath = Join-Path $baselineDir "manifest.json"

if (-not (Test-Path $manifestPath)) { Write-Error "manifest.json missing in $baselineDir"; exit 1 }

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Output "[restore] using baseline: $BaselineId (created $($manifest.created))"
Write-Output "[restore] reason: $($manifest.reason)"

# Compute current hashes for protected files
function Get-Sha256 {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
}

$drift = @{ modified = @(); removed = @(); added = @() }
foreach ($prop in $manifest.hashes.PSObject.Properties) {
  $rel = $prop.Name
  $expected = $prop.Value
  $abs = Join-Path $claudeRoot $rel
  if (-not (Test-Path $abs)) {
    $drift.removed += $rel
    continue
  }
  $actual = Get-Sha256 -Path $abs
  if ($actual -ne $expected) { $drift.modified += $rel }
}

$totalDrift = $drift.modified.Count + $drift.removed.Count + $drift.added.Count

Write-Output ""
Write-Output "[restore] DRIFT SUMMARY vs $BaselineId"
Write-Output "  modified: $($drift.modified.Count)"
foreach ($f in $drift.modified) { Write-Output "    M  $f" }
Write-Output "  removed: $($drift.removed.Count)"
foreach ($f in $drift.removed) { Write-Output "    -  $f" }
if ($totalDrift -eq 0) { Write-Output "  [no drift — system matches baseline]" }

if ($Diff -or (-not $Apply)) {
  Write-Output ""
  Write-Output "[restore] diff-only mode (use -Apply to inspect drift; content recovery is manual). Exiting."
  exit 0
}

# QAL-001 — current Apply path does NOT restore content; manifest stores hashes only.
# This warning prevents misleading users during incident response.
Write-Warning "[restore] -Apply does NOT restore file content in this version."
Write-Warning "  The manifest captures SHA-256 hashes, not file bodies."
Write-Warning "  For content recovery use git history OR ~/.claude/*.bak.* files."
Write-Warning "  This script will: (1) compute drift, (2) backup current modified+removed files,"
Write-Warning "                    (3) emit drift-report.json, (4) print recovery commands. Nothing else."

if ($totalDrift -eq 0) { exit 0 }

# Pre-restore backup of current state
$preRestoreDir = Join-Path $baselinesRoot ("_pre-restore-" + (Get-Date -Format "yyyy-MM-ddTHH-mm-ss"))
New-Item -ItemType Directory -Path $preRestoreDir -Force | Out-Null
foreach ($rel in ($drift.modified + $drift.removed)) {
  $abs = Join-Path $claudeRoot $rel
  if (Test-Path $abs) {
    $dest = Join-Path $preRestoreDir $rel
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
    Copy-Item $abs $dest -Force
  }
}
Write-Output "[restore] pre-restore backup: $preRestoreDir"

# Note: this script logs intent only. Actual content restoration requires git history
# or a content-baseline (currently the manifest stores hashes, not content). To recover
# specific files, use:
#   cd ~/.claude && git log --all --oneline -- <relpath>
#   cd ~/.claude && git checkout <sha> -- <relpath>
# OR, restore from the most recent ~/.claude/settings.json.bak.* file for settings.

Write-Output ""
Write-Output "[restore] manifest stores hashes only — content recovery requires git or .bak files."
Write-Output "[restore] for each modified/removed file, use one of:"
Write-Output "    cd ~/.claude && git log --all --oneline -- <relpath>"
Write-Output "    cd ~/.claude && git checkout <sha> -- <relpath>"
Write-Output "[restore] for settings.json: pick the latest matching .bak.*-pre-* file under ~/.claude/"
Write-Output ""
Write-Output "[restore] drift report saved to: $preRestoreDir\drift-report.json"
@{
  baseline = $BaselineId
  ts = (Get-Date).ToString("o")
  modified = $drift.modified
  removed = $drift.removed
  added = $drift.added
} | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $preRestoreDir "drift-report.json") -Encoding UTF8

exit 0
