<#
.SYNOPSIS
  One-shot finaliser once Codeberg account + SSH key + private repo exist.

.DESCRIPTION
  Run after manual Codeberg setup steps 1-3 in docs/SECOND-REMOTE-SETUP.md.
  Prints current SSH pubkey (for copy-paste to Codeberg SSH settings),
  adds `codeberg` remote, runs first push, and verifies multi-remote is wired.

.PARAMETER CodebergUser
  Your Codeberg username (required).

.PARAMETER RepoName
  Repo name on Codeberg (default: claude-home-backup).

.EXAMPLE
  pwsh -File codeberg-finalise.ps1 -CodebergUser Avi-Bendetsky
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CodebergUser,
    [string]$RepoName = 'claude-home-backup'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$claudeRepo = Join-Path $env:USERPROFILE '.claude'
$pubKey = Join-Path $env:USERPROFILE '.ssh\id_ed25519.pub'
$remoteUrl = "git@codeberg.org:$CodebergUser/$RepoName.git"

# 0. Sanity
if (-not (Test-Path $claudeRepo)) { throw "Missing: $claudeRepo" }
if (-not (Test-Path $pubKey))     { throw "Missing: $pubKey — generate with ssh-keygen first" }

# 1. Print pubkey (helps paste into Codeberg if not already done)
Write-Output ''
Write-Output '─── SSH PUBLIC KEY (paste into Codeberg → Settings → SSH/GPG keys → Add key) ───'
Get-Content $pubKey
Write-Output '────────────────────────────────────────────────────────────────────────────────'
Write-Output ''

# 2. Add remote (idempotent)
Push-Location $claudeRepo
try {
    $existing = & git remote
    if ('codeberg' -in $existing) {
        $currentUrl = (& git remote get-url codeberg).Trim()
        if ($currentUrl -ne $remoteUrl) {
            & git remote set-url codeberg $remoteUrl
            Write-Output "Updated codeberg URL: $currentUrl -> $remoteUrl"
        } else {
            Write-Output "codeberg remote already configured: $remoteUrl"
        }
    } else {
        & git remote add codeberg $remoteUrl
        Write-Output "Added codeberg remote: $remoteUrl"
    }

    # 3. Verify reachability before push (avoids hanging on unknown host)
    Write-Output 'Probing codeberg.org SSH...'
    $probe = & ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -T git@codeberg.org 2>&1
    if ($probe -match 'Hi there') {
        Write-Output "  SSH probe OK"
    } else {
        Write-Output "  SSH probe output: $probe"
        Write-Output "  If this shows 'Permission denied', you haven't added the pubkey to Codeberg yet — do that first."
    }

    # 4. Push
    Write-Output 'Pushing main to codeberg (this takes a minute on first push)...'
    & git push -u codeberg main 2>&1 | ForEach-Object { Write-Output "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "First push failed (exit $LASTEXITCODE)" }

    # 5. Verify fan-out
    Write-Output ''
    Write-Output '─── Remote status ───'
    & git remote -v
    Write-Output ''

    Write-Output 'Done. Next auto-commit (within 30 min) will push to GitHub AND Codeberg.'
}
finally { Pop-Location }
