<#
.SYNOPSIS
  Register the ClaudeCode-ToolHealth scheduled task.

.DESCRIPTION
  Creates a Windows scheduled task that runs tool-health-autorun.ps1
  every hour (starting 5 minutes after registration). Fires a Windows
  toast + appends to tool-health-incidents.jsonl when anything is
  broken after auto-repair.

  Runs as the current user (no admin required, same pattern as
  register-backup-task.ps1).
#>

$ErrorActionPreference = 'Stop'
$taskName   = 'ClaudeCode-ToolHealth'
$scriptPath = "$env:USERPROFILE\.claude\scripts\tool-health-autorun.ps1"

if (-not (Test-Path $scriptPath)) {
    throw "tool-health-autorun.ps1 not found at $scriptPath"
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task"
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -Quiet"

# Hourly repetition, indefinite duration (same trick as backup task).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
$trigger.Repetition = New-CimInstance -ClassName MSFT_TaskRepetitionPattern `
    -Namespace Root/Microsoft/Windows/TaskScheduler `
    -Property @{ Interval = 'PT1H'; Duration = '' } `
    -ClientOnly

# Also run at user logon, so first-session-of-the-day is already checked.
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($trigger, $logonTrigger) `
    -Settings $settings `
    -Principal $principal `
    -Description 'Hourly sweep of Claude Code MCP servers, hooks, and scripts. Auto-repairs what it can, toasts Avi when something needs attention.' | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host '=== Task registered ==='
Write-Host "  Name:      $($task.TaskName)"
Write-Host "  State:     $($task.State)"
Write-Host "  First run: $($info.NextRunTime)"
Write-Host '  Intervals: every 1 hour + at every logon'
Write-Host ''

Write-Host '=== Manual test run (in 3 sec) ==='
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host "  Last run:    $($info.LastRunTime)"
Write-Host "  Last result: $($info.LastTaskResult)  (0 = all green, 1 = yellow, 2 = red, 267009 = still running)"
