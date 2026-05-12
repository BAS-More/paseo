# cross-pc-status.ps1
#
# Phase 4 of docs/resilience-and-sync.md. Read each PC's tracked
# _logs/sync-pull-<machine>.jsonl and render a one-line-per-PC status.
#
# Each PC writes its own jsonl (Phase 4 per-PC suffix). When auto-commit
# pushes those files to main and other PCs pull, every PC has a copy of
# every other PC's heartbeat history. cross-pc-status reads them all.
#
# Output format:
#   AVISURFACE   green   HEAD@abc1234   2 min ago    pulled  3 commits
#   PC2-WORK     yellow  HEAD@def5678   47 min ago   ff_blocked
#   PC3-HOME     red     -              17 hours ago no_heartbeat
#
# Status semantics:
#   green   : last heartbeat <= 10 min ago, last outcome in (pulled, no_change, skip)
#   yellow  : last heartbeat <= 60 min ago OR last outcome ff_blocked / fetch_fail
#   red     : last heartbeat > 60 min ago OR last outcome post_pull_validation_fail

[CmdletBinding()]
param(
    [string]$Format = "text"  # text | json
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ClaudeHome = "$env:USERPROFILE\.claude"
$LogDir     = Join-Path $ClaudeHome "_logs"

if (-not (Test-Path $LogDir)) {
    Write-Output "No _logs/ directory yet - sync-pull never ran on this PC."
    exit 0
}

$now = Get-Date

function Get-LastJsonl {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        $lastLine = Get-Content $Path -Tail 1 -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($lastLine)) { return $null }
        return $lastLine | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Get-Prop {
    param($obj, [string]$name, $default = $null)
    if ($obj -and $obj.PSObject.Properties[$name]) {
        return $obj.$name
    }
    return $default
}

function Get-Status {
    param($entry, [datetime]$now)
    $ts = Get-Prop $entry 'ts' $null
    if (-not $entry -or -not $ts) {
        return @{ status = "red"; reason = "no_heartbeat" }
    }
    $tsParsed = [datetime]::Parse($ts).ToLocalTime()
    $age = $now - $tsParsed
    $outcome = Get-Prop $entry 'outcome' 'unknown'

    $isHard = @("post_pull_validation_fail") -contains $outcome
    $isSoft = @("ff_blocked", "fetch_fail") -contains $outcome

    if ($age.TotalMinutes -gt 60 -or $isHard) {
        return @{ status = "red"; reason = $outcome }
    }
    if ($age.TotalMinutes -gt 10 -or $isSoft) {
        return @{ status = "yellow"; reason = $outcome }
    }
    return @{ status = "green"; reason = $outcome }
}

function Format-Age {
    param([timespan]$age)
    if ($age.TotalMinutes -lt 1) { return "<1 min ago" }
    if ($age.TotalMinutes -lt 60) { return "$([int]$age.TotalMinutes) min ago" }
    if ($age.TotalHours -lt 24) { return "$([int]$age.TotalHours) hours ago" }
    return "$([int]$age.TotalDays) days ago"
}

$rows = @()
$logFiles = Get-ChildItem -Path $LogDir -Filter "sync-pull-*.jsonl" -ErrorAction SilentlyContinue
foreach ($file in $logFiles) {
    if ($file.Name -notmatch '^sync-pull-(.+)\.jsonl$') { continue }
    $machine = $Matches[1]
    $entry = Get-LastJsonl $file.FullName
    $status = Get-Status $entry $now
    $tsRaw = Get-Prop $entry 'ts' $null
    if ($tsRaw) {
        $ts = [datetime]::Parse($tsRaw).ToLocalTime()
        $age = $now - $ts
        $ageStr = Format-Age $age
    } else {
        $ageStr = "never"
    }
    $shaRaw = Get-Prop $entry 'head_sha' $null
    $sha = if ($shaRaw) { $shaRaw.Substring(0, 7) } else { "-" }
    $msg = Get-Prop $entry 'message' ""

    $rows += [PSCustomObject]@{
        machine = $machine
        status  = $status.status
        sha     = $sha
        age     = $ageStr
        outcome = $status.reason
        message = $msg
    }
}

if ($rows.Count -eq 0) {
    Write-Output "No sync-pull-*.jsonl files yet. Phase 4 PC-tagged logs start populating after the first sync-pull run on each machine."
    exit 0
}

if ($Format -eq "json") {
    $rows | ConvertTo-Json -Depth 3
    exit 0
}

# Text format. Include local PC marker.
$thisPc = $env:COMPUTERNAME
$header = "{0,-18} {1,-7} {2,-12} {3,-15} {4,-25} {5}" -f "MACHINE", "STATUS", "HEAD@", "LAST SEEN", "OUTCOME", "MESSAGE"
Write-Output $header
Write-Output ("-" * 100)
foreach ($row in ($rows | Sort-Object machine)) {
    $marker = if ($row.machine -eq $thisPc) { "* " } else { "  " }
    $line = "{0}{1,-16} {2,-7} {3,-12} {4,-15} {5,-25} {6}" -f $marker, $row.machine, $row.status, "HEAD@$($row.sha)", $row.age, $row.outcome, $row.message
    Write-Output $line
}
Write-Output ""
Write-Output "* = this PC ($thisPc)"
exit 0
