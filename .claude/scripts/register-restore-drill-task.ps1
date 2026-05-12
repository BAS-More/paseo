<#
.SYNOPSIS
  Register ClaudeCode-RestoreDrill scheduled task (monthly, first Sunday 03:00).

.DESCRIPTION
  Uses schtasks.exe to register under the current user — no admin required.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ClaudeCode-RestoreDrill'
$script   = Join-Path $env:USERPROFILE '.claude\scripts\restore-drill.ps1'

if (-not (Test-Path $script)) { throw "Missing: $script" }

$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# Monthly on day 1 at 03:00 — schtasks does not support "first sunday",
# so we approximate with /D 1 (day-of-month 1) + /SC MONTHLY.
& schtasks /Delete /F /TN $taskName 2>&1 | Out-Null
& schtasks /Create /F /SC MONTHLY /D 1 /ST 03:00 /TN $taskName /TR $cmd /RL LIMITED /IT 2>&1 | Out-String | Write-Output
