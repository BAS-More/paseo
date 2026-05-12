<#
.SYNOPSIS
  One-shot health sweep across every Claude Code tool Avi depends on.

.DESCRIPTION
  Runs every existing diagnostic script in sequence, aggregates the
  results, and writes:
    - plain output to stdout (one line per check)
    - structured JSON to ~/.claude/tool-health-status.json

  Consumed by the tool-health-monitor agent. Safe to run standalone.

  Exit codes:
    0 - all checks OK
    1 - one or more WARN
    2 - one or more FAIL
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$scriptsDir   = Join-Path $env:USERPROFILE '.claude\scripts'
$statusJson   = Join-Path $env:USERPROFILE '.claude\tool-health-status.json'

$results = @()

function Add-Result {
    param(
        [string]$Name,
        [ValidateSet('OK','WARN','FAIL','SKIP')][string]$Status,
        [string]$Detail
    )
    $script:results += [pscustomobject]@{
        name   = $Name
        status = $Status
        detail = $Detail
        ts     = (Get-Date).ToString('o')
    }
    $color = switch ($Status) {
        'OK'   { 'Green' }
        'WARN' { 'Yellow' }
        'FAIL' { 'Red' }
        'SKIP' { 'DarkGray' }
    }
    Write-Host ("[{0}] {1} - {2}" -f $Status, $Name, $Detail) -ForegroundColor $color
}

function Invoke-Check {
    param([string]$Name, [scriptblock]$Block)
    try {
        & $Block
    } catch {
        Add-Result -Name $Name -Status 'FAIL' -Detail ("exception: " + $_.Exception.Message)
    }
}

Write-Host ""
Write-Host "=== Tool Health Sweep ===" -ForegroundColor Cyan
Write-Host ("Date: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Host ""

# 1) MCP drift check
Invoke-Check -Name 'mcp-drift' -Block {
    $p = Join-Path $scriptsDir 'mcp-drift-check.ps1'
    if (-not (Test-Path $p)) {
        Add-Result -Name 'mcp-drift' -Status 'FAIL' -Detail "script missing: $p"
        return
    }
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $p 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        $line = ($out -split "`n" | Where-Object { $_ -match 'MCP servers resolvable' } | Select-Object -First 1).Trim()
        Add-Result -Name 'mcp-drift' -Status 'OK' -Detail ($line -replace '\s+', ' ')
    } else {
        $line = (($out -split "`n" | Where-Object { $_ -match '\[X\]' }) -join ' | ')
        Add-Result -Name 'mcp-drift' -Status 'FAIL' -Detail $line
    }
}

# 2) MCP server health (node_modules, entry points, context.db)
# Note: mcp-validate.ps1 is not run here to avoid duplicating coverage -
# health-runner.ps1 already invokes it directly. (Historical: mcp-validate
# previously had a broken args[0] heuristic that flagged any wrapper-command
# config; that was fixed in 2026 - see mcp-validate.ps1 header.)
Invoke-Check -Name 'mcp-health' -Block {
    $p = Join-Path $scriptsDir 'mcp-health.ps1'
    if (-not (Test-Path $p)) {
        Add-Result -Name 'mcp-health' -Status 'FAIL' -Detail "script missing: $p"
        return
    }
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $p 2>&1 | Out-String
    $okCount   = ([regex]::Matches($out, '\[OK\]')).Count
    $failCount = ([regex]::Matches($out, '\[FAIL\]')).Count
    $warnCount = ([regex]::Matches($out, '\[WARN\]')).Count
    if ($failCount -gt 0) {
        $detail = (($out -split "`n" | Where-Object { $_ -match '\[FAIL\]' }) -join ' | ').Trim()
        Add-Result -Name 'mcp-health' -Status 'FAIL' -Detail $detail
    } elseif ($warnCount -gt 0) {
        $detail = (($out -split "`n" | Where-Object { $_ -match '\[WARN\]' }) -join ' | ').Trim()
        Add-Result -Name 'mcp-health' -Status 'WARN' -Detail $detail
    } else {
        Add-Result -Name 'mcp-health' -Status 'OK' -Detail "$okCount components healthy"
    }
}

# 4) Hook integrity (SHA256 manifest)
Invoke-Check -Name 'hook-integrity' -Block {
    $p = Join-Path $scriptsDir 'hook-integrity.ps1'
    if (-not (Test-Path $p)) {
        Add-Result -Name 'hook-integrity' -Status 'FAIL' -Detail "script missing: $p"
        return
    }
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $p -Mode verify 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        $line = ($out -split "`n" | Where-Object { $_ -match 'Hook integrity OK|NO MANIFEST' } | Select-Object -First 1).Trim()
        if ($line -match 'NO MANIFEST') {
            Add-Result -Name 'hook-integrity' -Status 'WARN' -Detail 'no manifest yet - run hook-integrity.ps1 -Mode generate'
        } else {
            Add-Result -Name 'hook-integrity' -Status 'OK' -Detail $line
        }
    } else {
        $drift = (($out -split "`n" | Where-Object { $_ -match '\[MISSING\]|\[MODIFIED\]|\[NEW\]' }) -join ' | ').Trim()
        Add-Result -Name 'hook-integrity' -Status 'FAIL' -Detail $drift
    }
}

# 5) Claude proxy reachability
Invoke-Check -Name 'claude-proxy' -Block {
    try {
        $null = Invoke-WebRequest -Uri 'http://localhost:20128/v1/models' -Method GET -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        Add-Result -Name 'claude-proxy' -Status 'OK' -Detail 'reachable at localhost:20128'
    } catch {
        # 401/404 still means the service is up
        $msg = $_.Exception.Message
        if ($msg -match '401|403|404') {
            Add-Result -Name 'claude-proxy' -Status 'OK' -Detail ('reachable (auth-gated): ' + $msg)
        } else {
            Add-Result -Name 'claude-proxy' -Status 'FAIL' -Detail ('unreachable: ' + $msg)
        }
    }
}

# 6) Vault probe
Invoke-Check -Name 'vault' -Block {
    $vaultPy = 'C:\Dev\tools\vault\vault.py'
    if (-not (Test-Path $vaultPy)) {
        Add-Result -Name 'vault' -Status 'FAIL' -Detail "vault.py missing at $vaultPy"
        return
    }
    $out = & python $vaultPy list 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        $count = ([regex]::Matches($out, "\n")).Count
        Add-Result -Name 'vault' -Status 'OK' -Detail "list exit 0 ($count lines of output)"
    } else {
        Add-Result -Name 'vault' -Status 'FAIL' -Detail ('list exit ' + $LASTEXITCODE + ': ' + ($out.Trim()))
    }
}

# 7) Settings parse
Invoke-Check -Name 'settings-json' -Block {
    $settings = Join-Path $env:USERPROFILE '.claude\settings.json'
    if (-not (Test-Path $settings)) {
        Add-Result -Name 'settings-json' -Status 'FAIL' -Detail "missing: $settings"
        return
    }
    try {
        $null = Get-Content $settings -Raw | ConvertFrom-Json
        Add-Result -Name 'settings-json' -Status 'OK' -Detail 'parses as valid JSON'
    } catch {
        Add-Result -Name 'settings-json' -Status 'FAIL' -Detail ('parse error: ' + $_.Exception.Message)
    }
}

# 8) Claude.json parse
Invoke-Check -Name 'claude-json' -Block {
    $cj = Join-Path $env:USERPROFILE '.claude.json'
    if (-not (Test-Path $cj)) {
        Add-Result -Name 'claude-json' -Status 'WARN' -Detail "not present at $cj"
        return
    }
    try {
        $null = Get-Content $cj -Raw | ConvertFrom-Json
        Add-Result -Name 'claude-json' -Status 'OK' -Detail 'parses as valid JSON'
    } catch {
        Add-Result -Name 'claude-json' -Status 'FAIL' -Detail ('parse error: ' + $_.Exception.Message)
    }
}

# Summary (wrap with @() so StrictMode is happy on single-element results)
$okN   = @($results | Where-Object { $_.status -eq 'OK' }).Count
$warnN = @($results | Where-Object { $_.status -eq 'WARN' }).Count
$failN = @($results | Where-Object { $_.status -eq 'FAIL' }).Count
$skipN = @($results | Where-Object { $_.status -eq 'SKIP' }).Count

$overall = if ($failN -gt 0) { 'RED' } elseif ($warnN -gt 0) { 'YELLOW' } else { 'GREEN' }

Write-Host ""
Write-Host ("--- Overall: {0}  ({1} OK, {2} WARN, {3} FAIL, {4} SKIP) ---" -f $overall, $okN, $warnN, $failN, $skipN) -ForegroundColor Cyan

# Persist JSON
$payload = [pscustomobject]@{
    ts       = (Get-Date).ToString('o')
    overall  = $overall
    summary  = @{ ok = $okN; warn = $warnN; fail = $failN; skip = $skipN }
    results  = $results
}
$payload | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 $statusJson
Write-Host ("Status JSON: " + $statusJson)

if ($failN -gt 0) { exit 2 }
elseif ($warnN -gt 0) { exit 1 }
else { exit 0 }
