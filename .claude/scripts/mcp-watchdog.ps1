<#
.SYNOPSIS
  MCP Watchdog — ensures critical MCP servers (especially Total-Recall) are running.

.DESCRIPTION
  Reads ~/.claude/mcp-registry.json for the list of servers and their criticality.
  For each critical + must_run server:
    1. Verifies entry_check file exists (drift guard)
    2. Checks if a node/python process is running for it (process_match regex)
    3. Logs status to ~/.claude/_logs/mcp-watchdog.jsonl
    4. If critical + down: attempts to spawn a detached background process
    5. Rate-limits restarts (max_restarts_per_hour)

  This complements VS Code / Claude Code's own MCP lifecycle management —
  those clients start MCPs per-session, but this keeps a headless instance
  running for scripts/tasks that need it 24/7.

.PARAMETER Silent
  Don't emit stdout — only log to file. Use from hooks.

.PARAMETER Repair
  Attempt to restart any down critical MCPs (default: true).

.PARAMETER DryRun
  Report only, no restarts.

.OUTPUTS
  Exit 0 = all critical healthy. Exit 1 = drift or down detected.
#>
[CmdletBinding()]
param(
    [switch]$Silent,
    [switch]$DryRun,
    [bool]$Repair = $true
)

$ErrorActionPreference = 'Continue'

$registryPath = Join-Path $env:USERPROFILE '.claude/mcp-registry.json'
$logDir       = Join-Path $env:USERPROFILE '.claude/_logs'
$logFile      = Join-Path $logDir 'mcp-watchdog.jsonl'
$stateFile    = Join-Path $logDir 'mcp-watchdog-state.json'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log {
    param([string]$Level, [string]$Server, [string]$Event, [hashtable]$Extra = @{})
    $entry = @{
        ts     = (Get-Date).ToString('o')
        level  = $Level
        server = $Server
        event  = $Event
    }
    foreach ($k in $Extra.Keys) { $entry[$k] = $Extra[$k] }
    try {
        ($entry | ConvertTo-Json -Depth 4 -Compress) | Add-Content -Path $logFile -Encoding utf8
    } catch { }
    if (-not $Silent) {
        $color = switch ($Level) { 'ERROR' { 'Red' } 'WARN' { 'Yellow' } 'OK' { 'Green' } default { 'White' } }
        Write-Host "  [$Level] $Server : $Event" -ForegroundColor $color
    }
}

function Load-State {
    if (Test-Path $stateFile) {
        try { return Get-Content $stateFile -Raw | ConvertFrom-Json -AsHashtable } catch { }
    }
    return @{ restarts = @{} }
}

function Save-State {
    param($State)
    # Phase 6a: atomic write (temp + rename) so a watchdog crash mid-write
    # cannot leave a half-written state file.
    $tmp = "$stateFile.codemod-tmp"
    try {
        $State | ConvertTo-Json -Depth 4 | Set-Content -Path $tmp -Encoding utf8 -NoNewline
        Move-Item -Path $tmp -Destination $stateFile -Force
    } catch {
        if (Test-Path -LiteralPath $tmp) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-RateLimit {
    param($State, [string]$Server, [int]$MaxPerHour)
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $cutoff = $now - 3600
    $history = @($State.restarts.$Server) | Where-Object { $_ -and [int]$_ -ge $cutoff }
    $State.restarts.$Server = $history
    return ($history.Count -lt $MaxPerHour)
}

function Record-Restart {
    param($State, [string]$Server)
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if (-not $State.restarts.$Server) { $State.restarts.$Server = @() }
    $State.restarts.$Server = @($State.restarts.$Server) + $now
}

# --- Load registry ---
if (-not (Test-Path $registryPath)) {
    Write-Log -Level 'ERROR' -Server '(registry)' -Event 'registry_missing' -Extra @{ path = $registryPath }
    exit 2
}
$registry = Get-Content $registryPath -Raw | ConvertFrom-Json

if (-not $Silent) {
    Write-Host "`n=== MCP Watchdog ===" -ForegroundColor Cyan
    Write-Host "Registry: $registryPath"
    Write-Host "Log:      $logFile`n"
}

$state = Load-State
$critical_down = @()
$summary = @{ ok = 0; drift = 0; down = 0; restarted = 0; rate_limited = 0 }

# Gather all node/python processes once (faster than per-server query)
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue

foreach ($prop in $registry.servers.PSObject.Properties) {
    $name = $prop.Name
    $cfg  = $prop.Value

    # Drift check
    if ($cfg.entry_check -and -not (Test-Path $cfg.entry_check)) {
        Write-Log -Level 'ERROR' -Server $name -Event 'entry_missing' -Extra @{ path = $cfg.entry_check }
        $summary.drift++
        if ($cfg.critical) { $critical_down += "$name (drift: $($cfg.entry_check))" }
        continue
    }

    # Process check — match against cmdline
    $running = $false
    if ($cfg.process_match) {
        $running = [bool]($procs | Where-Object { $_.CommandLine -match $cfg.process_match })
    }

    if ($running) {
        Write-Log -Level 'OK' -Server $name -Event 'running'
        $summary.ok++
        continue
    }

    # Not running
    if (-not $cfg.must_run) {
        Write-Log -Level 'INFO' -Server $name -Event 'not_running_ok' -Extra @{ reason = 'not must_run' }
        continue
    }

    $summary.down++
    if ($cfg.critical) { $critical_down += $name }
    Write-Log -Level 'WARN' -Server $name -Event 'down'

    # Restart if allowed
    if (-not $Repair -or $DryRun) { continue }
    if (-not $cfg.autostart -and -not $cfg.restart_on_crash) { continue }

    $maxRestarts = if ($registry.watchdog.max_restarts_per_hour) { [int]$registry.watchdog.max_restarts_per_hour } else { 5 }
    if (-not (Test-RateLimit -State $state -Server $name -MaxPerHour $maxRestarts)) {
        Write-Log -Level 'ERROR' -Server $name -Event 'rate_limited' -Extra @{ max = $maxRestarts }
        $summary.rate_limited++
        continue
    }

    try {
        $startArgs = @($cfg.args)
        # Start detached so it survives this script's exit
        $null = Start-Process -FilePath $cfg.command -ArgumentList $startArgs `
            -WindowStyle Hidden -PassThru -ErrorAction Stop
        Record-Restart -State $state -Server $name
        $summary.restarted++
        Write-Log -Level 'OK' -Server $name -Event 'restarted'
    } catch {
        Write-Log -Level 'ERROR' -Server $name -Event 'restart_failed' -Extra @{ error = $_.Exception.Message }
    }
}

Save-State -State $state

if (-not $Silent) {
    Write-Host "`nSummary:" -ForegroundColor Cyan
    Write-Host "  OK:         $($summary.ok)"
    Write-Host "  Drift:      $($summary.drift)"
    Write-Host "  Down:       $($summary.down)"
    Write-Host "  Restarted:  $($summary.restarted)"
    Write-Host "  Rate limited: $($summary.rate_limited)`n"
}

if ($critical_down.Count -gt 0) {
    if (-not $Silent) {
        Write-Host "CRITICAL MCPs DOWN:" -ForegroundColor Red
        $critical_down | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    }
    exit 1
}

exit 0
