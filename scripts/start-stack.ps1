$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Paseo Stack - Startup Script (Windows)
# Starts: 9Router, CrewAI Bridge, Paseo daemon
# Usage: powershell -ExecutionPolicy Bypass -File scripts/start-stack.ps1

$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ROUTER_DIR = if ($env:NINE_ROUTER_DIR) { $env:NINE_ROUTER_DIR } else { "C:\Dev\tools\9router" }

function Test-PortListening {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

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
        } catch {
            # Service not ready yet
        }
        Start-Sleep -Seconds 2
    }
    Write-Host "  [FAIL] $Name did not respond within ${TimeoutSeconds}s" -ForegroundColor Red
    return $false
}

Write-Host ""
Write-Host "=== Paseo Stack ===" -ForegroundColor Cyan
Write-Host ""

# 1. 9Router
if (Test-PortListening -Port 20128) {
    Write-Host "[1/3] 9Router (:20128) already running - skipping" -ForegroundColor DarkGreen
} elseif (Test-Path "$ROUTER_DIR\package.json") {
    Write-Host "[1/3] Starting 9Router (:20128)..." -ForegroundColor Yellow
    Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $ROUTER_DIR -WindowStyle Minimized
    Wait-ForHealth "http://localhost:20128/api/init" "9Router" | Out-Null
} else {
    Write-Host "[1/3] 9Router not found at $ROUTER_DIR - skipping" -ForegroundColor DarkYellow
}

# 2. CrewAI Bridge
$bridgePath = Join-Path $ROOT "packages\crewai-bridge\api.py"
if (Test-PortListening -Port 8000) {
    Write-Host "[2/3] CrewAI Bridge (:8000) already running - skipping" -ForegroundColor DarkGreen
} elseif (Test-Path $bridgePath) {
    Write-Host "[2/3] Starting CrewAI Bridge (:8000)..." -ForegroundColor Yellow
    Start-Process -FilePath "python" -ArgumentList $bridgePath -WorkingDirectory $ROOT -WindowStyle Minimized
    Wait-ForHealth "http://localhost:8000/health" "CrewAI Bridge" | Out-Null
} else {
    Write-Host "[2/3] CrewAI bridge not found at $bridgePath - skipping" -ForegroundColor DarkYellow
}

# 3. Paseo daemon
if (Test-PortListening -Port 6767) {
    Write-Host "[3/3] Paseo (:6767) already running - skipping" -ForegroundColor DarkGreen
} else {
    Write-Host "[3/3] Starting Paseo (:6767)..." -ForegroundColor Yellow
    Start-Process -FilePath "npm" -ArgumentList "run", "dev:win" -WorkingDirectory $ROOT -WindowStyle Minimized
    Wait-ForHealth "http://localhost:6767" "Paseo" | Out-Null
}

# Status table
Write-Host ""
Write-Host "=== Status ===" -ForegroundColor Cyan
$services = @(
    @{ Name = "9Router";       Port = 20128; Url = "http://localhost:20128/api/init" },
    @{ Name = "CrewAI Bridge"; Port = 8000;  Url = "http://localhost:8000/health" },
    @{ Name = "Paseo";         Port = 6767;  Url = "http://localhost:6767" }
)
foreach ($svc in $services) {
    $listening = Test-PortListening -Port $svc.Port
    if ($listening) {
        Write-Host "  $($svc.Name.PadRight(14)) :$($svc.Port)  UP" -ForegroundColor Green
    } else {
        Write-Host "  $($svc.Name.PadRight(14)) :$($svc.Port)  DOWN" -ForegroundColor Red
    }
}
Write-Host ""
