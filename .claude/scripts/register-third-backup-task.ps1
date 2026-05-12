<#
.SYNOPSIS
  Register ClaudeCode-ThirdBackup scheduled task (weekly Saturdays 02:00).

.DESCRIPTION
  Uses schtasks.exe, current user, no admin required.

  Precondition: `python C:/Dev/tools/vault/vault.py set third-backup passphrase <32+char-random>`
  Script will fail (exit 1) and toast if passphrase is not set.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ClaudeCode-ThirdBackup'
$script   = Join-Path $env:USERPROFILE '.claude\scripts\backup-to-third-provider.ps1'

if (-not (Test-Path $script)) { throw "Missing: $script" }

$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

& schtasks /Delete /F /TN $taskName 2>&1 | Out-Null
& schtasks /Create /F /SC WEEKLY /D SAT /ST 02:00 /TN $taskName /TR $cmd /RL LIMITED /IT 2>&1 | Out-String | Write-Output
