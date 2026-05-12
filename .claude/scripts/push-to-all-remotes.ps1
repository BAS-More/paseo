<#
.SYNOPSIS
  Push ~/.claude to every configured git remote.

.DESCRIPTION
  Redundancy: GitHub + Codeberg (or any additional remotes). The autocommit
  task pushes only to the default remote; this script fans out to all of them
  so a second provider is always in sync.

  On per-remote failure: log and continue — one remote down shouldn't block
  the others. Overall exit 0 if ≥1 remote succeeded, else 1.

.PARAMETER Branch
  Branch to push (default: main).
#>

[CmdletBinding()]
param([string]$Branch = 'main')

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

$repo = Join-Path $env:USERPROFILE '.claude'
$logDir = Join-Path $repo '_logs'
$log = Join-Path $logDir "push-all-$(Get-Date -Format 'yyyy-MM-dd').log"
New-Item -Path $logDir -ItemType Directory -Force | Out-Null

function Log($m) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $m"
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

Push-Location $repo
try {
    $remotes = & git remote
    if (-not $remotes) {
        Log 'No remotes configured.'
        exit 1
    }

    $ok = 0; $failed = 0
    foreach ($r in $remotes) {
        $r = $r.Trim()
        if (-not $r) { continue }
        Log "Pushing $r..."
        try {
            & git push $r $Branch 2>&1 | ForEach-Object { Log "  $_" }
            if ($LASTEXITCODE -eq 0) {
                Log "  OK: $r"
                $ok++
            } else {
                Log "  FAIL: $r (exit $LASTEXITCODE)"
                $failed++
            }
        } catch {
            Log "  FAIL: $r ($($_.Exception.Message))"
            $failed++
        }
    }

    Log "Summary: $ok ok, $failed failed"
    if ($ok -eq 0) { exit 1 } else { exit 0 }
}
finally { Pop-Location }
