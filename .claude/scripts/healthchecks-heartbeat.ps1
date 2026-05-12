# healthchecks-heartbeat.ps1
#
# Phase 7 of docs/resilience-and-sync.md. Posts a heartbeat to
# healthchecks.io every run, so a failed watchdog or offline PC raises
# an email/notification independent of the local toolchain.
#
# Setup (once per PC, after creating the healthchecks.io account):
#   1. Create 3 free-tier checks at https://healthchecks.io/, one per PC.
#   2. Copy each check's UUID.
#   3. Run on each PC:
#        powershell.exe -File healthchecks-heartbeat.ps1 -SetUuid <UUID>
#      This stores the UUID in machine-id.json (per-PC, gitignored).
#   4. Schedule via register-healthchecks-task.ps1 (every 5 minutes).
#
# Default behaviour (no flags): POST a success ping to the configured
# UUID. With -Failure: POST /fail (immediate notification).
# With -StartStop: POST /start before, /<exit> after for duration.
#
# Fail-open: any error logged to _logs/healthchecks-<machine>.jsonl,
# never throws. Heartbeats that fail to send count as "missed" on the
# server side, which is exactly the alarm condition.

[CmdletBinding()]
param(
    [string]$SetUuid = "",
    [switch]$Failure,
    [string]$Status = "ok",   # passed as part of POST body
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ClaudeHome = "$env:USERPROFILE\.claude"
$IdPath     = Join-Path $ClaudeHome "machine-id.json"
$logPath    = Join-Path $ClaudeHome "_logs\healthchecks-$env:COMPUTERNAME.jsonl"

. (Join-Path $ClaudeHome "scripts\lib\Write-JsonAtomic.ps1")

function Write-HBLog {
    param([string]$Outcome, [string]$Message)
    try {
        $logDir = Split-Path -Parent $logPath
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
        $entry = @{
            ts       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            machine  = $env:COMPUTERNAME
            outcome  = $Outcome
            message  = $Message
        } | ConvertTo-Json -Compress
        Add-Content -Path $logPath -Value $entry -Encoding UTF8
    } catch {
        # logging is best-effort
    }
    if (-not $Quiet) { Write-Output "heartbeat [$Outcome]: $Message" }
}

# Load machine-id.json. Required for UUID storage.
if (-not (Test-Path $IdPath)) {
    Write-HBLog "no_machine_id" "run scripts/onboard-machine-id.ps1 first"
    exit 0
}

$id = $null
try {
    $id = Get-Content $IdPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-HBLog "id_unparseable" "$($_.Exception.Message)"
    exit 0
}

# -SetUuid: persist the UUID to machine-id.json and exit.
if (-not [string]::IsNullOrEmpty($SetUuid)) {
    $id | Add-Member -MemberType NoteProperty -Name "healthchecks_uuid" -Value $SetUuid -Force
    $id | Add-Member -MemberType NoteProperty -Name "refreshed_at" -Value ((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")) -Force
    Set-JsonAtomic -Path $IdPath -InputObject $id -Depth 4
    Write-HBLog "uuid_set" "stored UUID for $env:COMPUTERNAME"
    exit 0
}

$uuid = $null
if ($id.PSObject.Properties['healthchecks_uuid']) {
    $uuid = $id.healthchecks_uuid
}
if ([string]::IsNullOrEmpty($uuid)) {
    Write-HBLog "not_configured" "no UUID stored - run with -SetUuid <UUID> first"
    exit 0
}

# Build URL.
$base = "https://hc-ping.com/$uuid"
$url = if ($Failure) { "$base/fail" } else { $base }

# POST with body so we can include status info on the dashboard.
$body = @{
    machine = $env:COMPUTERNAME
    status  = $Status
    ts      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
} | ConvertTo-Json -Compress

try {
    $resp = Invoke-WebRequest -Uri $url -Method Post -Body $body `
        -ContentType "application/json" -TimeoutSec 10 -UseBasicParsing
    if ($resp.StatusCode -eq 200) {
        Write-HBLog "ok" "ping sent ($Status)"
        exit 0
    } else {
        Write-HBLog "http_$($resp.StatusCode)" "ping returned $($resp.StatusCode)"
        exit 0
    }
} catch {
    Write-HBLog "post_failed" "$($_.Exception.Message)"
    exit 0
}
