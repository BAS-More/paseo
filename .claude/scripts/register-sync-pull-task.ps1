<#
.SYNOPSIS
  Register ClaudeCode-SyncPull scheduled task.

.DESCRIPTION
  Runs sync-pull.ps1 every 5 minutes under the user account (S4U). Pulls
  ff-only from main; skips if on a feature branch or working tree dirty.

  Phase 3 of docs/resilience-and-sync.md.

  Requires admin.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Must run as Administrator'
}

$taskName = 'ClaudeCode-SyncPull'
$script   = Join-Path $env:USERPROFILE '.claude\scripts\sync-pull.ps1'

if (-not (Test-Path $script)) { throw "Missing: $script" }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Silent"

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3) `
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
    -Description 'Phase 3 inbound sync. Every 5 minutes pulls ff-only from main if branch == main and tree clean.' | Out-Null

Write-Output "Registered: $taskName (every 5 minutes, S4U, -Silent)"
