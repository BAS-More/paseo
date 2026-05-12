<#
.SYNOPSIS
  Register (or update) the BAS-Health-Runner Windows scheduled task.

.DESCRIPTION
  Runs health-runner.ps1 at logon AND every -IntervalMinutes (default 30).
  Idempotent: re-running unregisters and re-registers, never duplicates.

  Uses pwsh.exe (PowerShell 7+) so the runner gets predictable JSON
  serialization. If pwsh.exe is not on PATH, install PowerShell 7 from
  https://github.com/PowerShell/PowerShell/releases or change -Execute below
  to 'powershell.exe'.

.PARAMETER IntervalMinutes
  Repeat cadence in minutes. Default 30.

.PARAMETER Unregister
  Remove the task and exit.
#>

[CmdletBinding()]
param(
    [int]$IntervalMinutes = 30,
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

$taskName   = 'BAS-Health-Runner'
$scriptPath = "$env:USERPROFILE\.claude\scripts\health-runner.ps1"

if ($Unregister) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed task: $taskName" -ForegroundColor Green
    } else {
        Write-Host "Task not present: $taskName" -ForegroundColor DarkGray
    }
    exit 0
}

if (-not (Test-Path $scriptPath)) {
    throw "health-runner.ps1 not found at $scriptPath"
}

if ($IntervalMinutes -lt 5 -or $IntervalMinutes -gt 1440) {
    throw "IntervalMinutes must be 5..1440 (got $IntervalMinutes)"
}

# Idempotency: drop existing task before re-registering.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task (re-registering)"
}

$action = New-ScheduledTaskAction `
    -Execute 'pwsh.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -Quiet"

# Repeating trigger: starts 3 min from now, repeats every $IntervalMinutes minutes,
# with a long enough Duration that it effectively runs forever (PT0S means "until disabled").
$intervalIso = "PT${IntervalMinutes}M"
$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3)
$repeatTrigger.Repetition = New-CimInstance -ClassName MSFT_TaskRepetitionPattern `
    -Namespace Root/Microsoft/Windows/TaskScheduler `
    -Property @{ Interval = $intervalIso; Duration = '' } `
    -ClientOnly

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 3) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($repeatTrigger, $logonTrigger) `
    -Settings $settings `
    -Principal $principal `
    -Description "Aggregates 4 tooling-health checks into ~/.claude/_logs/health-snapshot.json. Toasts on red transition. Surfaced to Claude Code at SessionStart via health-check-on-boot.js." | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName

Write-Host ''
Write-Host '=== BAS-Health-Runner registered ===' -ForegroundColor Cyan
Write-Host ("  Name:      {0}" -f $task.TaskName)
Write-Host ("  State:     {0}" -f $task.State)
Write-Host ("  First run: {0}" -f $info.NextRunTime)
Write-Host ("  Cadence:   every {0} min + at every logon" -f $IntervalMinutes)
Write-Host ("  Limit:     5 min max per run, MultipleInstances=IgnoreNew")
Write-Host ''
Write-Host "  Force-run now:  schtasks /run /tn $taskName"
Write-Host "  Unregister:     pwsh $PSCommandPath -Unregister"
Write-Host ''
