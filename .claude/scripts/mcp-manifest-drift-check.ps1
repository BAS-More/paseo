<#
.SYNOPSIS
  Detect drift between ~/.claude.json and ~/.claude/mcp-manifest.json.

.DESCRIPTION
  Weekly scheduled task. The pre-commit hook catches 99% of cases;
  this catches the 1% where MCP config was edited but never committed,
  leaving the source-controlled manifest stale.

  On drift:
    - Writes an entry to ~/.claude/_logs/mcp-drift-incidents.jsonl
    - Shows a Windows toast via notify-avi.ps1
    - Regenerates the manifest (does NOT commit — user decides)
    - Exits 1 so Task Scheduler records a failure
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$config   = Join-Path $env:USERPROFILE '.claude.json'
$manifest = Join-Path $env:USERPROFILE '.claude\mcp-manifest.json'
$logDir   = Join-Path $env:USERPROFILE '.claude\_logs'
$log      = Join-Path $logDir 'mcp-drift-incidents.jsonl'
$notify   = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'
$regen    = Join-Path $env:USERPROFILE '.claude\scripts\regenerate-mcp-manifest.ps1'

New-Item -Path $logDir -ItemType Directory -Force | Out-Null

if (-not (Test-Path $config))   { Write-Output 'config missing — nothing to compare'; exit 0 }
if (-not (Test-Path $manifest)) {
    Write-Output 'manifest missing — regenerating'
    & pwsh -File $regen
    exit 1
}

$liveJson = Get-Content $config -Raw | ConvertFrom-Json
$liveMcp  = @{}
if ($liveJson.PSObject.Properties.Name -contains 'mcpServers') {
    $liveJson.mcpServers.PSObject.Properties | ForEach-Object { $liveMcp[$_.Name] = $_.Value }
}

$manifestJson = Get-Content $manifest -Raw | ConvertFrom-Json
$manifestMcp  = @{}
if ($manifestJson.PSObject.Properties.Name -contains 'servers') {
    $manifestJson.servers.PSObject.Properties | ForEach-Object { $manifestMcp[$_.Name] = $_.Value }
}

$liveKeys     = @($liveMcp.Keys     | Sort-Object)
$manifestKeys = @($manifestMcp.Keys | Sort-Object)

$missing = @($manifestKeys | Where-Object { $_ -notin $liveKeys })
$extra   = @($liveKeys     | Where-Object { $_ -notin $manifestKeys })
$drift   = ($missing.Count -gt 0) -or ($extra.Count -gt 0) -or ($liveKeys.Count -ne $manifestKeys.Count)

if (-not $drift) {
    Write-Output "OK: $($liveKeys.Count) MCPs, manifest in sync"
    exit 0
}

$incident = [ordered]@{
    timestamp      = (Get-Date).ToString('o')
    live_count     = $liveKeys.Count
    manifest_count = $manifestKeys.Count
    missing_from_live     = $missing
    missing_from_manifest = $extra
}
Add-Content -Path $log -Value ($incident | ConvertTo-Json -Compress) -Encoding UTF8

$msg = "MCP manifest drift: live=$($liveKeys.Count) manifest=$($manifestKeys.Count). Re-commit manifest."
Write-Output $msg

if (Test-Path $notify) {
    try {
        & pwsh -NoProfile -File $notify -Title 'MCP Drift Detected' -Message $msg 2>&1 | Out-Null
    } catch {
        Write-Output "toast failed: $_"
    }
}

# Auto-regen so user can `git add && commit` in one step
& pwsh -NoProfile -File $regen 2>&1 | Out-Null
Write-Output 'manifest regenerated — review with: git -C ~/.claude diff mcp-manifest.json'

exit 1
