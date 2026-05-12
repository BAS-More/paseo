# git-autocommit-claude.ps1
# Scheduled: auto-commit .claude/ changes to local git repo.
# No remote push by default (local history only).
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoDir = "C:\Users\Avi Bendetsky\.claude"
Push-Location $repoDir
try {
    if (-not (Test-Path ".git")) {
        Write-Output "No git repo at $repoDir — skipping"
        exit 0
    }

    $status = & git status --porcelain 2>$null
    if (-not $status) {
        Write-Output "No changes to commit."
        exit 0
    }

    # Git hooks print to stderr. Under StrictMode+Stop this trips PowerShell
    # even when git exits 0, so isolate the native calls with Continue.
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $msg = "Auto-commit $ts"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & git add -A *>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "git add failed (exit $LASTEXITCODE)" }
        & git commit -m $msg *>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "git commit failed (exit $LASTEXITCODE)" }
    } finally {
        $ErrorActionPreference = $prev
    }
    Write-Output "Committed: $msg ($(($status -split "`n").Count) files changed)"

    # Push to every configured remote (GitHub + Codeberg + whatever else)
    $pushAll = Join-Path $repoDir 'scripts\push-to-all-remotes.ps1'
    if (Test-Path $pushAll) {
        try {
            & pwsh -NoProfile -File $pushAll -Branch main 2>&1 | Out-Null
            Write-Output "Pushed to all remotes."
        } catch {
            Write-Output "Multi-remote push failed (non-fatal): $_"
        }
    }
} finally {
    Pop-Location
}
