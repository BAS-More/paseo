<#
.SYNOPSIS
  Register ClaudeCode-VaultSync scheduled task (daily 04:00).

.DESCRIPTION
  Runs `vault_backup.py sync push` — exports encrypted .vault.sync to OneDrive.
  Passphrase already in Windows Credential Manager (keyring) from first interactive
  sync. No admin required. Closes "no scheduled vault backup" gap.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ClaudeCode-VaultSync'
$vaultPy  = 'C:\Dev\tools\vault\vault_backup.py'

if (-not (Test-Path $vaultPy)) { throw "Missing: $vaultPy" }

$cmd = "python.exe `"$vaultPy`" sync push"

& schtasks /Delete /F /TN $taskName 2>&1 | Out-Null
& schtasks /Create /F /SC DAILY /ST 04:00 /TN $taskName /TR $cmd /RL LIMITED /IT 2>&1 | Out-String | Write-Output
