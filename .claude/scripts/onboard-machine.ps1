# onboard-machine.ps1
#
# Phase 8 of docs/resilience-and-sync.md. End-to-end bootstrap for a new
# PC (or re-bootstrap of an existing PC after corruption).
#
# Idempotent: each step checks state before mutating. Safe to re-run.
#
# Steps:
#   1. Verify prerequisites (Git, PS, Node, Python versions).
#   2. Clone ~/.claude from codeberg (fallback: github).
#   3. Configure git: core.hooksPath, signing key path (if vault has it).
#   4. Run onboard-machine-id.ps1 to write machine-id.json.
#   5. Run materialise-claude-json.py to render ~/.claude.json from
#      mcp-manifest.json (uses CLAUDE_VAULT_CLI for vault sentinels).
#   6. Run sync-pull.ps1 -Quick (first inbound sync).
#   7. Run portability-codemod.py --check (sanity).
#   8. Run healthchecks-heartbeat.ps1 (logs "not_configured" until UUID
#      is set; fine for first boot).
#   9. List the scheduled tasks the admin must register next.
#
# Non-admin steps run as the user. The scheduled-task registration is
# called out at the end with the exact admin-elevation incantation.
#
# This script does NOT install Git, Node, Python — those are PC-level
# decisions (which version, where). It tells you what to install if
# missing and exits 1.

[CmdletBinding()]
param(
    [string]$DisplayName = "",
    [switch]$SkipClone,
    [switch]$SkipMaterialise
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ClaudeHome  = "$env:USERPROFILE\.claude"
$RepoCodeberg = "git@codeberg.org:avi770/claude-home-backup.git"
$RepoGithub   = "https://github.com/BAS-More/claude-home-backup.git"

function Step {
    param([int]$N, [string]$Title)
    Write-Output ""
    Write-Output "[$N] $Title"
    Write-Output ("-" * 60)
}

function Test-Cmd {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# ---- 1. Prerequisites ----------------------------------------------------
Step 1 "Verify prerequisites"

$missing = @()
if (-not (Test-Cmd git))    { $missing += "git" }
if (-not (Test-Cmd node))   { $missing += "node (>= 20)" }
$python = $null
foreach ($cmd in @("python", "python3", "py")) {
    if (Test-Cmd $cmd) { $python = $cmd; break }
}
if (-not $python) { $missing += "python (>= 3.11)" }

if ($missing.Count -gt 0) {
    Write-Output "MISSING:"
    $missing | ForEach-Object { Write-Output "  - $_" }
    Write-Output ""
    Write-Output "Install via winget / choco / direct download, then re-run."
    exit 1
}

# Version checks (warnings only).
$nodeVer = (& node --version 2>$null).TrimStart("v")
$pyVer = (& $python --version 2>$null) -replace "Python\s+",""
$gitVer = ((& git --version 2>$null) -split "\s+")[2]

Write-Output "  git    : $gitVer"
Write-Output "  node   : $nodeVer"
Write-Output "  python : $pyVer ($python)"
Write-Output "  pwsh   : $($PSVersionTable.PSVersion)"

# ---- 2. Clone repo -------------------------------------------------------
Step 2 "Clone or verify ~/.claude repo"

if (Test-Path "$ClaudeHome\.git") {
    Write-Output "  Repo already present at $ClaudeHome - skipping clone."
} elseif ($SkipClone) {
    Write-Output "  -SkipClone given - assuming repo is checked out elsewhere."
} else {
    if (Test-Path $ClaudeHome) {
        Write-Output "  $ClaudeHome exists but is not a git repo."
        Write-Output "  Move it aside first: Rename-Item '$ClaudeHome' '$ClaudeHome.pre-onboard'"
        exit 1
    }
    Write-Output "  Cloning from codeberg..."
    & git clone $RepoCodeberg $ClaudeHome
    if ($LASTEXITCODE -ne 0) {
        Write-Output "  codeberg clone failed; trying github fallback..."
        & git clone $RepoGithub $ClaudeHome
        if ($LASTEXITCODE -ne 0) {
            Write-Output "  Both clones failed. Check network + SSH keys + vault credentials."
            exit 1
        }
    }
}

Push-Location $ClaudeHome
try {
    # ---- 3. Git config ---------------------------------------------------
    Step 3 "Configure git"
    & git config --local core.hooksPath ".githooks"
    Write-Output "  core.hooksPath = .githooks"

    $signingKey = "$env:USERPROFILE\.ssh\id_ed25519.pub"
    if (Test-Path $signingKey) {
        & git config --local user.signingkey $signingKey
        & git config --local commit.gpgsign true
        & git config --local gpg.format ssh
        Write-Output "  signing key set: $signingKey"
    } else {
        Write-Output "  WARN: $signingKey not found - signed commits disabled."
        Write-Output "        Generate via: ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519"
    }

    # ---- 4. Machine-id ---------------------------------------------------
    Step 4 "Write machine-id.json"
    if ([string]::IsNullOrEmpty($DisplayName)) {
        $args = @()
    } else {
        $args = @("-DisplayName", $DisplayName)
    }
    & "$ClaudeHome\scripts\onboard-machine-id.ps1" @args

    # ---- 5. Materialise ~/.claude.json -----------------------------------
    Step 5 "Materialise ~/.claude.json"
    if ($SkipMaterialise) {
        Write-Output "  -SkipMaterialise given - skipping."
    } else {
        $manifest = Join-Path $ClaudeHome "mcp-manifest.json"
        $target   = "$env:USERPROFILE\.claude.json"
        $script   = Join-Path $ClaudeHome "scripts\materialise-claude-json.py"
        if (-not (Test-Path $manifest)) {
            Write-Output "  WARN: $manifest missing - skipping."
        } elseif (-not (Test-Path $script)) {
            Write-Output "  WARN: $script missing - skipping."
        } else {
            & $python $script --manifest $manifest --out $target
            if ($LASTEXITCODE -ne 0) {
                Write-Output "  ERROR: materialise failed - manual fix required before continuing."
            }
        }
    }

    # ---- 6. First sync-pull ----------------------------------------------
    Step 6 "First sync-pull"
    & "$ClaudeHome\scripts\sync-pull.ps1" -Quick

    # ---- 7. Portability sanity -------------------------------------------
    Step 7 "Portability sanity check"
    $codemod = Join-Path $ClaudeHome "scripts\portability-codemod.py"
    if (Test-Path $codemod) {
        & $python $codemod --check
        if ($LASTEXITCODE -ne 0) {
            Write-Output "  WARN: portability drift on this PC - investigate via:"
            Write-Output "        python $codemod"
        }
    }

    # ---- 8. Heartbeat dry-run --------------------------------------------
    Step 8 "Heartbeat dry-run"
    & "$ClaudeHome\scripts\healthchecks-heartbeat.ps1"

    # ---- 9. Admin tasks --------------------------------------------------
    Step 9 "Admin scheduled tasks (run as Administrator)"
    Write-Output ""
    Write-Output "  These registrars require admin privileges. Open an"
    Write-Output "  elevated PowerShell and run:"
    Write-Output ""
    Write-Output "    cd $ClaudeHome\scripts"
    Write-Output "    .\register-mcp-drift-task.ps1"
    Write-Output "    .\register-mcp-watchdog-task.ps1"
    Write-Output "    .\register-portability-drift-task.ps1"
    Write-Output "    .\register-sync-pull-task.ps1"
    Write-Output "    .\register-healthchecks-task.ps1"
    Write-Output "    .\register-backup-task.ps1"
    Write-Output "    .\register-pr-health-task.ps1  # if Avi-Bendetsky/BAS-More repos in use"
    Write-Output ""
    Write-Output "  After register-healthchecks-task.ps1, set the UUID:"
    Write-Output "    .\healthchecks-heartbeat.ps1 -SetUuid <UUID-FROM-HEALTHCHECKS-IO>"
    Write-Output ""

} finally {
    Pop-Location
}

Write-Output "==============================================================="
Write-Output "Onboarding finished for $env:COMPUTERNAME."
Write-Output "Review with: powershell.exe -File scripts\cross-pc-status.ps1"
Write-Output "==============================================================="
