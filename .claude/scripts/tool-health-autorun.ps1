<#
.SYNOPSIS
  Autonomous tool-health run: sweep, auto-repair, sweep again, notify on
  anything left broken. Designed to be invoked by Windows Task Scheduler.

.DESCRIPTION
  This is the non-Claude execution path for continuous monitoring. The
  tool-health-monitor agent handles the same logic when Avi is in a live
  Claude session. This script runs headless.

  Flow:
    1. sweep  -> tool-health-status.json
    2. for each FAIL, attempt deterministic auto-repair
       (mcp-repair.ps1 for MCP issues; hook-manifest regen if drift but
        all referenced hooks still parse)
    3. sweep again
    4. if still FAIL/WARN after repair:
         - write a human-readable status.md
         - fire notify-avi (toast + incident log) at Warning|Critical
       else:
         - write status.md noting repairs applied
         - no toast (quiet success)

  Exit codes:
    0 - fully green (with or without repairs)
    1 - left with WARNs after repair
    2 - left with FAILs after repair (Critical notify fired)
#>

[CmdletBinding()]
param(
    [switch]$Quiet   # suppress console output when run by Task Scheduler
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$claudeDir  = Join-Path $env:USERPROFILE '.claude'
$scriptsDir = Join-Path $claudeDir 'scripts'
$statusJson = Join-Path $claudeDir 'tool-health-status.json'
$statusMd   = Join-Path $claudeDir 'tool-health-status.md'

function Say([string]$msg, [string]$color = 'Gray') {
    if (-not $Quiet) { Write-Host $msg -ForegroundColor $color }
}

# --- Healthchecks.io ping (no-op if URL missing) ---
function Get-HCUrl {
    param([string]$Component)
    $envKey = 'HEALTHCHECKS_' + ($Component.ToUpper() -replace '-','_') + '_URL'
    $envVal = [Environment]::GetEnvironmentVariable($envKey)
    if ($envVal) { return $envVal.Trim() }
    try {
        $vaultUrl = & python 'C:\Dev\tools\vault\vault.py' get healthchecks ("$Component-url") 2>$null
        if ($LASTEXITCODE -eq 0 -and $vaultUrl) { return $vaultUrl.Trim() }
    } catch { }
    return $null
}
function Invoke-HCPing {
    param([string]$Url, [string]$Suffix = '', [string]$Body = '')
    if (-not $Url) { return }
    $target = $Url.TrimEnd('/')
    if ($Suffix) { $target += "/$Suffix" }
    try {
        if ($Body) {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
            Invoke-WebRequest -Uri $target -Method POST -Body $bytes -ContentType 'text/plain; charset=utf-8' -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop | Out-Null
        } else {
            Invoke-WebRequest -Uri $target -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop | Out-Null
        }
    } catch { Say ("  hc ping failed (non-fatal): " + $_.Exception.Message) 'DarkGray' }
}
$hcUrl = Get-HCUrl 'tool-health'
Invoke-HCPing -Url $hcUrl -Suffix 'start'

function Invoke-Sweep {
    $sweep = Join-Path $scriptsDir 'tool-health-sweep.ps1'
    $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$sweep)
    if ($Quiet) {
        $null = & powershell @args 2>&1
    } else {
        & powershell @args 2>&1 | Out-Host
    }
    $code = $LASTEXITCODE
    $json = $null
    if (Test-Path $statusJson) {
        try { $json = Get-Content $statusJson -Raw | ConvertFrom-Json } catch { }
    }
    return @{ code = $code; json = $json }
}

function Test-AllHooksParse {
    $manifest = Join-Path $claudeDir 'hooks\.manifest.sha256'
    if (-not (Test-Path $manifest)) { return $false }
    $ok = $true
    Get-Content $manifest | ForEach-Object {
        if ($_ -match '^\S+\s+(.+)$') {
            $path = $matches[1]
            if (Test-Path $path) {
                $ext = [IO.Path]::GetExtension($path).ToLower()
                try {
                    if ($ext -in @('.js','.cjs','.mjs')) {
                        & node --check $path 2>$null
                        if ($LASTEXITCODE -ne 0) { $script:ok = $false; Say "  parse-fail: $path" 'Red' }
                    } elseif ($ext -eq '.ps1') {
                        [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
                    } elseif ($ext -eq '.py') {
                        & python -m py_compile $path 2>$null
                        if ($LASTEXITCODE -ne 0) { $script:ok = $false; Say "  parse-fail: $path" 'Red' }
                    }
                } catch {
                    $script:ok = $false
                    Say "  parse-fail: $path - $($_.Exception.Message)" 'Red'
                }
            }
        }
    }
    return $ok
}

Say ""
Say "=== Tool Health Autorun ===" 'Cyan'
Say ("Date: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ""

# ---------- pass 1 ----------
Say "Pass 1: initial sweep..." 'Cyan'
$pass1 = Invoke-Sweep
$repairsApplied = @()
$repairsFailed  = @()

if ($pass1.json -and $pass1.json.overall -ne 'GREEN') {
    Say ""
    Say "Attempting auto-repair..." 'Yellow'

    foreach ($r in $pass1.json.results) {
        if ($r.status -eq 'OK' -or $r.status -eq 'SKIP') { continue }

        switch ($r.name) {
            'mcp-health' {
                Say "  -> mcp-repair.ps1" 'Yellow'
                $repair = Join-Path $scriptsDir 'mcp-repair.ps1'
                $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $repair 2>&1 | Out-String
                if ($out -match '\[FIXED\]') {
                    $repairsApplied += "mcp-health: npm install/build restored missing artifacts"
                } else {
                    $repairsFailed += "mcp-health: repair script ran but no [FIXED] markers"
                }
            }
            'mcp-drift' {
                # drift-check failing means a referenced MCP file vanished;
                # mcp-repair can sometimes restore (npm install / rebuild).
                Say "  -> mcp-repair.ps1 (for drift)" 'Yellow'
                $repair = Join-Path $scriptsDir 'mcp-repair.ps1'
                $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $repair 2>&1 | Out-String
                if ($out -match '\[FIXED\]') {
                    $repairsApplied += "mcp-drift: restored via mcp-repair.ps1"
                } else {
                    $repairsFailed += "mcp-drift: $($r.detail) - mcp-repair did not restore"
                }
            }
            'hook-integrity' {
                Say "  -> verifying all referenced hooks still parse..." 'Yellow'
                if (Test-AllHooksParse) {
                    Say "     all hooks parse - regenerating manifest" 'Green'
                    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsDir 'hook-integrity.ps1') -Mode generate | Out-Null
                    $repairsApplied += "hook-integrity: manifest regenerated after verifying all hooks parse"
                } else {
                    $repairsFailed += "hook-integrity: one or more hooks fail to parse - DO NOT regenerate, investigate manually"
                }
            }
            default {
                $repairsFailed += "$($r.name): no auto-repair rule ($($r.detail))"
            }
        }
    }

    Say ""
    Say "Pass 2: rerunning sweep after repairs..." 'Cyan'
    $final = Invoke-Sweep
} else {
    $final = $pass1
}

# ---------- report ----------
$ts = (Get-Date).ToString('o')
$overall = if ($final.json) { $final.json.overall } else { 'UNKNOWN' }
$okN   = if ($final.json) { $final.json.summary.ok }   else { 0 }
$warnN = if ($final.json) { $final.json.summary.warn } else { 0 }
$failN = if ($final.json) { $final.json.summary.fail } else { 0 }

$mdLines = @()
$mdLines += "# Tool health - $ts"
$mdLines += ""
$mdLines += "**Overall:** $overall"
$mdLines += ""
$mdLines += "## Summary"
$mdLines += ""
$summaryLine = switch ($overall) {
    'GREEN'  { "All $okN checks passing. $(if ($repairsApplied.Count -gt 0) { "Auto-repaired $($repairsApplied.Count) issue(s) this run." } else { "No repairs needed." })" }
    'YELLOW' { "$okN OK, $warnN warning(s). Non-critical issues remain after auto-repair." }
    'RED'    { "$okN OK, $failN failure(s). Auto-repair could not resolve everything - Avi needs to act." }
    default  { "Sweep did not produce a status - check for script errors." }
}
$mdLines += $summaryLine
$mdLines += ""
$mdLines += "## Checks"
$mdLines += ""
$mdLines += "| Component | Status | Notes |"
$mdLines += "| --- | --- | --- |"
if ($final.json) {
    foreach ($r in $final.json.results) {
        $detail = $r.detail -replace '\|','/'
        $mdLines += "| $($r.name) | $($r.status) | $detail |"
    }
}
$mdLines += ""
$mdLines += "## Repairs this run"
$mdLines += ""
if ($repairsApplied.Count -eq 0 -and $repairsFailed.Count -eq 0) {
    $mdLines += "_None needed._"
} else {
    foreach ($ra in $repairsApplied) { $mdLines += "- [FIXED] $ra" }
    foreach ($rf in $repairsFailed)  { $mdLines += "- [FAILED] $rf" }
}
$mdLines += ""
$mdLines += "## Needs Avi's attention"
$mdLines += ""
if ($overall -eq 'GREEN') {
    $mdLines += "_Nothing. Everything is green._"
} else {
    if ($final.json) {
        foreach ($r in $final.json.results) {
            if ($r.status -in @('WARN','FAIL')) {
                $mdLines += "- **$($r.name)** ($($r.status)): $($r.detail)"
            }
        }
    }
}
$mdLines += ""
$mdLines -join "`r`n" | Out-File -Encoding utf8 $statusMd
Say ""
Say "Report: $statusMd" 'Cyan'

# ---------- notify (with dedup) ----------
# Fire a toast only on state change:
#   - new failure (no open incident OR fingerprint differs from last open incident)
#   - recovery (open incident exists but overall is now GREEN)
#   - daily reminder (same failure persists >= 24h since last toast)
# Otherwise suppress the toast but still update status.md (already done above).

$notifyScript   = Join-Path $scriptsDir 'notify-avi.ps1'
$incidentsPath  = Join-Path $claudeDir '_logs\tool-health-incidents.jsonl'
$reminderHours  = 24

# Build current-state fingerprint from failing/warning components + their detail
$failingSummary = ''
if ($final.json -and $overall -ne 'GREEN') {
    $parts = @()
    foreach ($r in $final.json.results) {
        if ($r.status -in @('WARN','FAIL')) {
            $parts += "$($r.name)=$($r.status):$($r.detail)"
        }
    }
    $failingSummary = ($parts | Sort-Object) -join ' || '
}
$fingerprint = if ($failingSummary) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($failingSummary)
    ([System.BitConverter]::ToString($md5.ComputeHash($bytes))).Replace('-','').ToLower()
} else { 'green' }

# Find last UNRESOLVED incident (from end of jsonl)
$lastOpenIncident = $null
if (Test-Path $incidentsPath) {
    $all = Get-Content $incidentsPath -ErrorAction SilentlyContinue
    for ($i = $all.Count - 1; $i -ge 0; $i--) {
        try {
            $rec = $all[$i] | ConvertFrom-Json
            if ($null -eq $rec.resolved_at -and $rec.component -eq 'tool-health') {
                $lastOpenIncident = @{ line_index = $i; rec = $rec }
                break
            }
        } catch { continue }
    }
}

function Update-IncidentResolution {
    param([int]$LineIndex, [string]$ResolvedAt)
    $lines = Get-Content $incidentsPath
    try {
        $rec = $lines[$LineIndex] | ConvertFrom-Json
        $rec | Add-Member -Force -NotePropertyName resolved_at -NotePropertyValue $ResolvedAt
        $lines[$LineIndex] = ($rec | ConvertTo-Json -Compress)
        $lines | Set-Content -Path $incidentsPath -Encoding UTF8
    } catch {
        Say ("  could not mark incident resolved: " + $_.Exception.Message) 'Yellow'
    }
}

$shouldToast = $false
$toastReason = ''

if ($overall -eq 'GREEN') {
    if ($lastOpenIncident) {
        # Recovery
        Update-IncidentResolution -LineIndex $lastOpenIncident.line_index -ResolvedAt (Get-Date).ToString('o')
        $shouldToast = $true
        $toastReason = 'recovery'
    }
} else {
    if (-not $lastOpenIncident) {
        # Brand-new issue
        $shouldToast = $true
        $toastReason = 'new'
    } else {
        # Compare fingerprints
        $prevFp = $lastOpenIncident.rec.PSObject.Properties['fingerprint']
        $prevFpVal = if ($prevFp) { $prevFp.Value } else { '' }
        if ($prevFpVal -ne $fingerprint) {
            # Different failure - resolve old, open new
            Update-IncidentResolution -LineIndex $lastOpenIncident.line_index -ResolvedAt (Get-Date).ToString('o')
            $shouldToast = $true
            $toastReason = 'changed'
        } else {
            # Same failure - reminder only every 24h
            $lastTs = [DateTimeOffset]::Parse($lastOpenIncident.rec.ts)
            $hoursSince = ((Get-Date) - $lastTs.LocalDateTime).TotalHours
            if ($hoursSince -ge $reminderHours) {
                $shouldToast = $true
                $toastReason = "reminder-${([int]$hoursSince)}h"
            } else {
                Say ("Same failure as last run ({0} open, {1:N1}h ago). Suppressing toast." -f $lastOpenIncident.rec.title, $hoursSince) 'DarkGray'
            }
        }
    }
}

function Invoke-Notify {
    param([string]$Title, [string]$Body, [string]$Severity)
    # Augment body with fingerprint so incident records carry it
    & powershell -NoProfile -ExecutionPolicy Bypass -File $notifyScript `
        -Title $Title -Body $Body -Severity $Severity `
        -Details $statusMd -Component 'tool-health' | Out-Host
    # Patch the just-appended incident to include fingerprint
    try {
        $lines = Get-Content $incidentsPath
        if ($lines.Count -gt 0) {
            $last = $lines[-1] | ConvertFrom-Json
            $last | Add-Member -Force -NotePropertyName fingerprint -NotePropertyValue $fingerprint
            $lines[-1] = ($last | ConvertTo-Json -Compress)
            $lines | Set-Content -Path $incidentsPath -Encoding UTF8
        }
    } catch { }
}

# Healthchecks body: first 80 lines of status.md (cap ~5KB)
$hcBody = ''
if (Test-Path $statusMd) {
    $hcBody = (Get-Content $statusMd -TotalCount 80 -ErrorAction SilentlyContinue) -join "`n"
}

if ($overall -eq 'RED') {
    Invoke-HCPing -Url $hcUrl -Suffix 'fail' -Body $hcBody
    if ($shouldToast) {
        $bodyTxt = switch ($toastReason) {
            'new'       { "$failN failure(s) after auto-repair. Open status.md." }
            'changed'   { "Failure state changed. $failN failure(s) now. Open status.md." }
            default     { "Still broken ($toastReason). $failN failure(s). Open status.md." }
        }
        Invoke-Notify -Title 'Claude tool health: RED' -Body $bodyTxt -Severity 'Critical'
    }
    exit 2
} elseif ($overall -eq 'YELLOW') {
    Invoke-HCPing -Url $hcUrl -Suffix '1' -Body $hcBody
    if ($shouldToast) {
        $bodyTxt = switch ($toastReason) {
            'new'       { "$warnN warning(s). Not urgent but worth a look." }
            'changed'   { "Warning state changed. $warnN warning(s) now." }
            default     { "Still warning ($toastReason). $warnN warning(s)." }
        }
        Invoke-Notify -Title 'Claude tool health: YELLOW' -Body $bodyTxt -Severity 'Warning'
    }
    exit 1
} else {
    Invoke-HCPing -Url $hcUrl -Body $hcBody
    if ($shouldToast -and $toastReason -eq 'recovery') {
        Invoke-Notify -Title 'Claude tool health: RECOVERED' `
            -Body ("Previous issue resolved - all {0} checks green again." -f $okN) `
            -Severity 'Info'
    } else {
        Say "All green. No notification fired." 'Green'
    }
    exit 0
}
