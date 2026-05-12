<#
.SYNOPSIS
  Install a Thinkst Canarytoken in ~/.claude — intrusion tripwire.

.DESCRIPTION
  Embeds a DNS-callback canary that fires when anyone reads or parses the
  embedded artifact. Alerts you within seconds of exfiltration or nosy access.

  Setup (one-time):
    1. Generate a canary at https://canarytokens.org
       - Type: "Custom Binary File" OR "AWS Keys" OR "MS Word Document" (pick one)
       - Email: your alert address
       - Memo: "claude-home-backup canary"
       - Save the generated file + token URL
    2. Store the token URL in vault so we track it:
       python C:/Dev/tools/vault/vault.py set canarytoken claude-home <token-url>
    3. Save the canary artifact somewhere under ~/.claude (e.g. docs/.canary/)
    4. Run this script to set up a scheduled check that pings the canary
       management URL weekly to verify it's still alive

  If the canary file ever gets opened/read by someone who isn't you,
  canarytokens.org emails you immediately.

.PARAMETER CheckOnly
  Don't register the weekly verifier task — just check vault state.
#>

[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$vault = 'C:\Dev\tools\vault\vault.py'
$url = & python $vault get canarytoken claude-home 2>$null
if ($LASTEXITCODE -ne 0 -or -not $url) {
    Write-Output 'No canary configured.'
    Write-Output ''
    Write-Output 'One-time setup:'
    Write-Output '  1. Visit https://canarytokens.org'
    Write-Output '  2. Pick "Custom Binary File" (or similar), enter your email'
    Write-Output '  3. Download the generated file'
    Write-Output '  4. Drop the file under ~/.claude/docs/.canary/ (see below)'
    Write-Output '  5. Copy the MANAGEMENT URL (not the token URL)'
    Write-Output '  6. python C:/Dev/tools/vault/vault.py set canarytoken claude-home <mgmt-url>'
    Write-Output ''
    Write-Output 'Good canary hiding spots in ~/.claude:'
    Write-Output '  - docs/.canary/claude-api-keys.txt     (bait: fake-looking keys)'
    Write-Output '  - docs/.canary/vault-dump.json         (bait: looks like export)'
    Write-Output '  - docs/.canary/migration-plan.docx     (boring bait)'
    Write-Output ''
    Write-Output 'Any adversary who browses ~/.claude, cats the file, or loads the'
    Write-Output 'docx in Word will trigger an email alert within seconds.'
    exit 1
}

Write-Output "Canary configured: $url"

# Verify the management URL resolves
try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 5
    Write-Output "  management URL returns HTTP $($resp.StatusCode)"
} catch {
    Write-Output "  management URL unreachable: $($_.Exception.Message)"
}

if (-not (Test-Path (Join-Path $env:USERPROFILE '.claude\docs\.canary'))) {
    Write-Output ''
    Write-Output 'WARNING: ~/.claude/docs/.canary/ does not exist — drop the canary file there.'
}

if ($CheckOnly) { exit 0 }

# Register weekly alive-check
$script = $MyInvocation.MyCommand.Path
$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -CheckOnly"
& schtasks /Delete /F /TN 'ClaudeCode-CanaryCheck' 2>&1 | Out-Null
& schtasks /Create /F /SC WEEKLY /D SUN /ST 10:00 /TN 'ClaudeCode-CanaryCheck' /TR $cmd /RL LIMITED /IT 2>&1 | Out-String
