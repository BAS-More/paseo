# mcp-validate.ps1 - Validate MCP server configuration in .claude.json
# Usage: powershell -ExecutionPolicy Bypass -File mcp-validate.ps1 [-DryRun]
#
# Checks each entry in $env:USERPROFILE\.claude.json mcpServers for:
#   - parseable JSON
#   - well-formed shape (type, command, args)
#   - if a script/binary file path is referenced anywhere in command+args,
#     that file exists on disk
#
# Wrapper-command configs (`cmd /c npx ...`, `powershell -NoProfile -File X`,
# `uvx --from ...`, npm-scoped packages) are correctly handled: the script
# walks command + args and validates only items that look like real disk
# script/binary paths (recognised script/binary file extension). Wrapper
# invocations with no on-disk script (npx packages, PATH-resolved CLIs)
# report [INFO], not [FAIL].
#
# Exit codes:
#   0 - valid (or only INFO/WARN)
#   1 - JSON parse error, missing config, or one or more [FAIL] entries

param([switch]$DryRun)

$ErrorActionPreference = "Stop"

Write-Host "`n=== MCP Config Validation ===" -ForegroundColor Cyan

$configPath = Join-Path $env:USERPROFILE ".claude.json"

if (-not (Test-Path $configPath)) {
    Write-Host "[FAIL] Config not found: $configPath" -ForegroundColor Red
    exit 1
}

try {
    $raw = Get-Content $configPath -Raw
    $config = $raw | ConvertFrom-Json
    Write-Host "[OK] JSON parse successful" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] JSON parse error: $_" -ForegroundColor Red
    exit 1
}

if (-not $config.mcpServers) {
    Write-Host "[WARN] No mcpServers key found in config" -ForegroundColor Yellow
    exit 0
}

# Extensions that mark something as a real on-disk script or binary.
# Used to distinguish a path arg from an npm package, flag, or PATH-only command.
$script:ScriptExtensions = '\.(ps1|psm1|js|cjs|mjs|ts|py|pyw|exe|bat|cmd|sh|jar)$'

# Wrapper commands - their first positional arg is what gets executed,
# not the wrapper itself. Compared case-insensitive against both the full
# command string and its filename leaf.
$script:Wrappers = @(
    'cmd', 'cmd.exe',
    'powershell', 'powershell.exe',
    'pwsh', 'pwsh.exe',
    'npx', 'npx.cmd',
    'node', 'node.exe',
    'python', 'python.exe', 'python3', 'python3.exe',
    'uvx', 'uvx.exe',
    'bun', 'bun.exe',
    'deno', 'deno.exe'
)

function Test-IsWrapper {
    param([string]$Command)
    if (-not $Command) { return $false }
    $lower = $Command.ToLower()
    if ($script:Wrappers -contains $lower) { return $true }
    try {
        $leaf = [System.IO.Path]::GetFileName($Command).ToLower()
        if ($leaf -and ($script:Wrappers -contains $leaf)) { return $true }
    } catch {
        # Path parsing failure is fine - just means it's not a wrapper.
    }
    return $false
}

function Test-LooksLikeFilePath {
    param([string]$s)
    if (-not $s) { return $false }
    # Skip flags (-NoProfile, -y, /c, etc.)
    if ($s -match '^[-/]') { return $false }
    # Must end in a recognised script/binary extension. This is the simplest
    # rule that excludes npm scoped packages (@scope/pkg), bare directories
    # (C:\Dev), and PATH-only commands (knowledge-graph, context-mode) while
    # catching real .ps1/.js/.py/etc. references.
    return ($s -match $script:ScriptExtensions)
}

function Find-EntryPoint {
    param(
        [string]$Command,
        [object]$ServerArgs
    )
    # Returns one of:
    #   @{ Kind='file';    Path=<string> }    - validate via Test-Path
    #   @{ Kind='wrapped'; Path=$null }       - PATH/npx-style, no disk check
    #   @{ Kind='empty';   Path=$null }       - no command, malformed config

    if (-not $Command) {
        return [pscustomobject]@{ Kind = 'empty'; Path = $null }
    }

    $candidates = @()
    if (-not (Test-IsWrapper $Command)) {
        $candidates += $Command
    }
    if ($ServerArgs) {
        foreach ($a in $ServerArgs) { $candidates += [string]$a }
    }

    foreach ($c in $candidates) {
        if (Test-LooksLikeFilePath $c) {
            return [pscustomobject]@{ Kind = 'file'; Path = $c }
        }
    }

    return [pscustomobject]@{ Kind = 'wrapped'; Path = $null }
}

$servers = $config.mcpServers.PSObject.Properties
$issues  = @()
$okCount   = 0
$infoCount = 0
$warnCount = 0

foreach ($s in $servers) {
    $name = $s.Name
    $cfg  = $s.Value

    # Resolve effective type: if `type` is missing but `command` is set,
    # treat as stdio (matches configs where some entries omit `type`).
    $type = $cfg.type
    if (-not $type -and $cfg.command) { $type = 'stdio' }

    if ($type -eq 'http') {
        Write-Host "  [INFO] $name - HTTP server at $($cfg.url)" -ForegroundColor DarkGray
        $infoCount++
        continue
    }

    if ($type -ne 'stdio') {
        Write-Host "  [WARN] $name - unknown type: $($cfg.type)" -ForegroundColor Yellow
        $warnCount++
        continue
    }

    if (-not $cfg.command) {
        Write-Host "  [WARN] $name - stdio but no command defined" -ForegroundColor Yellow
        $warnCount++
        continue
    }

    $ep = Find-EntryPoint -Command $cfg.command -ServerArgs $cfg.args

    switch ($ep.Kind) {
        'file' {
            if (Test-Path $ep.Path) {
                Write-Host "  [OK] $name - $($ep.Path)" -ForegroundColor Green
                $okCount++
            } else {
                $issues += "[FAIL] $name - entry point missing: $($ep.Path)"
                Write-Host "  [FAIL] $name - $($ep.Path) not found" -ForegroundColor Red
            }
        }
        'wrapped' {
            # Verify the wrapper itself resolves on PATH (or is an absolute path
            # that exists). Catches "wrapper got uninstalled" without forcing us
            # to know what file the wrapper would execute.
            $resolved = $null
            try {
                $resolved = Get-Command $cfg.command -ErrorAction SilentlyContinue
            } catch {
                $resolved = $null
            }
            if ($resolved) {
                Write-Host "  [INFO] $name - wraps '$($cfg.command)' (resolves via PATH; no disk check on payload)" -ForegroundColor DarkGray
                $infoCount++
            } else {
                $issues += "[FAIL] $name - wrapper command not found on PATH: $($cfg.command)"
                Write-Host "  [FAIL] $name - wrapper '$($cfg.command)' not on PATH" -ForegroundColor Red
            }
        }
        'empty' {
            Write-Host "  [WARN] $name - no command/args defined" -ForegroundColor Yellow
            $warnCount++
        }
    }
}

Write-Host ''
if ($issues.Count -eq 0) {
    Write-Host ("--- All MCP configs valid ({0} OK, {1} INFO, {2} WARN) ---" -f $okCount, $infoCount, $warnCount) -ForegroundColor Green
    exit 0
} else {
    Write-Host ("--- $($issues.Count) issue(s) found ({0} OK, {1} INFO, {2} WARN) ---" -f $okCount, $infoCount, $warnCount) -ForegroundColor Red
    if ($DryRun) {
        Write-Host "(Dry run - no changes made)`n"
    }
    exit 1
}
