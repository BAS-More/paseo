# portability-drift-check.ps1
#
# SessionStart + watchdog wrapper around scripts/portability-codemod.py --check.
# Emits a one-line WARNING to stdout if drift detected, appends to
# _logs/portability-drift.jsonl, always exits 0 (fail-open).

[CmdletBinding()]
param(
    [switch]$Silent,
    [switch]$NotifyAvi
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ClaudeHome = "$env:USERPROFILE\.claude"
$Codemod    = Join-Path $ClaudeHome "scripts\portability-codemod.py"
# Phase 4: per-PC log suffix.
$machineTag = $env:COMPUTERNAME
if ([string]::IsNullOrEmpty($machineTag)) { $machineTag = "unknown" }
$LogPath    = Join-Path $ClaudeHome "_logs\portability-drift-$machineTag.jsonl"
$NotifyAviScript = Join-Path $ClaudeHome "scripts\notify-avi.ps1"

# Resolve a python interpreter. Mirrors the find_cmd pattern from .githooks/.
$Python = $null
foreach ($cmd in @("python", "python3", "py")) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) { $Python = $found.Source; break }
}
if (-not $Python) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "C:\Python314\python.exe",
        "C:\Python313\python.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { $Python = $candidate; break }
    }
}
if (-not $Python) {
    if (-not $Silent) {
        Write-Output "WARNING: portability-drift-check skipped - python not found."
    }
    exit 0
}

# Run codemod in --check mode with JSON report. Capture stdout + stderr.
$jsonOut = $null
$exitCode = 0
try {
    $jsonOut = & $Python $Codemod --check --report json 2>&1
    $exitCode = $LASTEXITCODE
}
catch {
    if (-not $Silent) {
        Write-Output "WARNING: portability-drift-check failed to run."
    }
    exit 0
}

# Codemod exit 0 = clean, 1 = drift, 2 = config error.
if ($exitCode -eq 0) { exit 0 }

# Parse JSON report. Fail-open if parse fails.
$report = $null
try {
    $report = $jsonOut | Out-String | ConvertFrom-Json
}
catch {
    if (-not $Silent) {
        Write-Output "WARNING: portability-drift-check produced unparseable output."
    }
    exit 0
}

function Get-OrZero($obj, $name) {
    if ($obj -and $obj.PSObject.Properties.Name -contains $name) {
        return [int]$obj.$name
    }
    return 0
}

$nMatches  = Get-OrZero $report 'total_matches'
$nWarnings = Get-OrZero $report 'total_warnings'
$nFlagged  = Get-OrZero $report 'total_flagged'

# Build summary parts.
$parts = @()
if ($nMatches -gt 0) {
    $suffix = if ($nMatches -eq 1) { '' } else { 's' }
    $parts += "$nMatches hardcoded path$suffix"
}
if ($nWarnings -gt 0) {
    $suffix = if ($nWarnings -eq 1) { '' } else { 's' }
    $parts += "$nWarnings warning$suffix"
}
if ($nFlagged -gt 0) {
    $suffix = if ($nFlagged -eq 1) { '' } else { 's' }
    $parts += "$nFlagged flag$suffix"
}
$summary = if ($parts.Count -gt 0) { ($parts -join ", ") } else { "drift detected" }

if (-not $Silent) {
    Write-Output "WARNING: portability drift on this PC - $summary. Run: python `$HOME/.claude/scripts/portability-codemod.py (add --apply to fix)."
}

# Append structured log entry. Best-effort.
try {
    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $entry = [PSCustomObject]@{
        ts        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        machine   = $env:COMPUTERNAME
        username  = $env:USERNAME
        matches   = $nMatches
        warnings  = $nWarnings
        flagged   = $nFlagged
        exit_code = $exitCode
    } | ConvertTo-Json -Compress
    Add-Content -Path $LogPath -Value $entry -Encoding UTF8
}
catch {
    # ignore - logging is best-effort
}

# Optional toast escalation for repeated drift (watchdog tier opts in).
if ($NotifyAvi -and (Test-Path $NotifyAviScript)) {
    try {
        & $NotifyAviScript -Body "Portability drift on $env:COMPUTERNAME - $summary. Run portability-codemod.py to inspect." -Severity "warn"
    }
    catch {
        # ignore - notifications are best-effort
    }
}

exit 0
