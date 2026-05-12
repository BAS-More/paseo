# mcp-version-bump.ps1
#
# Phase 6b of docs/resilience-and-sync.md. Scans ~/.claude.json for MCP
# entries using `npx -y <pkg>@<version>` and reports / applies version
# updates. Equivalent of npm-check-updates for the MCP registry.
#
# Detected forms (in args list):
#   "@scope/pkg@1.2.3"
#   "pkg@1.2.3"
#   "pkg@latest"  -> flagged as floating (NOT a pin)
#
# Modes:
#   default       : report (read-only), exit 1 if any floating or outdated
#   -Apply        : edit ~/.claude.json in place (atomic)
#   -ReportOnly   : exit 0 even if outdated; for cron checks
#
# Each PC has its own ~/.claude.json (paths to dev/dist may differ), so
# version updates are per-PC. After --Apply, push the manifest sync via
# .githooks/pre-commit so other PCs see the pin in mcp-manifest.json.

[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$ReportOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ClaudeHome = "$env:USERPROFILE\.claude"
$ConfigPath = "$env:USERPROFILE\.claude.json"

. (Join-Path $ClaudeHome "scripts\lib\Write-JsonAtomic.ps1")

if (-not (Test-Path $ConfigPath)) {
    Write-Output "No ~/.claude.json found - skipping."
    exit 0
}

$config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

# Find npx -y <pkg>@<version> entries.
$updates = @()
$floats  = @()

if ($config.PSObject.Properties['mcpServers']) {
    foreach ($prop in $config.mcpServers.PSObject.Properties) {
        $name = $prop.Name
        $entry = $prop.Value
        if (-not $entry.PSObject.Properties['args']) { continue }
        $args = @($entry.args)
        for ($i = 0; $i -lt $args.Count; $i++) {
            $arg = "$($args[$i])"
            # match "@scope/pkg@version" or "pkg@version" but not URL-like
            if ($arg -match '^(@?[a-z0-9][\w./-]*?)@([a-z0-9][\w.-]*)$') {
                $pkg = $Matches[1]
                $ver = $Matches[2]

                if ($ver -eq "latest" -or $ver -eq "next") {
                    $floats += [PSCustomObject]@{
                        server  = $name
                        package = $pkg
                        version = $ver
                        argIdx  = $i
                    }
                    continue
                }

                # Query npm for current version. Tolerate failure (offline).
                $npmOut = & npm view $pkg version 2>$null
                if ($LASTEXITCODE -eq 0 -and $npmOut) {
                    $latest = $npmOut.Trim()
                    if ($latest -ne $ver) {
                        $updates += [PSCustomObject]@{
                            server   = $name
                            package  = $pkg
                            current  = $ver
                            latest   = $latest
                            argIdx   = $i
                        }
                    }
                }
            }
        }
    }
}

# Render report.
Write-Output ""
if ($floats.Count -gt 0) {
    Write-Output "Floating versions (replace with explicit pin):"
    foreach ($f in $floats) {
        Write-Output ("  {0,-20} {1}@{2}" -f $f.server, $f.package, $f.version)
    }
    Write-Output ""
}
if ($updates.Count -gt 0) {
    Write-Output "Outdated pins:"
    foreach ($u in $updates) {
        Write-Output ("  {0,-20} {1}: {2} -> {3}" -f $u.server, $u.package, $u.current, $u.latest)
    }
    Write-Output ""
}
if ($floats.Count -eq 0 -and $updates.Count -eq 0) {
    Write-Output "All MCP package versions pinned and current."
    exit 0
}

if (-not $Apply) {
    if ($ReportOnly) { exit 0 } else { exit 1 }
}

# Apply mode: rewrite args in-place. Floats become latest pin.
foreach ($u in $updates) {
    $args = @($config.mcpServers.$($u.server).args)
    $arg = "$($args[$u.argIdx])"
    if ($arg -match '^(@?[a-z0-9][\w./-]*?)@([a-z0-9][\w.-]*)$') {
        $args[$u.argIdx] = "$($Matches[1])@$($u.latest)"
        $config.mcpServers.$($u.server).args = $args
    }
}
foreach ($f in $floats) {
    $latest = & npm view $f.package version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $latest) {
        Write-Output "WARNING: cannot resolve $($f.package)@latest - leaving floating"
        continue
    }
    $args = @($config.mcpServers.$($f.server).args)
    $args[$f.argIdx] = "$($f.package)@$($latest.Trim())"
    $config.mcpServers.$($f.server).args = $args
}

Set-JsonAtomic -Path $ConfigPath -InputObject $config -Depth 10

Write-Output "Applied pin updates. Next: regen manifest via pre-commit gate or:"
Write-Output "  python `"$ClaudeHome\scripts\manifest_sync.py`" regen"
exit 0
