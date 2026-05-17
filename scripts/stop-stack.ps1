$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Paseo Stack - Stop Script (Windows)
# Kills services by port: Paseo (6767), CrewAI Bridge (8000), 9Router (20128)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/stop-stack.ps1

$services = @(
    @{ Port = 6767;  Name = "Paseo" },
    @{ Port = 8000;  Name = "CrewAI Bridge" },
    @{ Port = 20128; Name = "9Router" }
)

Write-Host ""
Write-Host "=== Stopping Paseo Stack ===" -ForegroundColor Cyan
Write-Host ""

foreach ($svc in $services) {
    $port = $svc.Port
    $name = $svc.Name
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $pid = $conn.OwningProcess
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "  Stopping $name (PID $pid, :$port)..." -ForegroundColor Yellow
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Host "  [OK] $name stopped" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "  $name (:$port) not running" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "=== Stack Stopped ===" -ForegroundColor Green
Write-Host ""
