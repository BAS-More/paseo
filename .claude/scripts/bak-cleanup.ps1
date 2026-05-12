<#
.SYNOPSIS
  Prune old .bak.<timestamp> files, keeping the N most recent per base file.

.DESCRIPTION
  Walks ~/.claude/ + C:/Dev/tools/Misc/ for files matching <name>.bak.<timestamp>
  pattern. Groups by <name>, keeps newest $Keep, deletes the rest.

  Auto-installed timestamp pattern: YYYYMMDD_HHMMSS (from `date +%Y%m%d_%H%M%S`).

.PARAMETER Keep
  Number of backups to retain per base file. Default 3.

.PARAMETER DryRun
  Show what would be deleted without deleting.

.EXAMPLE
  pwsh -File bak-cleanup.ps1 -Keep 3
  pwsh -File bak-cleanup.ps1 -DryRun
#>

param(
    [int]$Keep = 3,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$searchRoots = @(
    (Join-Path $env:USERPROFILE '.claude'),
    'C:\Dev\tools\Misc'
)

$pattern = '^(.+)\.bak\.(\d{8}_\d{6})$'

$groups = @{}
foreach ($root in $searchRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Recurse -File -Filter '*.bak.*' -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -match $pattern) {
            $base = Join-Path $_.DirectoryName $matches[1]
            if (-not $groups.ContainsKey($base)) { $groups[$base] = @() }
            $groups[$base] += $_
        }
    }
}

$totalDeleted = 0
$totalKept = 0
foreach ($base in $groups.Keys) {
    $files = $groups[$base] | Sort-Object LastWriteTime -Descending
    $keepers = $files | Select-Object -First $Keep
    $victims = $files | Select-Object -Skip $Keep
    $totalKept += $keepers.Count
    foreach ($v in $victims) {
        if ($DryRun) {
            Write-Host "[DRY] would delete: $($v.FullName)" -ForegroundColor Yellow
        } else {
            Remove-Item -Path $v.FullName -Force
            Write-Host "deleted: $($v.FullName)" -ForegroundColor DarkGray
        }
        $totalDeleted++
    }
}

$mode = if ($DryRun) { 'DRY-RUN' } else { 'COMPLETE' }
Write-Host ""
Write-Host "[$mode] Kept $totalKept, " -NoNewline
if ($DryRun) {
    Write-Host "would delete $totalDeleted" -ForegroundColor Yellow
} else {
    Write-Host "deleted $totalDeleted" -ForegroundColor Green
}
