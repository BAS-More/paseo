<#
.SYNOPSIS
  Ping an external heartbeat endpoint (healthchecks.io or equivalent).

.DESCRIPTION
  External dead-man's-switch: if this machine is off, scheduled tasks
  don't fire, this script doesn't ping, healthchecks.io pages you.

  Reads the ping URL from vault at `healthchecks/claude-home-url`.
  If missing, exits quietly (first-run of unconfigured script).

.PARAMETER Endpoint
  Slug appended to the URL — e.g. `fail` for failure signal. Blank = success.

.PARAMETER Body
  Optional text body (short log summary). Max 10KB.

.EXAMPLE
  pwsh -File healthcheck-ping.ps1                 # success ping
  pwsh -File healthcheck-ping.ps1 -Endpoint fail  # failure ping
#>

[CmdletBinding()]
param(
    [string]$Endpoint = '',
    [string]$Body = ''
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

$vault = 'C:\Dev\tools\vault\vault.py'
if (-not (Test-Path $vault)) { exit 0 }

$base = & python $vault get healthchecks claude-home-url 2>$null
if ($LASTEXITCODE -ne 0 -or -not $base) {
    # Unconfigured; quiet exit
    exit 0
}
$base = $base.Trim().TrimEnd('/')

$url = $base
if ($Endpoint) { $url = "$base/$Endpoint" }

try {
    if ($Body) {
        Invoke-WebRequest -Uri $url -Method POST -Body $Body -UseBasicParsing -TimeoutSec 10 | Out-Null
    } else {
        Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 | Out-Null
    }
}
catch {
    # Best-effort; don't fail the caller
    Write-Output "healthcheck ping failed (non-fatal): $($_.Exception.Message)"
    exit 0
}

exit 0
