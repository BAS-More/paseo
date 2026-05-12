<#
.SYNOPSIS
  Register ClaudeCode-Healthchecks heartbeat task.

.DESCRIPTION
  Runs healthchecks-heartbeat.ps1 every 5 minutes under S4U. The
  heartbeat fail-opens silently if no UUID is configured, so this task
  is safe to register before Avi has set up a healthchecks.io account.

  Phase 7 of docs/resilience-and-sync.md.

  Requires admin.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Must run as Administrator'
}

$taskName = 'ClaudeCode-Healthchecks'
$script   = Join-Path $env:USERPROFILE '.claude\scripts\healthchecks-heartbeat.ps1'

if (-not (Test-Path $script)) { throw "Missing: $script" }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Quiet"

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "Removed existing task: $taskName"
}

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Phase 7. Posts a heartbeat to healthchecks.io every 5 minutes. Watchman watcher.' | Out-Null

Write-Output "Registered: $taskName (every 5 minutes, S4U, -Quiet)"
Write-Output "Next: powershell.exe -File healthchecks-heartbeat.ps1 -SetUuid <UUID-FROM-HEALTHCHECKS-IO>"
