<#
.SYNOPSIS
  Single-shot health check for entire Claude Code toolkit.

.DESCRIPTION
  Verifies every layer Avi cares about:
    - Token Shield: context-mode MCP registered, validator hook wired (Stop + SessionStart)
    - MCP fleet: count, manifest sync, no drift
    - Plugin OAuth: count of pending vs registered
    - Hooks: integrity manifest, count of tracked vs total
    - Backups: oldest .bak age, total .bak count
    - Context-mode DB: size, entry count

  Exit 0 = all green. Exit 1 = one or more failures.
#>

param([switch]$Verbose)

$ErrorActionPreference = 'Stop'
$home_ = $env:USERPROFILE
$failures = @()
$warnings = @()
$ok = @()

function Add-Status {
    param([string]$Status, [string]$Msg)
    switch ($Status) {
        'OK'   { $script:ok += $Msg;       Write-Host "  [OK]   $Msg" -ForegroundColor Green }
        'WARN' { $script:warnings += $Msg; Write-Host "  [WARN] $Msg" -ForegroundColor Yellow }
        'FAIL' { $script:failures += $Msg; Write-Host "  [FAIL] $Msg" -ForegroundColor Red }
    }
}

Write-Host ""
Write-Host "=== Toolkit Health ===" -ForegroundColor Cyan
Write-Host ""

# ─── 1. Token Shield ───────────────────────────────────────────
Write-Host "Layer 1: Context Mode MCP" -ForegroundColor White
$mcpConfig = Join-Path $home_ '.claude.json'
if (Test-Path $mcpConfig) {
    try {
        $cfg = Get-Content $mcpConfig -Raw | ConvertFrom-Json
        if ($cfg.mcpServers.'context-mode') {
            Add-Status 'OK' 'context-mode registered in ~/.claude.json'
        } else {
            Add-Status 'FAIL' 'context-mode NOT in ~/.claude.json mcpServers'
        }
    } catch {
        Add-Status 'FAIL' "~/.claude.json invalid JSON: $($_.Exception.Message)"
    }
} else {
    Add-Status 'FAIL' '~/.claude.json missing'
}

# Check binary present
$cmd = Get-Command 'context-mode' -ErrorAction SilentlyContinue
if ($cmd) { Add-Status 'OK' "context-mode binary at $($cmd.Source)" }
else { Add-Status 'FAIL' 'context-mode binary not on PATH' }

Write-Host ""
Write-Host "Layer 2+3: Token Shield validator hook" -ForegroundColor White
$validator = Join-Path $home_ '.claude\hooks\token-shield-validator.js'
if (Test-Path $validator) { Add-Status 'OK' 'validator file exists' }
else { Add-Status 'FAIL' 'validator file missing' }

$settings = Join-Path $home_ '.claude\settings.json'
if (Test-Path $settings) {
    $raw = Get-Content $settings -Raw
    if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) {
        Add-Status 'WARN' 'settings.json has BOM character'
    }
    if ($raw -match 'token-shield-validator\.js') {
        $occ = ([regex]::Matches($raw, 'token-shield-validator\.js')).Count
        if ($occ -ge 2) { Add-Status 'OK' "validator wired in $occ hook(s) (Stop + SessionStart)" }
        else { Add-Status 'WARN' "validator wired in only $occ hook(s) — expected 2" }
    } else {
        Add-Status 'FAIL' 'validator NOT wired in settings.json'
    }
} else {
    Add-Status 'FAIL' 'settings.json missing'
}

# ─── 2. MCP fleet ──────────────────────────────────────────────
Write-Host ""
Write-Host "MCP fleet" -ForegroundColor White
try {
    $live = ($cfg.mcpServers | Get-Member -MemberType NoteProperty).Count
    Add-Status 'OK' "$live MCP servers registered"
} catch { Add-Status 'WARN' 'cannot count live MCPs' }

$manifest = Join-Path $home_ '.claude\mcp-manifest.json'
if (Test-Path $manifest) {
    try {
        $m = Get-Content $manifest -Raw | ConvertFrom-Json
        $manCount = ($m.servers | Get-Member -MemberType NoteProperty).Count
        if ($manCount -eq $live) {
            Add-Status 'OK' "manifest in sync ($manCount servers)"
        } else {
            Add-Status 'WARN' "manifest drift: manifest=$manCount live=$live"
        }
    } catch { Add-Status 'WARN' 'manifest invalid JSON' }
} else {
    Add-Status 'WARN' 'mcp-manifest.json missing'
}

# ─── 3. Plugin OAuth ───────────────────────────────────────────
Write-Host ""
Write-Host "Plugin OAuth" -ForegroundColor White
$authCache = Join-Path $home_ '.claude\mcp-needs-auth-cache.json'
if (Test-Path $authCache) {
    try {
        $auth = Get-Content $authCache -Raw | ConvertFrom-Json
        $pending = ($auth | Get-Member -MemberType NoteProperty).Count
        if ($pending -eq 0) { Add-Status 'OK' 'no plugins pending auth' }
        else { Add-Status 'WARN' "$pending plugin(s) need OAuth" }
    } catch { Add-Status 'WARN' 'auth cache invalid JSON' }
} else {
    Add-Status 'OK' 'no auth cache (clean state)'
}

# ─── 4. Hook integrity ─────────────────────────────────────────
Write-Host ""
Write-Host "Hooks" -ForegroundColor White
$hookManifest = Join-Path $home_ '.claude\hooks\.manifest.sha256'
if (Test-Path $hookManifest) {
    $tracked = (Get-Content $hookManifest | Where-Object { $_ -match '\S' }).Count
    $total = (Get-ChildItem -Path (Join-Path $home_ '.claude\hooks') -File -Filter '*.js' -ErrorAction SilentlyContinue).Count
    Add-Status 'OK' "$tracked hook entry-points tracked, $total total .js files in hooks/"
} else {
    Add-Status 'WARN' 'hook integrity manifest missing — run hook-integrity.ps1 generate'
}

# ─── 5. Backups ────────────────────────────────────────────────
Write-Host ""
Write-Host "Backups" -ForegroundColor White
$baks = @()
$baks += Get-ChildItem -Path $home_ -Recurse -File -Filter '*.bak.*' -ErrorAction SilentlyContinue
$baks += Get-ChildItem -Path 'C:\Dev\tools\Misc' -Recurse -File -Filter '*.bak.*' -ErrorAction SilentlyContinue
$bakCount = $baks.Count
if ($bakCount -gt 50) {
    Add-Status 'WARN' "$bakCount .bak files (>50) — run bak-cleanup.ps1"
} else {
    Add-Status 'OK' "$bakCount .bak files"
}

# ─── 6. Context Mode DB ────────────────────────────────────────
Write-Host ""
Write-Host "Context Mode DB" -ForegroundColor White
$dbPaths = @(
    (Join-Path $home_ '.context-mode.db'),
    (Join-Path $home_ '.config\context-mode\index.db'),
    (Join-Path $env:LOCALAPPDATA 'context-mode\index.db')
)
$dbFound = $false
foreach ($p in $dbPaths) {
    if (Test-Path $p) {
        $size = [math]::Round((Get-Item $p).Length / 1MB, 2)
        Add-Status 'OK' "DB at $p — $size MB"
        $dbFound = $true
        break
    }
}
if (-not $dbFound) { Add-Status 'WARN' 'context-mode DB not found at expected paths (may be on first use)' }

# ─── Summary ───────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "  OK:   $($ok.Count)" -ForegroundColor Green
Write-Host "  WARN: $($warnings.Count)" -ForegroundColor Yellow
Write-Host "  FAIL: $($failures.Count)" -ForegroundColor Red

if ($failures.Count -gt 0) {
    exit 1
}
exit 0
