# mcp-repair.ps1 — Attempt to repair broken MCP server configurations
# Usage: powershell -ExecutionPolicy Bypass -File mcp-repair.ps1

$ErrorActionPreference = "Continue"

Write-Host "`n=== MCP Repair ===" -ForegroundColor Cyan
Write-Host "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"

$servers = @(
    @{ Name = "avios-context-mcp"; Root = "C:\Dev\avios-context-mcp"; Entry = "C:\Dev\avios-context-mcp\src\index.js" },
    @{ Name = "total-recall";      Root = "C:\Dev\Total-Recall";      Entry = "C:\Dev\Total-Recall\src\index.js" },
    @{ Name = "claude-bridge";     Root = "C:\Dev\claude-bridge";      Entry = "C:\Dev\claude-bridge\dist\index.js" }
)

$repaired = 0

foreach ($s in $servers) {
    $name = $s.Name
    $root = $s.Root
    $entry = $s.Entry

    if (-not (Test-Path $root)) {
        Write-Host "  [SKIP] $name — project directory missing: $root" -ForegroundColor Red
        continue
    }

    if (-not (Test-Path $entry)) {
        Write-Host "  [WARN] $name — entry point missing, attempting build..." -ForegroundColor Yellow
        $pkgJson = Join-Path $root "package.json"
        if (Test-Path $pkgJson) {
            Push-Location $root
            & npm run build 2>&1 | Out-Null
            Pop-Location
            if (Test-Path $entry) {
                Write-Host "  [FIXED] $name — build restored entry point" -ForegroundColor Green
                $repaired++
            } else {
                Write-Host "  [FAIL] $name — build did not produce entry point" -ForegroundColor Red
            }
        }
        continue
    }

    $nodeModules = Join-Path $root "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host "  [WARN] $name — missing node_modules, running npm install..." -ForegroundColor Yellow
        Push-Location $root
        & npm install 2>&1 | Out-Null
        Pop-Location
        if (Test-Path $nodeModules) {
            Write-Host "  [FIXED] $name — npm install completed" -ForegroundColor Green
            $repaired++
        } else {
            Write-Host "  [FAIL] $name — npm install failed" -ForegroundColor Red
        }
        continue
    }

    Write-Host "  [OK] $name — healthy" -ForegroundColor Green
}

Write-Host "`n--- Repair complete: $repaired fix(es) applied ---`n"
