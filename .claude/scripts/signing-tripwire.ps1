<#
.SYNOPSIS
  Detect commits pushed to origin/main that weren't signed by known keys.

.DESCRIPTION
  A "tripwire" — runs hourly, scans the last 100 commits on origin/main,
  flags any whose SSH signature doesn't validate against allowed_signers.
  Covers the case where Avi's SSH key is compromised and an attacker
  signs commits with a rogue key.

  Doesn't block pushes (branch-protection handles that). Detects after the fact
  + toasts. Logs to _logs/signing-tripwire-incidents.jsonl.
#>

[CmdletBinding()]
param([int]$Limit = 100)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$claudeRepo = Join-Path $env:USERPROFILE '.claude'
$logFile    = Join-Path $claudeRepo '_logs\signing-tripwire-incidents.jsonl'
$notify     = Join-Path $claudeRepo 'scripts\notify-avi.ps1'

New-Item -Path (Split-Path $logFile) -ItemType Directory -Force | Out-Null

Push-Location $claudeRepo
try {
    # git writes progress to stderr; under EAP=Stop that becomes terminating.
    # Wrap in EAP=Continue locally so we can inspect $LASTEXITCODE explicitly
    # and decide what to do — silent failure here would let the tripwire report
    # "healthy" while it had actually failed to evaluate any commits.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    # 1. Fetch — failure is non-fatal (offline / auth blip). Log a warning and
    #    keep going against whatever local origin/main we already have.
    $fetchErr = & git fetch origin main 2>&1
    $fetchExit = $LASTEXITCODE
    if ($fetchExit -ne 0) {
        Write-Warning "git fetch origin main failed (exit $fetchExit). Evaluating cached origin/main. Output: $fetchErr"
    }

    # 2. Log — must succeed. If the ref or repo is broken, that itself is the
    #    incident: we cannot assert anything about commit signatures.
    $commits = & git log --format='%H|%G?|%GS' "-n$Limit" origin/main 2>&1
    $logExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP

    if ($logExit -ne 0) {
        $errMsg = "Signing tripwire: git log failed (exit $logExit). Cannot evaluate signatures. Output: $commits"
        Write-Output $errMsg
        $entry = @{
            ts        = (Get-Date -Format 'o')
            level     = 'error'
            error     = 'git_log_failed'
            exitCode  = $logExit
            output    = ($commits | Out-String).Trim()
        } | ConvertTo-Json -Depth 4 -Compress
        Add-Content -Path $logFile -Value $entry -Encoding UTF8
        if (Test-Path $notify) {
            try { & $notify -Title 'Signing tripwire BROKEN' -Body $errMsg -Severity 'Critical' | Out-Null } catch {}
        }
        exit 2
    }

    if (-not $commits -or @($commits).Count -eq 0) {
        $errMsg = "Signing tripwire: git log returned no commits for origin/main. Tripwire could not run."
        Write-Output $errMsg
        $entry = @{
            ts    = (Get-Date -Format 'o')
            level = 'error'
            error = 'no_commits_returned'
        } | ConvertTo-Json -Depth 4 -Compress
        Add-Content -Path $logFile -Value $entry -Encoding UTF8
        if (Test-Path $notify) {
            try { & $notify -Title 'Signing tripwire BROKEN' -Body $errMsg -Severity 'Critical' | Out-Null } catch {}
        }
        exit 2
    }

    $bad = @()
    foreach ($line in $commits) {
        if (-not $line) { continue }
        $parts = $line -split '\|'
        if ($parts.Count -lt 2) { continue }
        $sha = $parts[0]
        $gstatus = $parts[1]
        # G = good signature, N = no signature, B = bad, U = untrusted, E = error
        if ($gstatus -notin @('G', 'N')) {
            # N (no sig) is pre-signing-era history — not a trip
            # Everything else (B, U, E) is suspicious
            $signer = if ($parts.Count -ge 3) { $parts[2] } else { '' }
            $bad += @{ sha = $sha; gstatus = $gstatus; signer = $signer }
        }
    }

    if ($bad.Count -eq 0) {
        Write-Output "OK: all $Limit commits on origin/main signed-or-intentionally-unsigned"
        exit 0
    }

    $msg = "Signing tripwire: $($bad.Count) commit(s) with bad/untrusted signatures"
    Write-Output $msg
    foreach ($b in $bad) {
        Write-Output "  $($b.sha.Substring(0, 10)) $($b.gstatus) $($b.signer)"
        $rec = @{
            timestamp = (Get-Date).ToString('o')
            sha = $b.sha
            gstatus = $b.gstatus
            signer = $b.signer
        } | ConvertTo-Json -Compress
        Add-Content -Path $logFile -Value $rec -Encoding UTF8
    }

    if (Test-Path $notify) {
        try {
            & pwsh -NoProfile -File $notify -Title 'Signing tripwire TRIPPED' -Body $msg -Severity 'Critical' 2>&1 | Out-Null
        } catch {}
    }

    exit 1
}
finally { Pop-Location }
