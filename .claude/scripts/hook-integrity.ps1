<#
.SYNOPSIS
  SHA256 manifest generator/verifier for hooks referenced in settings.json.

.DESCRIPTION
  generate - walks every hook file referenced in settings.json +
             settings.local.json, hashes it, writes
             ~/.claude/hooks/.manifest.sha256.

  verify   - re-hashes same files and diffs vs the manifest.
             Exit 0 = clean.  Exit 1 = drift (missing/modified/added).

  Catches silent tampering or deletion of hooks like secret-scanner.js
  that would otherwise cause silent security bypass.

.PARAMETER Mode
  'generate' (write new manifest) or 'verify' (check vs manifest).
#>

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('generate', 'verify')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
$hooksDir = Join-Path $env:USERPROFILE '.claude\hooks'
$manifest = Join-Path $hooksDir '.manifest.sha256'

$configs = @(
    (Join-Path $env:USERPROFILE '.claude\settings.json'),
    (Join-Path $env:USERPROFILE '.claude\settings.local.json')
)

$hookFiles = @{}
foreach ($cfg in $configs) {
    if (-not (Test-Path $cfg)) { continue }
    try { $data = Get-Content $cfg -Raw | ConvertFrom-Json } catch { continue }
    $hooks = $data.hooks
    if (-not $hooks) { continue }
    foreach ($evt in ($hooks | Get-Member -MemberType NoteProperty).Name) {
        foreach ($block in $hooks.$evt) {
            foreach ($h in $block.hooks) {
                $cmd = $h.command
                if ($cmd -match '([A-Z]:[\\/][^"]+\.(js|cjs|mjs|ps1|py))') {
                    $path = $matches[1].Replace('/', '\')
                    if (Test-Path $path) { $hookFiles[$path] = $true }
                }
            }
        }
    }
}

$toml = Join-Path $hooksDir 'secret-scanner.toml'
if (Test-Path $toml) { $hookFiles[$toml] = $true }

function Get-Hash([string]$p) {
    (Get-FileHash -Algorithm SHA256 -Path $p).Hash.ToLower()
}

if ($Mode -eq 'generate') {
    $lines = @()
    foreach ($f in ($hookFiles.Keys | Sort-Object)) {
        $lines += "$(Get-Hash $f)  $f"
    }
    $lines | Out-File -Encoding ASCII $manifest
    Write-Host "Manifest generated: $manifest" -ForegroundColor Green
    Write-Host ("  Tracked files: " + $hookFiles.Count)
    exit 0
}

# verify mode
if (-not (Test-Path $manifest)) {
    Write-Host "NO MANIFEST yet - run: hook-integrity.ps1 generate" -ForegroundColor Yellow
    exit 0
}

$expected = @{}
Get-Content $manifest | ForEach-Object {
    if ($_ -match '^(\S+)\s+(.+)$') {
        $expected[$matches[2]] = $matches[1]
    }
}

$drift = @()
foreach ($file in $expected.Keys) {
    if (-not (Test-Path $file)) {
        $drift += "[MISSING] $file"
    } elseif ((Get-Hash $file) -ne $expected[$file]) {
        $drift += "[MODIFIED] $file"
    }
}
foreach ($file in $hookFiles.Keys) {
    if (-not $expected.ContainsKey($file)) {
        $drift += "[NEW] $file"
    }
}

if ($drift.Count -eq 0) {
    $n = $expected.Count
    Write-Host ("Hook integrity OK (" + $n + " files)") -ForegroundColor Green
    exit 0
}

Write-Host "HOOK INTEGRITY DRIFT:" -ForegroundColor Red
$drift | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
Write-Host ""
Write-Host "If legitimate, accept with: hook-integrity.ps1 -Mode generate" -ForegroundColor Yellow
exit 1
