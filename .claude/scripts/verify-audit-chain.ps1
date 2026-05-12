<#
.SYNOPSIS
  Walk the hash-chain audit log; alert if any link is broken.

.DESCRIPTION
  Wraps `audit_chain.py verify`. Exit 0 when intact; exit 1 + toast +
  healthcheck-fail ping when broken (forensic trigger).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

$py     = Join-Path $env:USERPROFILE '.claude\scripts\audit_chain.py'
$notify = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'
$ping   = Join-Path $env:USERPROFILE '.claude\scripts\healthcheck-ping.ps1'
$logDir = Join-Path $env:USERPROFILE '.claude\_logs'
$log    = Join-Path $logDir ('audit-chain-verify-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')

New-Item -Path $logDir -ItemType Directory -Force | Out-Null
$out = & python $py verify 2>&1
$ec = $LASTEXITCODE
$line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] exit=$ec :: $out"
Add-Content -Path $log -Value $line -Encoding UTF8
Write-Output $line

if ($ec -ne 0) {
    $msg = "Audit chain BROKEN: $out"
    if (Test-Path $notify) { & pwsh -NoProfile -File $notify -Title 'Audit chain tamper' -Message $msg 2>&1 | Out-Null }
    if (Test-Path $ping)   { & pwsh -NoProfile -File $ping   -Endpoint fail -Body $msg 2>&1 | Out-Null }
    exit 1
}
exit 0
