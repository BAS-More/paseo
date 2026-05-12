$ErrorActionPreference = 'Stop'
$taskName   = 'ClaudeCode-Backup-OneDrive'
$scriptPath = "$env:USERPROFILE\.claude\scripts\backup-claude-to-onedrive.ps1"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task"
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

# Start ~5 min from now, then repeat every hour forever.
# Note: we build the trigger via CIM directly because PowerShell's cmdlet
# insists on a finite RepetitionDuration, but the XML schema accepts
# empty string for "run forever". Same trick works in task scheduler GUI.
$startBoundary = (Get-Date).AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss')
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
$trigger.Repetition = New-CimInstance -ClassName MSFT_TaskRepetitionPattern `
    -Namespace Root/Microsoft/Windows/TaskScheduler `
    -Property @{ Interval = 'PT1H'; Duration = '' } `
    -ClientOnly

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Hourly mirror of ~/.claude/projects/ (Claude Code chat sessions) to OneDrive' | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host '=== Task registered ==='
Write-Host "  Name:      $($task.TaskName)"
Write-Host "  State:     $($task.State)"
Write-Host "  First run: $($info.NextRunTime)"
Write-Host '  Interval:  every 1 hour'
Write-Host ''

Write-Host '=== Manual test run ==='
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host "  Last run:    $($info.LastRunTime)"
Write-Host "  Last result: $($info.LastTaskResult)  (0 = success, 267009 = still running)"
