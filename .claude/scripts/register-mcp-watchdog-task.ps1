<#
.SYNOPSIS
  Registers the Windows Scheduled Task that runs the MCP Watchdog every 15
  minutes (keeps Total-Recall and other critical MCPs alive even outside
  VS Code / Claude Code sessions).

.DESCRIPTION
  Idempotent — safe to re-run. Uses schtasks.exe because Register-ScheduledTask
  was returning Access Denied on this workstation. Calls a .cmd wrapper to
  avoid Windows quote-escaping issues when an .exe path contains spaces.

  Uninstall:  schtasks /Delete /TN "MCP Watchdog" /F
#>

[CmdletBinding()]
param(
    [int]$IntervalMinutes = 15,
    [string]$TaskName = 'MCP Watchdog'
)

$ErrorActionPreference = 'Stop'

$cmdWrapper = Join-Path $env:USERPROFILE '.claude\scripts\mcp-watchdog.cmd'
$ps1Path    = Join-Path $env:USERPROFILE '.claude\scripts\mcp-watchdog.ps1'

if (-not (Test-Path $ps1Path))    { throw "Missing: $ps1Path" }
if (-not (Test-Path $cmdWrapper)) { throw "Missing: $cmdWrapper" }

# Delete existing task (ignore errors if not present)
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null

# Task Scheduler splits /TR on spaces unless the whole value is double-quoted.
$tr = '"' + $cmdWrapper + '"'

$null = schtasks /Create /TN $TaskName /TR $tr /SC MINUTE /MO $IntervalMinutes /F
if ($LASTEXITCODE -ne 0) { throw "schtasks /Create failed with exit $LASTEXITCODE" }

Write-Host "Registered task: $TaskName" -ForegroundColor Green
Write-Host "  Runs:     every $IntervalMinutes minutes"
Write-Host "  Command:  $cmdWrapper"
Write-Host "  Logs:     $env:USERPROFILE\.claude\_logs\mcp-watchdog.jsonl"
Write-Host ""
Write-Host "Run now:  schtasks /Run /TN `"$TaskName`""
Write-Host "Remove:   schtasks /Delete /TN `"$TaskName`" /F"
