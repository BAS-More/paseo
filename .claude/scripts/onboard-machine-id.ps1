# onboard-machine-id.ps1
#
# Phase 4 of docs/resilience-and-sync.md. Generates ~/.claude/machine-id.json
# (per-PC, gitignored) on first run. Idempotent: if file exists with the same
# COMPUTERNAME, no-op. If COMPUTERNAME changed (e.g. PC renamed), refreshes
# the file but preserves registered_at.
#
# Called by:
#   - scripts/onboard-machine.ps1 (Phase 8) at first sync
#   - scripts/sync-pull.ps1 / portability-drift-check.ps1 lazily if file
#     missing on a particular PC
#
# Output: writes machine-id.json. Prints summary to stdout. Always exit 0.

[CmdletBinding()]
param(
    [string]$DisplayName = $null,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ClaudeHome = "$env:USERPROFILE\.claude"
$IdPath     = Join-Path $ClaudeHome "machine-id.json"

# Phase 6a: atomic write helper.
. (Join-Path $ClaudeHome "scripts\lib\Write-JsonAtomic.ps1")

$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$existing = $null
if ((Test-Path $IdPath) -and -not $Force) {
    try {
        $existing = Get-Content $IdPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        $existing = $null
    }
}

if ($existing -and $existing.computer_name -eq $env:COMPUTERNAME -and -not $Force) {
    Write-Output "machine-id.json already current for $($env:COMPUTERNAME) - no change."
    exit 0
}

$registeredAt = if ($existing -and $existing.registered_at) { $existing.registered_at } else { $now }

$psVersion = ($PSVersionTable.PSVersion).ToString()

$payload = [ordered]@{
    schema_version       = 1
    computer_name        = $env:COMPUTERNAME
    display_name         = $DisplayName  # may be null
    username             = $env:USERNAME
    user_domain          = $env:USERDOMAIN
    os                   = "Windows"
    os_version           = [System.Environment]::OSVersion.VersionString
    powershell_version   = $psVersion
    claude_home_resolved = $ClaudeHome
    registered_at        = $registeredAt
    refreshed_at         = $now
}

Set-JsonAtomic -Path $IdPath -InputObject $payload -Depth 4

Write-Output "Wrote $IdPath (machine: $($env:COMPUTERNAME))"
exit 0
