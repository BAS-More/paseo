# sync-pull.ps1
#
# Phase 3 of docs/resilience-and-sync.md. Inbound leg of multi-PC sync.
# Runs every 5 minutes via ClaudeCode-SyncPull scheduled task, and once
# at SessionStart with -Quick (skip post-pull MCP restart, just pull).
#
# Strict gates (mirror Phase 2 outbound):
#   1. Only pulls when HEAD == main. Feature branch work-in-progress is
#      not disrupted.
#   2. Only pulls when working tree is clean. Uncommitted changes on main
#      are also work-in-progress (rare on main but possible for the dev
#      who is staging a manual commit).
#   3. --ff-only. Non-fast-forward = log + escalate via notify-avi; never
#      auto-merge or auto-rebase someone else's work.
#   4. Post-pull: regen manifest (the pre-commit hook handles it on the
#      pushing PC, but the receiving PC must regenerate locally because
#      ~/.claude.json may differ machine-to-machine).
#
# Exit 0 always (fail-open). Failure paths log + notify; never block
# session start.

[CmdletBinding()]
param(
    [switch]$Quick,
    [switch]$Silent
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoDir = "$env:USERPROFILE\.claude"
# Phase 4: per-PC log suffix so each PC writes its own file. Avoids merge
# conflicts on concurrent appends and lets cross-pc-status.ps1 enumerate
# each PC's heartbeat via git-tracked files.
$machineTag = $env:COMPUTERNAME
if ([string]::IsNullOrEmpty($machineTag)) { $machineTag = "unknown" }
$logPath = Join-Path $repoDir "_logs\sync-pull-$machineTag.jsonl"
$notifyAviScript = Join-Path $repoDir "scripts\notify-avi.ps1"

function Get-CurrentHeadSha {
    try {
        $sha = (& git rev-parse HEAD 2>$null).Trim()
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrEmpty($sha)) { return $sha }
    } catch {
        # ignore
    }
    return $null
}

function Write-SyncLog {
    param(
        [string]$Outcome,
        [string]$Message,
        [hashtable]$Extra = @{}
    )
    try {
        $logDir = Split-Path -Parent $logPath
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
        $entry = @{
            ts       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            machine  = $env:COMPUTERNAME
            username = $env:USERNAME
            outcome  = $Outcome
            message  = $Message
            quick    = [bool]$Quick
            head_sha = Get-CurrentHeadSha
        }
        foreach ($k in $Extra.Keys) { $entry[$k] = $Extra[$k] }
        Add-Content -Path $logPath -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
    } catch {
        # logging is best-effort
    }
    if (-not $Silent) {
        Write-Output "sync-pull [$Outcome]: $Message"
    }
}

function Notify-Avi {
    param([string]$Body, [string]$Severity = "warn")
    if (Test-Path $notifyAviScript) {
        try {
            & $notifyAviScript -Body $Body -Severity $Severity
        } catch {
            # ignore
        }
    }
}

Push-Location $repoDir
try {
    if (-not (Test-Path ".git")) {
        Write-SyncLog "skip" "no git repo"
        exit 0
    }

    # Strict gate 1: main only.
    $branch = (& git rev-parse --abbrev-ref HEAD 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($branch)) {
        Write-SyncLog "skip" "git rev-parse failed"
        exit 0
    }
    if ($branch -ne "main") {
        Write-SyncLog "skip" "on branch '$branch' (not main)"
        exit 0
    }

    # Strict gate 2: clean tree.
    $status = & git status --porcelain 2>$null
    if ($status) {
        Write-SyncLog "skip" "working tree dirty - manual commit pending"
        exit 0
    }

    $headBefore = (& git rev-parse HEAD 2>$null).Trim()

    # Fetch from all remotes; tolerate one failing as long as another
    # succeeds. List remotes from git config to stay portable across PCs.
    $remotes = & git remote 2>$null
    if (-not $remotes) {
        Write-SyncLog "skip" "no remotes configured"
        exit 0
    }
    $fetchOk = 0
    $fetchFail = 0
    $okRemotes = @()
    foreach ($remote in $remotes) {
        $r = $remote.Trim()
        if ([string]::IsNullOrEmpty($r)) { continue }
        # Retry 3x with backoff: 0s, 2s, 5s.
        $delays = @(0, 2, 5)
        $ok = $false
        foreach ($delay in $delays) {
            if ($delay -gt 0) { Start-Sleep -Seconds $delay }
            $null = & git fetch $r 2>&1
            if ($LASTEXITCODE -eq 0) { $ok = $true; break }
        }
        if ($ok) { $fetchOk++; $okRemotes += $r } else { $fetchFail++ }
    }
    if ($fetchOk -eq 0) {
        Write-SyncLog "fetch_fail" "all remotes unreachable" @{ remotes = $remotes -join "," }
        # Heartbeat ?status=stale would go here in Phase 7.
        exit 0
    }

    # Pull --ff-only from any remote that fetched successfully.
    # Try each in fetch order so a down primary doesn't strand the machine.
    $pullExit = 1
    $pullOut = ''
    $usedRemote = ''
    foreach ($candidate in $okRemotes) {
        $pullOut = & git pull --ff-only $candidate main 2>&1
        $pullExit = $LASTEXITCODE
        $usedRemote = $candidate
        if ($pullExit -eq 0) { break }
        Write-SyncLog "pull_retry" "ff-only pull from $candidate failed, trying next" @{ remote = $candidate }
    }
    if ($pullExit -ne 0) {
        $msg = "ff-only pull failed on all $($okRemotes.Count) reachable remote(s); last from ${usedRemote}: $pullOut"
        Write-SyncLog "ff_blocked" $msg @{ remotes = $okRemotes -join "," }
        Notify-Avi -Body "Sync-pull ff-only blocked on $env:COMPUTERNAME. Diverged history needs manual merge. See _logs/sync-pull.jsonl." -Severity "warn"
        exit 0
    }
    $primary = $usedRemote

    $headAfter = (& git rev-parse HEAD 2>$null).Trim()
    if ($headBefore -eq $headAfter) {
        Write-SyncLog "no_change" "already up-to-date" @{ sha = $headAfter }
        exit 0
    }

    $newCommits = & git rev-list --count "$headBefore..$headAfter" 2>$null
    Write-SyncLog "pulled" "fast-forward $newCommits commit$(if ($newCommits -eq 1) { '' } else { 's' })" @{
        from = $headBefore
        to   = $headAfter
        new_commits = [int]$newCommits
    }

    # Post-pull apply: regenerate manifest. The pre-commit hook on the
    # pushing PC already produced a valid mcp-manifest.json, but each PC
    # has its own ~/.claude.json so we regen locally.
    if (-not $Quick) {
        $sync = Join-Path $repoDir "scripts\manifest_sync.py"
        if (Test-Path $sync) {
            $python = $null
            foreach ($cmd in @("python", "python3", "py")) {
                $found = Get-Command $cmd -ErrorAction SilentlyContinue
                if ($found) { $python = $found.Source; break }
            }
            if ($python) {
                $regenOut = & $python $sync regen 2>&1
                if ($LASTEXITCODE -ne 0) {
                    Write-SyncLog "post_pull_validation_fail" "manifest regen failed: $regenOut" @{
                        action = "auto-revert"
                        sha = $headBefore
                    }
                    & git reset --hard $headBefore 2>&1 | Out-Null
                    Notify-Avi -Body "Sync-pull on $env:COMPUTERNAME pulled bad commits and auto-reverted. Manual investigation required." -Severity "error"
                    exit 0
                }
            }
        }
    }
} finally {
    Pop-Location
}

exit 0
