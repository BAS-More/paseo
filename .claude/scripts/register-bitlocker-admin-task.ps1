<#
.SYNOPSIS
  Register ClaudeCode-BitLockerAdminCheck — weekly elevated BitLocker check.

.DESCRIPTION
  Requires admin to register (-RunLevel Highest). Triggers weekly Sunday 05:00.
  Writes ~/.claude/_logs/bitlocker-cache.json. The SessionStart tripwire
  reads this cache when it can't query BitLocker directly.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Must run as Administrator to register an elevated task.'
}

$taskName = 'ClaudeCode-BitLockerAdminCheck'
$script   = Join-Path $env:USERPROFILE '.claude\scripts\bitlocker-admin-check.ps1'

if (-not (Test-Path $script)) { throw "Missing: $script" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 05:00

# LogonType note: switched from S4U → Interactive.
#   S4U runs without a stored password but provides only a *filtered* token,
#   so Get-BitLockerVolume returns partial data and ProtectionStatus check
#   fails (task exits 1, cache not populated).
#   Interactive + RunLevel Highest gives a full admin token at runtime;
#   trade-off is the task only fires when the user is logged in. Sunday 05:00
#   normally has the laptop on; StartWhenAvailable catches up later otherwise.
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Weekly elevated BitLocker status check — writes cache for SessionStart tripwire.' | Out-Null

Write-Output "Registered $taskName (Sundays 05:00, elevated)"
