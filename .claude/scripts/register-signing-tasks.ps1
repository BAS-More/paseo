<#
.SYNOPSIS
  Register ClaudeCode-SigningKeyRotation (quarterly) + ClaudeCode-SigningTripwire (hourly).
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$base = Join-Path $env:USERPROFILE '.claude\scripts'

# Rotation — first day of each quarter at 04:30
$rotate = Join-Path $base 'rotate-signing-key.ps1'
if (-not (Test-Path $rotate)) { throw "Missing: $rotate" }
$cmdRotate = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$rotate`" -NoInteractive"

# schtasks lacks a native quarterly — use monthly day 1 but the script is
# idempotent (skips if current-quarter key exists) so it's effectively quarterly
& schtasks /Delete /F /TN 'ClaudeCode-SigningKeyRotation' 2>&1 | Out-Null
& schtasks /Create /F /SC MONTHLY /D 1 /ST 04:30 /TN 'ClaudeCode-SigningKeyRotation' /TR $cmdRotate /RL LIMITED /IT 2>&1 | Out-String | Write-Output

# Tripwire — hourly
$trip = Join-Path $base 'signing-tripwire.ps1'
if (-not (Test-Path $trip)) { throw "Missing: $trip" }
$cmdTrip = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$trip`""

& schtasks /Delete /F /TN 'ClaudeCode-SigningTripwire' 2>&1 | Out-Null
& schtasks /Create /F /SC HOURLY /TN 'ClaudeCode-SigningTripwire' /TR $cmdTrip /RL LIMITED /IT 2>&1 | Out-String | Write-Output
