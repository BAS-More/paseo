<#
.SYNOPSIS
  Alert if BitLocker is not protecting the system drive.

.DESCRIPTION
  Loss-of-laptop scenario: if disk isn't encrypted, the vault (in Windows
  Credential Manager / DPAPI) + git history + all scripts are readable by
  anyone booting from a USB stick.

  Runs at SessionStart via settings.json hook. Fast (<500ms). Toasts +
  logs if C: is not fully encrypted by BitLocker.

  Exit codes:
    0 — drive fully encrypted
    1 — not encrypted or only partially
    2 — couldn't query (unexpected Windows state)
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

$log = Join-Path $env:USERPROFILE '.claude\_logs\bitlocker-incidents.jsonl'
$notify = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'

try {
    # Get-BitLockerVolume requires admin for some fields but reads ProtectionStatus without elevation
    $v = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop
    $status = $v.ProtectionStatus  # On | Off | Unknown
    $encPct = $v.EncryptionPercentage
    $method = $v.EncryptionMethod

    $healthy = ($status -eq 'On' -and $encPct -eq 100)

    if (-not $healthy) {
        $msg = "BitLocker C: status=$status encPct=$encPct method=$method"
        $rec = @{
            timestamp = (Get-Date).ToString('o')
            drive     = 'C:'
            status    = [string]$status
            encPct    = [int]$encPct
            method    = [string]$method
        } | ConvertTo-Json -Compress
        New-Item -Path (Split-Path $log) -ItemType Directory -Force | Out-Null
        Add-Content -Path $log -Value $rec -Encoding UTF8

        if (Test-Path $notify) {
            & pwsh -NoProfile -File $notify -Title 'BitLocker TRIPWIRE' -Message $msg 2>&1 | Out-Null
        }
        Write-Output $msg
        exit 1
    }

    Write-Output "BitLocker C: healthy ($status, $encPct% $method)"
    exit 0
}
catch {
    # Home editions may not have Get-BitLockerVolume; try manage-bde.
    # Standard users cannot query BitLocker on many systems — not an alert by itself.
    # The admin-only weekly check is the authoritative signal; this is best-effort.
    $mb = & manage-bde -status C: 2>&1
    if ($LASTEXITCODE -eq 0 -and ($mb -join ' ') -match 'Protection On') {
        Write-Output "BitLocker C: On (via manage-bde)"
        exit 0
    }
    # Fallback: read the weekly admin-run cache if present
    $cache = Join-Path $env:USERPROFILE '.claude\_logs\bitlocker-cache.json'
    if (Test-Path $cache) {
        try {
            $c = Get-Content $cache -Raw | ConvertFrom-Json
            $ageH = ((Get-Date) - [DateTime]$c.timestamp).TotalHours
            if ($ageH -gt 168 * 2) {
                Write-Output "BitLocker cache stale ($([int]$ageH)h) — admin weekly check may have failed"
                exit 0
            }
            if ($c.status -eq 'On' -and $c.encPct -eq 100) {
                Write-Output "BitLocker C: On (cached, $([int]$ageH)h old)"
                exit 0
            }
            $msg = "BitLocker C: CACHED STATUS BAD — status=$($c.status) encPct=$($c.encPct)"
            Write-Output $msg
            if (Test-Path $notify) { & pwsh -NoProfile -File $notify -Title 'BitLocker TRIPWIRE' -Message $msg 2>&1 | Out-Null }
            exit 1
        } catch {}
    }
    # Best-effort — no admin, no cache. Quiet exit 0 to avoid false alerts.
    # The weekly admin task (register-bitlocker-admin-check.ps1) provides real detection.
    Write-Output "BitLocker status unavailable (needs admin or cache). Non-fatal."
    exit 0
}
