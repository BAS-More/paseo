<#
.SYNOPSIS
  Register the ClaudeCode-PRHealth scheduled task.

.DESCRIPTION
  Runs pr-health-scan.ps1 every 30 minutes. PRs move faster than tool
  health, so more frequent than the hourly tool-health task.

  No auto-fix at the scheduled-task level - just detection + dedup-notify.
  Active fixing is driven by the pr-health-guardian subagent, which Avi
  invokes on-demand or via /loop.
#>

$ErrorActionPreference = 'Stop'
$taskName   = 'ClaudeCode-PRHealth'
$scriptPath = "$env:USERPROFILE\.claude\scripts\pr-health-scan.ps1"

if (-not (Test-Path $scriptPath)) {
    throw "pr-health-scan.ps1 not found at $scriptPath"
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task"
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -Quiet"

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3)
$trigger.Repetition = New-CimInstance -ClassName MSFT_TaskRepetitionPattern `
    -Namespace Root/Microsoft/Windows/TaskScheduler `
    -Property @{ Interval = 'PT30M'; Duration = '' } `
    -ClientOnly

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 8) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 3) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($trigger, $logonTrigger) `
    -Settings $settings `
    -Principal $principal `
    -Description 'Scan Avi open PRs across BAS-More and Avi-Bendetsky every 30 min. Toast on red/conflict state change. Auto-fixing is driven by the pr-health-guardian subagent.' | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host '=== Task registered ==='
Write-Host "  Name:      $($task.TaskName)"
Write-Host "  State:     $($task.State)"
Write-Host "  First run: $($info.NextRunTime)"
Write-Host '  Intervals: every 30 min + at every logon'
Write-Host ''

Write-Host '=== Manual test run (in 3 sec) ==='
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 20
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host "  Last run:    $($info.LastRunTime)"
Write-Host "  Last result: $($info.LastTaskResult)  (0=clean, 1=unknown-PRs, 2=red/conflict)"
