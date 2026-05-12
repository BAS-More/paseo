<#
.SYNOPSIS
  Detect config-vs-disk drift for MCP servers — the Apr 17 reinstall root cause.

.DESCRIPTION
  Claude Code's Apr 17 reinstall was triggered by "Extension not found"
  warnings for avios-context / claude-bridge / qoder-mcp — MCP configs
  pointing at files that no longer existed. This script catches that
  drift BEFORE it forces another reinstall.

  Scans every Claude config file that declares mcpServers and verifies the
  referenced file path exists (for stdio servers) or the URL is well-formed
  (for http/sse servers).

  Exit codes:
    0 — all servers resolvable
    1 — drift detected; details on stdout
#>

[CmdletBinding()]
param([switch]$VerboseOutput)

$ErrorActionPreference = 'Stop'

$configs = @(
    (Join-Path $env:USERPROFILE '.claude.json'),
    (Join-Path $env:USERPROFILE '.claude\settings.json'),
    (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json')
)

$missing = @()
$found   = @()

foreach ($cfg in $configs) {
    if (-not (Test-Path $cfg)) { continue }
    try {
        $data = Get-Content $cfg -Raw | ConvertFrom-Json
    } catch {
        Write-Warning "Could not parse $cfg : $_"
        continue
    }

    $servers = $data.mcpServers
    if (-not $servers) { continue }

    foreach ($name in ($servers | Get-Member -MemberType NoteProperty).Name) {
        $s = $servers.$name
        $type = $s.type
        $issue = $null

        if ($type -eq 'stdio' -or -not $type) {
            $sargs = @($s.args)
            $targetFile = $sargs | Where-Object {
                $_ -match '\.(js|cjs|mjs|py|exe)$' -or ($_ -match '^[A-Z]:[\\/]')
            } | Select-Object -First 1
            if ($targetFile -and -not (Test-Path $targetFile)) {
                $issue = "file not found: $targetFile"
            }
        } elseif ($type -eq 'http' -or $type -eq 'sse') {
            if (-not $s.url -or $s.url -notmatch '^https?://') {
                $issue = "invalid URL: $($s.url)"
            }
        }

        $entry = "$name  [$(Split-Path $cfg -Leaf)]"
        if ($issue) {
            $missing += "$entry  --  $issue"
        } else {
            $found += $entry
        }
    }
}

if ($found -and $VerboseOutput) {
    Write-Host "OK servers ($($found.Count)):" -ForegroundColor Green
    $found | ForEach-Object { Write-Host "  [+] $_" }
}

if ($missing.Count -eq 0) {
    Write-Host "All $($found.Count) MCP servers resolvable. No drift." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "MISSING MCP SERVERS (Apr-17-style drift):" -ForegroundColor Red
$missing | ForEach-Object { Write-Host "  [X] $_" -ForegroundColor Red }
Write-Host ""
Write-Host "Fix options:" -ForegroundColor Yellow
Write-Host "  a) Restore the missing file from ~/OneDrive.../ClaudeCodeBackup"
Write-Host "  b) Remove the orphaned config entry from the offending settings file"
Write-Host "  c) Reinstall the extension"

exit 1
