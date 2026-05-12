# git-autocommit-claude.ps1
#
# Scheduled: auto-commit ~/.claude/ changes to local git, then push to all
# remotes. Runs every 30 minutes via ClaudeCode-Git-AutoCommit scheduled task.
#
# Phase 2 of docs/resilience-and-sync.md. The strict gate model:
#
#   1. Only auto-commits when HEAD == main. If a feature branch is checked
#      out, the dev's work-in-progress is not hijacked into auto-commits.
#   2. Pre-commit hook (.githooks/pre-commit) validates manifest sync and
#      drift before any commit lands. This script does not bypass it.
#   3. Portability codemod --check runs before staging. Drift = abort and
#      escalate via notify-avi (the normal hook chain doesn't run because
#      we never reached `git commit`).
#   4. Push to all remotes via push-to-all-remotes.ps1; failure logs but
#      doesn't roll back the local commit (eventual consistency).
#
# All output goes to scripts/.git-autocommit.log + stdout when run
# interactively. Exits non-zero only on unexpected failures (network is OK).

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoDir = "$env:USERPROFILE\.claude"
$logPath = Join-Path $repoDir "_logs\git-autocommit.log"
$notifyAviScript = Join-Path $repoDir "scripts\notify-avi.ps1"

function Write-Log {
    param([string]$Message, [string]$Severity = "info")
    $ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $line = "[$ts] [$Severity] $Message"
    try {
        $logDir = Split-Path -Parent $logPath
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
        Add-Content -Path $logPath -Value $line -Encoding UTF8
    } catch {
        # log dir unavailable - not fatal
    }
    Write-Output $line
}

function Notify-Avi {
    param([string]$Body, [string]$Severity = "warn")
    if (Test-Path $notifyAviScript) {
        try {
            & $notifyAviScript -Body $Body -Severity $Severity
        } catch {
            Write-Log "notify-avi failed: $_" "warn"
        }
    }
}

Push-Location $repoDir
try {
    if (-not (Test-Path ".git")) {
        Write-Log "No git repo at $repoDir - skipping" "warn"
        exit 0
    }

    # Strict gate 1: only auto-commit on main. If on any feature branch,
    # leave it alone - the dev is mid-work.
    $branch = (& git rev-parse --abbrev-ref HEAD 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($branch)) {
        Write-Log "git rev-parse failed (detached HEAD?) - skipping" "warn"
        exit 0
    }
    if ($branch -ne "main") {
        Write-Log "On branch '$branch' (not main) - skipping auto-commit" "info"
        exit 0
    }

    # Cheap exit if no changes.
    $status = & git status --porcelain 2>$null
    if (-not $status) {
        Write-Log "No changes to commit." "info"
        exit 0
    }

    # Strict gate 2: codemod drift check. We MUST NOT auto-commit drift
    # (the SessionStart hook would re-trigger and pollute future sessions).
    $codemodScript = Join-Path $repoDir "scripts\portability-codemod.py"
    if (Test-Path $codemodScript) {
        $python = $null
        foreach ($cmd in @("python", "python3", "py")) {
            $found = Get-Command $cmd -ErrorAction SilentlyContinue
            if ($found) { $python = $found.Source; break }
        }
        if ($python) {
            $codemodOut = & $python $codemodScript --check 2>&1
            if ($LASTEXITCODE -ne 0) {
                $msg = "auto-commit aborted: portability drift detected. Output: $codemodOut"
                Write-Log $msg "error"
                Notify-Avi -Body "Auto-commit aborted on $env:COMPUTERNAME - portability drift. Run portability-codemod.py to inspect." -Severity "warn"
                exit 0
            }
        } else {
            Write-Log "python not found - skipping codemod gate (proceeding with caution)" "warn"
        }
    }

    # Stage everything and commit. The .githooks/pre-commit chain runs
    # automatically (manifest sync, JSON validity, etc.) and aborts on
    # failure.
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $msg = "Auto-commit $ts"

    # Git hooks print to stderr; under StrictMode+Stop this trips PowerShell
    # even when git exits 0. Isolate native calls with Continue.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & git add -A *>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "git add failed (exit $LASTEXITCODE)" }
        $commitOut = & git commit -m $msg 2>&1
        if ($LASTEXITCODE -ne 0) {
            # Pre-commit hook failure (manifest broken, schema invalid, etc.)
            # is the most likely cause. Don't loop - escalate.
            $msg = "auto-commit failed (exit $LASTEXITCODE): $commitOut"
            Write-Log $msg "error"
            Notify-Avi -Body "Auto-commit on $env:COMPUTERNAME failed pre-commit gate. Inspect _logs/git-autocommit.log." -Severity "warn"
            exit 0
        }
    } finally {
        $ErrorActionPreference = $prev
    }

    $fileCount = ($status -split "`n" | Where-Object { $_ }).Count
    $plural = if ($fileCount -eq 1) { "" } else { "s" }
    Write-Log "Committed: $msg ($fileCount file$plural changed)" "info"

    # Push to every configured remote.
    $pushAll = Join-Path $repoDir "scripts\push-to-all-remotes.ps1"
    if (Test-Path $pushAll) {
        try {
            & pwsh -NoProfile -File $pushAll -Branch main 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Log "Pushed to all remotes." "info"
            } else {
                Write-Log "Multi-remote push exited $LASTEXITCODE (non-fatal - local commit retained)" "warn"
            }
        } catch {
            Write-Log "Multi-remote push raised: $_ (non-fatal)" "warn"
        }
    } else {
        Write-Log "push-to-all-remotes.ps1 missing - local commit only" "warn"
    }
} finally {
    Pop-Location
}
