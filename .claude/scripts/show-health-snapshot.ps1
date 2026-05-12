<#
.SYNOPSIS
  Pretty-print ~/.claude/_logs/health-snapshot.json.

.DESCRIPTION
  Read-only viewer for the health-runner snapshot. Shows the aggregate
  status (colored), generation timestamp + age, host, and each check
  with status badge and duration. For FAIL entries, also prints the
  first line of the reason.

  If the snapshot file is missing, prints a hint to run health-runner.ps1.

.OUTPUTS
  Exit 0 always (read-only viewer; missing snapshot is informational, not error).
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$snapPath = Join-Path $env:USERPROFILE '.claude\_logs\health-snapshot.json'

if (-not (Test-Path $snapPath)) {
    Write-Host ''
    Write-Host 'Snapshot not found.' -ForegroundColor Yellow
    Write-Host "  Path: $snapPath"
    Write-Host '  Run once: pwsh -File "$HOME\.claude\scripts\health-runner.ps1"'
    Write-Host ''
    exit 0
}

try {
    $snap = Get-Content $snapPath -Raw -ErrorAction Stop | ConvertFrom-Json
} catch {
    Write-Host "Snapshot unreadable: $($_.Exception.Message)" -ForegroundColor Red
    exit 0
}

# Aggregate color
$aggregate = $snap.aggregate
$aggColor = switch ($aggregate) {
    'green' { 'Green' }
    'amber' { 'Yellow' }
    'red'   { 'Red' }
    default { 'Gray' }
}

# Age calculation
$ageStr = '?'
try {
    $nowEpoch = [int64][DateTimeOffset]::Now.ToUnixTimeSeconds()
    $ageSec = $nowEpoch - [int64]$snap.generated_epoch
    if ($ageSec -lt 60) {
        $ageStr = "${ageSec}s ago"
    } elseif ($ageSec -lt 3600) {
        $ageStr = ("{0}m ago" -f [int]($ageSec / 60))
    } elseif ($ageSec -lt 86400) {
        $ageStr = ("{0}h{1}m ago" -f [int]($ageSec / 3600), [int](($ageSec % 3600) / 60))
    } else {
        $ageStr = ("{0}d ago" -f [int]($ageSec / 86400))
    }
} catch {
    $ageStr = '?'
}

Write-Host ''
Write-Host '=== Health Snapshot ===' -ForegroundColor Cyan
Write-Host ("  Aggregate:  {0}" -f $aggregate.ToUpper()) -ForegroundColor $aggColor
Write-Host ("  Generated:  {0}  ({1})" -f $snap.generated_at, $ageStr)
Write-Host ("  Host:       {0}" -f $snap.host)
Write-Host ''

foreach ($c in $snap.checks) {
    $statusColor = switch ($c.status) {
        'PASS' { 'Green' }
        'WARN' { 'Yellow' }
        'FAIL' { 'Red' }
        'SKIP' { 'DarkGray' }
        default { 'Gray' }
    }
    $dur = if ($null -ne $c.duration_ms) { ("{0}ms" -f $c.duration_ms) } else { '-' }
    Write-Host ("  [{0}] {1,-22} ({2})" -f $c.status, $c.name, $dur) -ForegroundColor $statusColor
    if ($c.status -eq 'FAIL' -or $c.status -eq 'WARN') {
        $firstLine = ($c.reason -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
        if ($firstLine) {
            Write-Host ("        reason: {0}" -f $firstLine.Trim()) -ForegroundColor DarkGray
        }
    }
}
Write-Host ''
exit 0
