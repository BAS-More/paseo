<#
.SYNOPSIS
  Elevated BitLocker check — caches result for session-start tripwire.

.DESCRIPTION
  Runs weekly under an admin-flagged scheduled task (requires one-time
  admin consent at registration). Writes status cache to
  ~/.claude/_logs/bitlocker-cache.json. The non-admin SessionStart
  tripwire reads this cache when it can't query BitLocker directly.

  Exit:
    0 — cache written, status = On + 100%
    1 — cache written, status bad — toasts
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

$cache  = Join-Path $env:USERPROFILE '.claude\_logs\bitlocker-cache.json'
$log    = Join-Path $env:USERPROFILE '.claude\_logs\bitlocker-admin-incidents.jsonl'
$notify = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'

New-Item -Path (Split-Path $cache) -ItemType Directory -Force | Out-Null

try {
    $v = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop
    $rec = @{
        timestamp = (Get-Date).ToString('o')
        status    = [string]$v.ProtectionStatus
        encPct    = [int]$v.EncryptionPercentage
        method    = [string]$v.EncryptionMethod
    }
    $json = $rec | ConvertTo-Json -Compress
    Set-Content -Path $cache -Value $json -Encoding UTF8

    if ($rec.status -eq 'On' -and $rec.encPct -eq 100) {
        Write-Output "BitLocker C: On, $($rec.encPct)% $($rec.method) — cached"
        exit 0
    }
    $msg = "BitLocker C: BAD — status=$($rec.status) encPct=$($rec.encPct)"
    Add-Content -Path $log -Value $json -Encoding UTF8
    if (Test-Path $notify) { & pwsh -NoProfile -File $notify -Title 'BitLocker admin check FAILED' -Message $msg 2>&1 | Out-Null }
    Write-Output $msg
    exit 1
}
catch {
    Write-Output "BitLocker admin query failed: $($_.Exception.Message)"
    exit 2
}
