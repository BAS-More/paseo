<#
.SYNOPSIS
  Rebuild Claude Code harness on a fresh Windows machine.

.DESCRIPTION
  Idempotent one-shot recovery. Steps:
    1. Verify prerequisites (git, node, python, npm, Claude Code).
    2. Clone ~/.claude from GitHub (claude-home-backup).
    3. Restore vault from encrypted OneDrive .vault file.
    4. Install MCP dependencies (npm global packages, python packages).
    5. Re-register MCPs in ~/.claude.json from mcp-manifest.json, resolving
       VAULT:<svc>/<key> sentinels against the restored vault.
    6. Re-register scheduled tasks (backup, health, vault, PR monitor).
    7. Run smoke test: mcp-health.ps1 + vault doctor + hook integrity.

  Safe to re-run. Existing files are not overwritten unless -Force.

.PARAMETER Force
  Overwrite existing config even if present.

.PARAMETER SkipTasks
  Skip scheduled-task registration (requires admin).

.PARAMETER GitRepo
  Override default backup repo URL.

.EXAMPLE
  # Fresh box, never had Claude Code before:
  pwsh -File bootstrap-from-scratch.ps1

.EXAMPLE
  # Partial recovery — only refresh MCP registrations:
  pwsh -File bootstrap-from-scratch.ps1 -Force -SkipTasks
#>

[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$SkipTasks,
    [string]$GitRepo = 'https://github.com/BAS-More/claude-home-backup.git'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$claudeDir = Join-Path $env:USERPROFILE '.claude'
$claudeCfg = Join-Path $env:USERPROFILE '.claude.json'
$log       = Join-Path $env:TEMP "claude-bootstrap-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

function Log($msg) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

function Require-Cmd($name, $installHint) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Missing prerequisite: $name. Install: $installHint" }
    Log "OK: $name -> $($cmd.Source)"
}

Log "Bootstrap starting. Log: $log"
Log "Target: $claudeDir"

# ────────────────────────────────────────────────────────────────────────
# Step 1: prerequisites
# ────────────────────────────────────────────────────────────────────────
Log 'Step 1/7: verifying prerequisites'
Require-Cmd 'git'    'winget install Git.Git'
Require-Cmd 'node'   'winget install OpenJS.NodeJS.LTS'
Require-Cmd 'npm'    '(bundled with Node)'
Require-Cmd 'python' 'winget install Python.Python.3.12'

$claudeCmd = Get-Command 'claude' -ErrorAction SilentlyContinue
if (-not $claudeCmd) {
    Log 'WARN: claude CLI not found. Install via: npm install -g @anthropic-ai/claude-code'
}

# ────────────────────────────────────────────────────────────────────────
# Step 2: clone ~/.claude
# ────────────────────────────────────────────────────────────────────────
Log 'Step 2/7: restoring ~/.claude'
if (Test-Path (Join-Path $claudeDir '.git')) {
    Log '  .git present — pulling latest'
    Push-Location $claudeDir
    try { & git pull --ff-only 2>&1 | ForEach-Object { Log "    $_" } } finally { Pop-Location }
} elseif (Test-Path $claudeDir) {
    if (-not $Force) {
        throw "~/.claude exists but is not a git repo. Re-run with -Force to overwrite, or manually `git init` it."
    }
    $bak = "$claudeDir.pre-bootstrap-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Log "  moving existing dir -> $bak"
    Move-Item $claudeDir $bak
    & git clone $GitRepo $claudeDir 2>&1 | ForEach-Object { Log "    $_" }
} else {
    Log "  cloning $GitRepo"
    & git clone $GitRepo $claudeDir 2>&1 | ForEach-Object { Log "    $_" }
}

# Wire tracked hooks (workaround for con #2 — .git/hooks/ not tracked)
Push-Location $claudeDir
try {
    & git config core.hooksPath .githooks 2>&1 | Out-Null
    Log '  set core.hooksPath = .githooks'
    # Bash needs +x bit on Windows hooks too for git-for-windows to exec them
    foreach ($h in @('pre-commit', 'pre-push')) {
        $hp = Join-Path $claudeDir ".githooks\$h"
        if (Test-Path $hp) {
            & git update-index --chmod=+x ".githooks/$h" 2>&1 | Out-Null
        }
    }
} finally { Pop-Location }

# ────────────────────────────────────────────────────────────────────────
# Step 3: restore vault
# ────────────────────────────────────────────────────────────────────────
Log 'Step 3/7: restoring vault'
$vaultBackup = Join-Path ($env:OneDrive ?? (Join-Path $env:USERPROFILE 'OneDrive')) 'ClaudeVault\vault.sync'
$vaultScript = 'C:\Dev\tools\vault\vault_backup.py'
if (Test-Path $vaultBackup) {
    if (Test-Path $vaultScript) {
        Log "  restoring from $vaultBackup"
        & python $vaultScript restore $vaultBackup 2>&1 | ForEach-Object { Log "    $_" }
    } else {
        Log "  WARN: vault_backup.py missing at $vaultScript — clone C:/Dev/tools/vault first"
    }
} else {
    Log "  WARN: no vault backup at $vaultBackup — vault will be empty until re-populated"
}

# ────────────────────────────────────────────────────────────────────────
# Step 4: install MCP dependencies
# ────────────────────────────────────────────────────────────────────────
Log 'Step 4/7: installing MCP dependencies'
$globalNpm = @(
    '@anthropic-ai/claude-code',
    '@upstash/context7-mcp',
    '@modelcontextprotocol/server-filesystem',
    '@playwright/mcp',
    '@modelcontextprotocol/server-sequential-thinking'
)
foreach ($pkg in $globalNpm) {
    Log "  npm i -g $pkg"
    & npm install -g $pkg 2>&1 | Select-Object -Last 3 | ForEach-Object { Log "    $_" }
}

Log '  pip install keyring cryptography'
& python -m pip install --user keyring cryptography 2>&1 | Select-Object -Last 3 | ForEach-Object { Log "    $_" }

# ────────────────────────────────────────────────────────────────────────
# Step 5: materialise ~/.claude.json from manifest
# ────────────────────────────────────────────────────────────────────────
Log 'Step 5/7: materialising ~/.claude.json from manifest'
$manifestPath = Join-Path $claudeDir 'mcp-manifest.json'
if (-not (Test-Path $manifestPath)) {
    throw "Missing manifest: $manifestPath. Run regenerate-mcp-manifest.ps1 on source machine."
}

$materialiseScript = Join-Path $claudeDir 'scripts\materialise-claude-json.py'
if (Test-Path $materialiseScript) {
    & python $materialiseScript --manifest $manifestPath --out $claudeCfg 2>&1 | ForEach-Object { Log "    $_" }
} else {
    Log "  WARN: materialise-claude-json.py missing. Will restore .claude.json from OneDrive copy instead."
    $oneDriveCfg = Join-Path ($env:OneDrive ?? (Join-Path $env:USERPROFILE 'OneDrive')) 'ClaudeCodeBackup\.claude.json'
    if (Test-Path $oneDriveCfg) {
        Copy-Item $oneDriveCfg $claudeCfg -Force
        Log "  copied $oneDriveCfg -> $claudeCfg"
    } else {
        Log "  ERROR: no materialise script and no OneDrive fallback. Manual recovery needed."
    }
}

# ────────────────────────────────────────────────────────────────────────
# Step 6: register scheduled tasks
# ────────────────────────────────────────────────────────────────────────
Log 'Step 6/7: scheduled tasks'
if ($SkipTasks) {
    Log '  -SkipTasks given, skipping'
} else {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Log '  WARN: not admin. Re-run elevated to install scheduled tasks, or:'
        Log "        pwsh -File $claudeDir\scripts\register-backup-task.ps1 (as admin)"
    } else {
        foreach ($s in @('register-backup-task.ps1', 'register-health-monitor-task.ps1', 'register-pr-health-task.ps1')) {
            $p = Join-Path $claudeDir "scripts\$s"
            if (Test-Path $p) {
                Log "  running $s"
                & pwsh -File $p 2>&1 | Select-Object -Last 5 | ForEach-Object { Log "    $_" }
            }
        }
    }
}

# ────────────────────────────────────────────────────────────────────────
# Step 7: smoke test
# ────────────────────────────────────────────────────────────────────────
Log 'Step 7/7: smoke test'
$health = Join-Path $claudeDir 'scripts\mcp-health.ps1'
if (Test-Path $health) {
    Log '  MCP health'
    & pwsh -File $health 2>&1 | Select-Object -Last 10 | ForEach-Object { Log "    $_" }
}
$doctor = 'C:\Dev\tools\vault\vault_doctor.py'
if (Test-Path $doctor) {
    Log '  vault doctor'
    & python $doctor 2>&1 | Select-Object -Last 10 | ForEach-Object { Log "    $_" }
}
$integrity = Join-Path $claudeDir 'scripts\hook-integrity.ps1'
if (Test-Path $integrity) {
    Log '  hook integrity'
    & pwsh -File $integrity 2>&1 | Select-Object -Last 10 | ForEach-Object { Log "    $_" }
}

Log 'Bootstrap complete. Review log for any WARN/ERROR.'
Log "Log: $log"
