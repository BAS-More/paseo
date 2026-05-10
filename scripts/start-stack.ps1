# Paseo Stack — Startup Script (Windows)
# Starts: 9Router, CrewAI Bridge, Paseo daemon
# Usage: powershell -ExecutionPolicy Bypass -File scripts/start-stack.ps1

$ErrorActionPreference = "Continue"
Set-StrictMode -Version Latest

$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ROUTER_DIR = if ($env:NINE_ROUTER_DIR) { $env:NINE_ROUTER_DIR } else { "C:\Dev\tools\9router" }

function Wait-ForHealth {
    param([string]$Url, [string]$Name, [int]$TimeoutSeconds = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "  [OK] $Name is healthy" -ForegroundColor Green
                return $true
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    Write-Host "  [FAIL] $Name did not respond within ${TimeoutSeconds}s" -ForegroundColor Red
    return $false
}

Write-Host ""
Write-Host "=== Paseo Stack ===" -ForegroundColor Cyan
Write-Host ""

# 1. 9Router
if (Test-Path "$ROUTER_DIR\package.json") {
    Write-Host "[1/3] Starting 9Router (:20128)..." -ForegroundColor Yellow
    Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $ROUTER_DIR -WindowStyle Minimized
    Wait-ForHealth "http://localhost:20128/api/init" "9Router"
} else {
    Write-Host "[1/3] 9Router not found at $ROUTER_DIR - skipping" -ForegroundColor DarkYellow
}

# 2. CrewAI Bridge
$bridgePath = Join-Path $ROOT "packages\crewai-bridge\api.py"
if (Test-Path $bridgePath) {
    Write-Host "[2/3] Starting CrewAI Bridge (:8000)..." -ForegroundColor Yellow
    Start-Process -FilePath "python" -ArgumentList $bridgePath -WorkingDirectory $ROOT -WindowStyle Minimized
    Wait-ForHealth "http://localhost:8000/health" "CrewAI Bridge"
} else {
    Write-Host "[2/3] CrewAI bridge not found at $bridgePath - skipping" -ForegroundColor DarkYellow
}

# 3. Paseo daemon
Write-Host "[3/3] Starting Paseo (:6767)..." -ForegroundColor Yellow
Start-Process -FilePath "npm" -ArgumentList "run", "dev:win" -WorkingDirectory $ROOT -WindowStyle Minimized
Start-Sleep -Seconds 5
try {
    $status = Invoke-WebRequest -Uri "http://127.0.0.1:6767/api/status" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    Write-Host "  [OK] Paseo is healthy" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Paseo may still be starting" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "=== Paseo Stack Ready ===" -ForegroundColor Green
Write-Host "  Paseo:         http://localhost:6767"
Write-Host "  9Router:       http://localhost:20128"
Write-Host "  CrewAI Bridge: http://localhost:8000"
Write-Host ""
