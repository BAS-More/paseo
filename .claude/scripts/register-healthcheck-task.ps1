<#
.SYNOPSIS
  Register ClaudeCode-Heartbeat — external dead-man's-switch every 15 min.

.DESCRIPTION
  Pings the healthchecks.io URL stored in vault at `healthchecks/claude-home-url`.
  If no ping arrives within the configured grace period, healthchecks.io
  emails/SMSs/Slack-notifies you.

  One-time setup (not automated — account creation + URL gen):
    1. Sign up at https://healthchecks.io (free plan: 20 checks)
    2. Create a check: name "claude-home heartbeat", period 30min, grace 30min
    3. Copy the "ping URL" (looks like https://hc-ping.com/<uuid>)
    4. python C:/Dev/tools/vault/vault.py set healthchecks claude-home-url <url>
    5. pwsh -File register-healthcheck-task.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ClaudeCode-Heartbeat'
$script   = Join-Path $env:USERPROFILE '.claude\scripts\healthcheck-ping.ps1'

if (-not (Test-Path $script)) { throw "Missing: $script" }

# Verify vault has the URL
$vaultUrl = & python 'C:\Dev\tools\vault\vault.py' get healthchecks claude-home-url 2>$null
if ($LASTEXITCODE -ne 0 -or -not $vaultUrl) {
    Write-Output 'WARNING: healthchecks/claude-home-url not in vault. Task will ping nothing until set.'
    Write-Output '         Fix: python C:/Dev/tools/vault/vault.py set healthchecks claude-home-url <url>'
}

$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

& schtasks /Delete /F /TN $taskName 2>&1 | Out-Null
& schtasks /Create /F /SC MINUTE /MO 15 /TN $taskName /TR $cmd /RL LIMITED /IT 2>&1 | Out-String | Write-Output
