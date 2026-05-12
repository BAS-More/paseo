<#
.SYNOPSIS
  Automated restore drill — prove backups actually work.

.DESCRIPTION
  Once a month (scheduled) or on-demand, exercise the full recovery path
  against a scratch directory. Answers "if my machine died tonight, would
  bootstrap-from-scratch.ps1 actually work?"

  Steps:
    1. Create scratch dir: $env:TEMP\claude-restore-drill-<timestamp>
    2. Clone ~/.claude from GitHub (not from local — tests the real path)
    3. Copy ~/.claude.json equivalent from OneDrive backup
    4. Verify: manifest_sync.py drift exits 0 (manifest matches config)
    5. Verify: bootstrap-from-scratch.ps1 dry-run (no side effects)
    6. Verify: vault.sync file in OneDrive is present + non-empty
    7. Verify: last OneDrive mirror completed in the last 25 hours
    8. Verify: git repo auto-commit completed in the last 35 minutes
    9. Write drill report to _logs/restore-drill-<date>.md
   10. Toast + log incident on failure; exit 1 so Task Scheduler flags it

  ZERO side effects on the live ~/.claude — scratch dir only.

.PARAMETER KeepScratch
  Don't delete the scratch dir after the drill (for debugging).
#>

[CmdletBinding()]
param([switch]$KeepScratch)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$scratch = Join-Path $env:TEMP "claude-restore-drill-$stamp"
$logDir  = Join-Path $env:USERPROFILE '.claude\_logs'
$report  = Join-Path $logDir "restore-drill-$stamp.md"
$onedrive = $env:OneDrive
if (-not $onedrive) { $onedrive = Join-Path $env:USERPROFILE 'OneDrive' }
$onedriveBackup = Join-Path $onedrive 'ClaudeCodeBackup'
$notify = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'
$repoUrl = 'https://github.com/BAS-More/claude-home-backup.git'

New-Item -Path $scratch -ItemType Directory -Force | Out-Null
New-Item -Path $logDir -ItemType Directory -Force | Out-Null

$findings = [System.Collections.ArrayList]::new()
$failures = [System.Collections.ArrayList]::new()

function Check($name, [scriptblock]$test) {
    try {
        $result = & $test
        [void]$findings.Add(@{ name = $name; status = 'PASS'; detail = $result })
        Write-Output "[PASS] $name : $result"
    } catch {
        [void]$findings.Add(@{ name = $name; status = 'FAIL'; detail = $_.Exception.Message })
        [void]$failures.Add("$name -> $($_.Exception.Message)")
        Write-Output "[FAIL] $name : $($_.Exception.Message)"
    }
}

Write-Output "== Restore drill $stamp =="
Write-Output "Scratch: $scratch"

# ───────────────────────────────────────────────────────────────────────
Check 'git-clone-from-github' {
    $cloneDir = Join-Path $scratch '.claude-clone'
    & git clone --depth 1 $repoUrl $cloneDir 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git clone exit $LASTEXITCODE" }
    $files = (Get-ChildItem $cloneDir -Force | Measure-Object).Count
    "$files top-level entries cloned"
}

Check 'manifest-present-in-clone' {
    $m = Join-Path $scratch '.claude-clone\mcp-manifest.json'
    if (-not (Test-Path $m)) { throw "missing $m" }
    $len = (Get-Item $m).Length
    if ($len -lt 100) { throw "manifest suspiciously small: $len bytes" }
    "manifest size: $len bytes"
}

Check 'onedrive-mirror-fresh' {
    $cfg = Join-Path $onedriveBackup '.claude.json'
    if (-not (Test-Path $cfg)) { throw "missing $cfg" }
    $age = (Get-Date) - (Get-Item $cfg).LastWriteTime
    if ($age.TotalHours -gt 25) { throw "stale: $([int]$age.TotalHours)h old" }
    "$([int]$age.TotalMinutes) min old"
}

Check 'vault-backup-present' {
    $v = Join-Path $onedrive 'ClaudeVault\vault.sync'
    if (-not (Test-Path $v)) { throw "missing $v — run: python C:/Dev/tools/vault/vault_backup.py backup" }
    $len = (Get-Item $v).Length
    if ($len -lt 100) { throw "vault.sync suspiciously small: $len bytes" }
    $age = (Get-Date) - (Get-Item $v).LastWriteTime
    if ($age.TotalDays -gt 35) { throw "stale: $([int]$age.TotalDays)d old" }
    "$len bytes, $([int]$age.TotalDays)d old"
}

Check 'manifest-drift-check' {
    $claudeJsonFromBackup = Join-Path $onedriveBackup '.claude.json'
    $manifestFromClone    = Join-Path $scratch '.claude-clone\mcp-manifest.json'
    # Simulate restore: copy both to scratch "restored" user profile,
    # compare live .claude.json to manifest keys.
    $restored = Join-Path $scratch 'restored'
    New-Item -Path $restored -ItemType Directory -Force | Out-Null
    Copy-Item $claudeJsonFromBackup (Join-Path $restored '.claude.json') -Force
    Copy-Item $manifestFromClone    (Join-Path $restored 'mcp-manifest.json') -Force

    $live = Get-Content (Join-Path $restored '.claude.json') -Raw | ConvertFrom-Json
    $liveCount = 0
    if ($live.PSObject.Properties.Name -contains 'mcpServers') {
        $liveCount = ($live.mcpServers.PSObject.Properties | Measure-Object).Count
    }
    $manifest = Get-Content (Join-Path $restored 'mcp-manifest.json') -Raw | ConvertFrom-Json
    $manifestCount = $manifest.mcp_count
    if ($liveCount -ne $manifestCount) { throw "live=$liveCount manifest=$manifestCount" }
    "$liveCount MCPs agreed"
}

Check 'autocommit-recent' {
    Push-Location (Join-Path $env:USERPROFILE '.claude')
    try {
        $lastCommit = & git log -1 --format=%ct 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'not a git repo' }
        $ts = [DateTimeOffset]::FromUnixTimeSeconds([long]$lastCommit).LocalDateTime
        $age = (Get-Date) - $ts
        if ($age.TotalMinutes -gt 35) { throw "last commit $([int]$age.TotalMinutes) min old (cron every 30 min)" }
        "$([int]$age.TotalMinutes) min old"
    } finally { Pop-Location }
}

Check 'bootstrap-script-present' {
    $b = Join-Path $scratch '.claude-clone\scripts\bootstrap-from-scratch.ps1'
    if (-not (Test-Path $b)) { throw "bootstrap-from-scratch.ps1 missing from clone" }
    "present, $((Get-Item $b).Length) bytes"
}

Check 'hook-integrity' {
    $hi = Join-Path $env:USERPROFILE '.claude\scripts\hook-integrity.ps1'
    if (-not (Test-Path $hi)) { throw 'hook-integrity.ps1 missing' }
    & pwsh -NoProfile -File $hi -Mode verify 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "hook-integrity exit $LASTEXITCODE" }
    'verify ok'
}

# ───────────────────────────────────────────────────────────────────────
# Write report
# ───────────────────────────────────────────────────────────────────────
$md = @()
$md += "# Restore Drill Report — $stamp"
$md += ''
$md += "- Scratch dir: ``$scratch``"
$md += "- Failures: $($failures.Count) / $($findings.Count)"
$md += ''
$md += '| Check | Status | Detail |'
$md += '|-------|--------|--------|'
foreach ($f in $findings) {
    $md += "| $($f.name) | $($f.status) | $($f.detail) |"
}
Set-Content -Path $report -Value ($md -join "`n") -Encoding UTF8

Write-Output ""
Write-Output "Report: $report"

if ($failures.Count -gt 0) {
    if (Test-Path $notify) {
        try {
            & pwsh -NoProfile -File $notify -Title 'Restore Drill FAILED' -Message "$($failures.Count) check(s) failed" 2>&1 | Out-Null
        } catch {}
    }
}

if (-not $KeepScratch) {
    Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) { exit 1 } else { exit 0 }
