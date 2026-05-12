<#
.SYNOPSIS
  Register ClaudeCode-PortabilityDrift scheduled task.

.DESCRIPTION
  Runs portability-drift-check.ps1 every 30 minutes under the user account
  (S4U, no password). On drift detection, the underlying codemod surfaces
  the issue via _logs/portability-drift.jsonl. The task itself runs with
  -Silent so it doesn't write to a console; toast escalation is opt-in via
  -NotifyAvi (enabled here when scoped to repeat-drift events - the
  drift-check script handles its own escalation policy).

  Phase 1.3 of docs/resilience-and-sync.md.

  Requires admin.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Must run as Administrator'
}

$taskName = 'ClaudeCode-PortabilityDrift'
$script   = Join-Path $env:USERPROFILE '.claude\scripts\portability-drift-check.ps1'

if (-not (Test-Path $script)) { throw "Missing: $script" }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Silent -NotifyAvi"

# Repeat every 30 minutes, indefinitely, starting 5 minutes after registration.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Minutes 30)

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
    -Description 'Periodic portability drift check (Phase 1.3). Logs to _logs/portability-drift.jsonl; toasts on drift via notify-avi.' | Out-Null

Write-Output "Registered: $taskName (every 30 minutes, S4U, -Silent -NotifyAvi)"
