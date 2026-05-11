#!/usr/bin/env pwsh
# Paseo — Instant rollback to the previous deployment (Windows / Docker Desktop).
#
# Reads .deploy-rollback (written by deploy.ps1) to determine which image
# to restore. Starts the previous slot, health-checks it, switches Caddy,
# and drains the current slot.
#
# Usage:
#   .\scripts\rollback.ps1
#   .\scripts\rollback.ps1 -Image "ghcr.io/bas-more/paseo/paseo-daemon:v0.2.0"
#
# Prerequisites: docker, docker compose

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

param(
    [string]$Image = "",
    [int]$HealthTimeout = 60,
    [int]$HealthInterval = 3,
    [int]$DrainTimeout = 30
)

# ── Configuration ───────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

$ComposeProd = Join-Path $ProjectRoot "docker-compose.prod.yml"
$ComposeDeploy = Join-Path $ProjectRoot "docker-compose.deploy.yml"
$StateFile = Join-Path $ProjectRoot ".deploy-state"
$RollbackFile = Join-Path $ProjectRoot ".deploy-rollback"

# ── Helpers ─────────────────────────────────────────────────
function Write-Log {
    param([string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Write-Host "[rollback] $ts  $Message"
}

function Get-ActiveSlot {
    if (Test-Path $StateFile) {
        return (Get-Content $StateFile -Raw).Trim()
    }
    $running = & docker ps --format "{{.Names}}" 2>$null
    if ($running -match "^paseo-blue$") { return "blue" }
    if ($running -match "^paseo-green$") { return "green" }
    return "none"
}

function Get-OppositeSlot {
    param([string]$Slot)
    switch ($Slot) {
        "blue"  { return "green" }
        "green" { return "blue" }
        "none"  { return "blue" }
        default { throw "Unknown slot: $Slot" }
    }
}

function Get-ContainerName {
    param([string]$Slot)
    return "paseo-$Slot"
}

function Get-ServiceName {
    param([string]$Slot)
    return "paseo-$Slot"
}

function Get-ImageEnvVar {
    param([string]$Slot)
    return "PASEO_IMAGE_$($Slot.ToUpper())"
}

function Wait-ForHealth {
    param([string]$Container, [int]$Timeout)
    Write-Log "Waiting up to ${Timeout}s for $Container /health/ready..."
    $deadline = (Get-Date).AddSeconds($Timeout)
    while ((Get-Date) -lt $deadline) {
        try {
            & docker exec $Container curl -sf --max-time 5 http://localhost:6767/health/ready 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Log "$Container is healthy."
                return $true
            }
        } catch { }
        Start-Sleep -Seconds $HealthInterval
    }
    Write-Log "$Container failed health check after ${Timeout}s."
    return $false
}

function Stop-WithDrain {
    param([string]$Container, [int]$Timeout)
    $running = & docker ps --format "{{.Names}}" 2>$null
    if ($running -notcontains $Container) {
        Write-Log "$Container is not running."
        return
    }
    Write-Log "Draining $Container (${Timeout}s grace period)..."
    & docker stop --time $Timeout $Container 2>$null | Out-Null
    Write-Log "$Container stopped."
}

function Remove-OldContainer {
    param([string]$Container)
    $all = & docker ps -a --format "{{.Names}}" 2>$null
    if ($all -contains $Container) {
        & docker rm -f $Container 2>$null | Out-Null
    }
}

function Invoke-Compose {
    param([string[]]$Arguments)
    $allArgs = @("-f", $ComposeProd, "-f", $ComposeDeploy) + $Arguments
    & docker compose @allArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE"
    }
}

# ── Resolve rollback target ────────────────────────────────
$RollbackImage = $Image

if ([string]::IsNullOrWhiteSpace($RollbackImage)) {
    if (-not (Test-Path $RollbackFile)) {
        throw "No .deploy-rollback file found and no -Image specified. Cannot determine rollback target."
    }

    $rollbackContent = Get-Content $RollbackFile -Raw
    $match = [regex]::Match($rollbackContent, "ROLLBACK_TO_IMAGE=(.+)")
    if (-not $match.Success -or [string]::IsNullOrWhiteSpace($match.Groups[1].Value) -or $match.Groups[1].Value -eq "unknown") {
        throw "Rollback file exists but ROLLBACK_TO_IMAGE is empty. Specify -Image explicitly."
    }

    $RollbackImage = $match.Groups[1].Value.Trim()
    Write-Log "Rollback file found. Previous image: $RollbackImage"
}

# ── Preflight ──────────────────────────────────────────────
$dockerVersion = & docker --version 2>$null
if ($LASTEXITCODE -ne 0) { throw "Docker is not installed or not running." }

if (-not (Test-Path $ComposeProd))   { throw "Missing $ComposeProd" }
if (-not (Test-Path $ComposeDeploy)) { throw "Missing $ComposeDeploy" }

$CurrentSlot = Get-ActiveSlot
$TargetSlot = Get-OppositeSlot -Slot $CurrentSlot

Write-Log "=== Paseo Rollback ==="
Write-Log "Current slot:  $CurrentSlot"
Write-Log "Target slot:   $TargetSlot"
Write-Log "Rollback image: $RollbackImage"

# ── Step 1: Pull rollback image ────────────────────────────
Write-Log "Pulling $RollbackImage..."
& docker pull $RollbackImage
if ($LASTEXITCODE -ne 0) {
    Write-Log "WARNING: Pull failed; using local cache if available."
}

# ── Step 2: Start rollback slot ────────────────────────────
$TargetContainer = Get-ContainerName -Slot $TargetSlot
$TargetService = Get-ServiceName -Slot $TargetSlot
$TargetImageEnv = Get-ImageEnvVar -Slot $TargetSlot

Write-Log "Starting $TargetContainer with rollback image..."
Remove-OldContainer -Container $TargetContainer

[Environment]::SetEnvironmentVariable($TargetImageEnv, $RollbackImage, "Process")
Invoke-Compose @("up", "-d", "--no-deps", $TargetService)

# ── Step 3: Health-check ───────────────────────────────────
$healthy = Wait-ForHealth -Container $TargetContainer -Timeout $HealthTimeout

if (-not $healthy) {
    throw "Rollback target $TargetContainer failed health check. Manual intervention required."
}

# ── Step 4: Switch Caddy ───────────────────────────────────
Write-Log "Switching Caddy upstream to $TargetContainer..."
$env:ACTIVE_UPSTREAM = $TargetContainer
Invoke-Compose @("up", "-d", "--no-deps", "caddy")
Start-Sleep -Seconds 2

# ── Step 5: Drain old slot ─────────────────────────────────
if ($CurrentSlot -ne "none") {
    $CurrentContainer = Get-ContainerName -Slot $CurrentSlot
    Stop-WithDrain -Container $CurrentContainer -Timeout $DrainTimeout
    Remove-OldContainer -Container $CurrentContainer
}

# ── Step 6: Save state ────────────────────────────────────
$TargetSlot | Out-File -FilePath $StateFile -Encoding utf8 -NoNewline

Write-Log "=== Rollback complete ==="
Write-Log "Active: $TargetContainer ($RollbackImage)"
