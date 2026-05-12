<#
.SYNOPSIS
  Register weekly ClaudeCode-MCPDrift scheduled task.

.DESCRIPTION
  Runs mcp-manifest-drift-check.ps1 every Monday 09:00 under the user
  account (S4U, no password, runs whether logged in or not).

  Requires admin.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Must run as Administrator'
}

$taskName = 'ClaudeCode-MCPDrift'
$script   = Join-Path $env:USERPROFILE '.claude\scripts\mcp-manifest-drift-check.ps1'

if (-not (Test-Path $script)) { throw "Missing: $script" }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 09:00

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
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
    -Description 'Weekly drift check between ~/.claude.json and mcp-manifest.json. Toasts on mismatch.' | Out-Null

Write-Output "Registered: $taskName (Mondays 09:00)"
