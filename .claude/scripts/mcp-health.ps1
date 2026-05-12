# mcp-health.ps1 — Quick health check for all MCP servers
# Usage: powershell -ExecutionPolicy Bypass -File mcp-health.ps1

$ErrorActionPreference = "Continue"

Write-Host "`n=== MCP Server Health Check ===" -ForegroundColor Cyan
Write-Host "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"

$servers = @(
    @{ Name = "avios-context-mcp"; Entry = "C:\Dev\avios-context-mcp\src\index.js" },
    @{ Name = "total-recall";      Entry = "C:\Dev\Total-Recall\src\index.js" },
    @{ Name = "claude-bridge";     Entry = "C:\Dev\claude-bridge\dist\index.js" }
)

$healthy = 0
$total = $servers.Count

foreach ($s in $servers) {
    $name = $s.Name
    $entry = $s.Entry
    $nodeModules = Join-Path (Split-Path $entry -Parent | Split-Path -Parent) "node_modules"

    $entryExists = Test-Path $entry
    $modulesExist = Test-Path $nodeModules

    if ($entryExists -and $modulesExist) {
        Write-Host "  [OK] $name" -ForegroundColor Green
        Write-Host "       Entry: $entry"
        $healthy++
    } elseif ($entryExists) {
        Write-Host "  [WARN] $name — missing node_modules" -ForegroundColor Yellow
        Write-Host "       Entry: $entry"
        Write-Host "       Fix: cd $(Split-Path $entry -Parent | Split-Path -Parent) && npm install"
    } else {
        Write-Host "  [FAIL] $name — entry point missing" -ForegroundColor Red
        Write-Host "       Expected: $entry"
    }
}

# Check HTTP server (vscode-debugger)
Write-Host ""
try {
    $response = Invoke-WebRequest -Uri "http://localhost:45557/mcp" -Method HEAD -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  [OK] vscode-debugger (HTTP)" -ForegroundColor Green
    $healthy++
    $total++
} catch {
    Write-Host "  [SKIP] vscode-debugger (HTTP) — VS Code not running or MCP not active" -ForegroundColor DarkGray
    $total++
}

# Check context.db
$dbPath = "C:\Dev\avios-context-mcp\data\context.db"
if (Test-Path $dbPath) {
    $dbSize = (Get-Item $dbPath).Length / 1KB
    Write-Host "`n  [OK] context.db ($([math]::Round($dbSize, 1)) KB)" -ForegroundColor Green
} else {
    Write-Host "`n  [FAIL] context.db missing at $dbPath" -ForegroundColor Red
}

Write-Host "`n--- $healthy / $total servers healthy ---`n"
