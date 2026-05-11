#!/usr/bin/env pwsh
# Full-stack atomic blue/green deployment (Windows / Docker Desktop).
#
# Deploys all 4 long-running services (9Router, CrewAI, Soifer, Paseo) using
# blue/green container slots behind a Caddy reverse proxy with port-based routing.
# Health-gates in dependency order. Single Caddy reload switches all upstreams
# atomically. Rolls back automatically if any required service fails health checks.
#
# Usage:
#   .\scripts\deploy.ps1                           # deploy all services :latest
#   .\scripts\deploy.ps1 -Service paseo            # deploy only Paseo
#   .\scripts\deploy.ps1 -Build                    # build images locally
#   .\scripts\deploy.ps1 -HealthTimeout 120        # custom timeout
#
# Prerequisites: docker, docker compose, curl

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

param(
    [string]$Service = "",
    [switch]$Build,
    [int]$HealthInterval = 3,
    [int]$DrainTimeout = 30
)

# ── Configuration ───────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

$ComposeProd = Join-Path $ProjectRoot "docker-compose.prod.yml"
$ComposeDeploy = Join-Path $ProjectRoot "docker-compose.deploy.yml"
$ConfigFile = Join-Path $ProjectRoot "scripts" "deploy-config.json"
$StateFile = Join-Path $ProjectRoot ".deploy-state"
$RollbackFile = Join-Path $ProjectRoot ".deploy-rollback"

$CaddyContainer = "paseo-caddy"
$AllServices = @("9router", "crewai", "soifer", "paseo")

# ── Helpers ─────────────────────────────────────────────────
function Write-Log {
    param([string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Write-Host "[deploy] $ts  $Message"
}

function Write-Warn {
    param([string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Write-Host "[deploy] $ts  WARNING: $Message" -ForegroundColor Yellow
}

function Invoke-Compose {
    param([string[]]$Arguments)
    $allArgs = @("-f", $ComposeProd, "-f", $ComposeDeploy) + $Arguments
    & docker compose @allArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE"
    }
}

# Read deploy-config.json
$DeployConfig = Get-Content $ConfigFile -Raw | ConvertFrom-Json

function Get-SvcConfig {
    param([string]$Svc)
    $DeployConfig.services.$Svc
}

# ── State management (JSON format) ─────────────────────────
function Load-State {
    if (-not (Test-Path $StateFile)) {
        return @{}
    }
    $raw = (Get-Content $StateFile -Raw).Trim()
    # Backward compat: plain text = Paseo-only old format
    try {
        return $raw | ConvertFrom-Json -AsHashtable
    } catch {
        return @{ "paseo" = $raw }
    }
}

function Get-SlotForService {
    param([string]$Svc, [hashtable]$State)
    if ($State.ContainsKey($Svc)) { return $State[$Svc] }
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
    param([string]$Svc, [string]$Slot)
    return "${Svc}-${Slot}"
}

function Get-ImageEnvVar {
    param([string]$Svc, [string]$Slot)
    $prefix = switch ($Svc) {
        "9router" { "ROUTER" }
        "crewai"  { "CREWAI" }
        "soifer"  { "SOIFER" }
        "paseo"   { "PASEO" }
        default   { throw "Unknown service: $Svc" }
    }
    return "${prefix}_IMAGE_$($Slot.ToUpper())"
}

function Get-UpstreamEnvVar {
    param([string]$Svc)
    switch ($Svc) {
        "9router" { return "ACTIVE_ROUTER_UPSTREAM" }
        "crewai"  { return "ACTIVE_CREWAI_UPSTREAM" }
        "soifer"  { return "ACTIVE_SOIFER_UPSTREAM" }
        "paseo"   { return "ACTIVE_PASEO_UPSTREAM" }
        default   { throw "Unknown service: $Svc" }
    }
}

function Wait-ForHealth {
    param([string]$Container, [string]$Svc, [int]$Timeout)
    $cfg = Get-SvcConfig -Svc $Svc
    $port = $cfg.port
    $path = $cfg.healthPath
    $url = "http://localhost:${port}${path}"

    Write-Log "Waiting up to ${Timeout}s for $Container ${path}..."
    $deadline = (Get-Date).AddSeconds($Timeout)

    while ((Get-Date) -lt $deadline) {
        try {
            $null = & docker exec $Container curl -sf --max-time 5 $url 2>$null
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
        Write-Log "$Container is not running, nothing to drain."
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
        Write-Log "Removing $Container..."
        & docker rm -f $Container 2>$null | Out-Null
    }
}

# ── OCC preflight check ───────────────────────────────────
function Check-Occ {
    try {
        $ver = & occ --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Log "OCC binary found: $ver"
        } else {
            Write-Warn "OCC binary not found on host."
        }
    } catch {
        Write-Warn "OCC binary not found on host. OCC features will be unavailable in containers."
    }
}

# ── Preflight ──────────────────────────────────────────────
$dockerVer = & docker --version 2>$null
if ($LASTEXITCODE -ne 0) { throw "Docker is not installed or not running." }

if (-not (Test-Path $ComposeProd))   { throw "Missing $ComposeProd" }
if (-not (Test-Path $ComposeDeploy)) { throw "Missing $ComposeDeploy" }
if (-not (Test-Path $ConfigFile))    { throw "Missing $ConfigFile" }

Write-Log "=== Full-Stack Atomic Deploy ==="

# Determine which services to deploy
$DeployServices = @()
if (-not [string]::IsNullOrWhiteSpace($Service)) {
    if ($AllServices -notcontains $Service) {
        throw "Unknown service: $Service (valid: $($AllServices -join ', '))"
    }
    $DeployServices = @($Service)
    Write-Log "Single-service deploy: $Service"
} else {
    $DeployServices = $AllServices
    Write-Log "Full-stack deploy: $($AllServices -join ', ')"
}

Check-Occ

# ── Step 1: Load current state ────────────────────────────
$CurrentState = Load-State
Write-Log "Current state: $($CurrentState | ConvertTo-Json -Compress)"

$NewSlots = @{}
$OldImages = @{}
$NewImages = @{}
$NewContainers = @{}

foreach ($svc in $DeployServices) {
    $active = Get-SlotForService -Svc $svc -State $CurrentState
    $inactive = Get-OppositeSlot -Slot $active
    $NewSlots[$svc] = $inactive
    Write-Log "  ${svc}: active=$active -> deploying to $inactive"
}

# ── Step 2: Pull/build images ─────────────────────────────
foreach ($svc in $DeployServices) {
    $slot = $NewSlots[$svc]
    $cfg = Get-SvcConfig -Svc $svc
    $img = "$($cfg.imageBase):latest"
    $imgVar = Get-ImageEnvVar -Svc $svc -Slot $slot

    # Capture old image for rollback
    $active = Get-SlotForService -Svc $svc -State $CurrentState
    if ($active -ne "none") {
        $oldCtr = Get-ContainerName -Svc $svc -Slot $active
        try {
            $OldImages[$svc] = (& docker inspect --format="{{.Config.Image}}" $oldCtr 2>$null)
        } catch {
            $OldImages[$svc] = "unknown"
        }
    } else {
        $OldImages[$svc] = "none"
    }

    if ($Build) {
        Write-Log "Building $svc image locally..."
        switch ($svc) {
            "paseo" {
                & docker build -t $img -f "$ProjectRoot/Dockerfile" $ProjectRoot
            }
            "crewai" {
                & docker build -t $img -f "$ProjectRoot/packages/crewai-bridge/Dockerfile" "$ProjectRoot/packages/crewai-bridge"
            }
            default {
                Write-Warn "No local Dockerfile for $svc, pulling instead."
                & docker pull $img
            }
        }
        if ($LASTEXITCODE -ne 0) { throw "Failed to build/pull image for ${svc}: $img" }
    } else {
        Write-Log "Pulling $img..."
        & docker pull $img
        if ($LASTEXITCODE -ne 0) { throw "Failed to pull image for ${svc}: $img" }
    }

    $NewImages[$svc] = $img
    [Environment]::SetEnvironmentVariable($imgVar, $img, "Process")
}

# ── Step 3: Start all inactive slot containers ─────────────
foreach ($svc in $DeployServices) {
    $slot = $NewSlots[$svc]
    $ctr = Get-ContainerName -Svc $svc -Slot $slot
    $svcName = "${svc}-${slot}"
    $NewContainers[$svc] = $ctr

    Write-Log "Starting $ctr..."
    Remove-OldContainer -Container $ctr
    Invoke-Compose @("up", "-d", "--no-deps", $svcName)
}

# ── Step 4: Health-gate in dependency order ────────────────
$FailedServices = @()

foreach ($svc in $DeployServices) {
    $ctr = $NewContainers[$svc]
    $cfg = Get-SvcConfig -Svc $svc
    $timeout = if ($cfg.healthTimeout) { $cfg.healthTimeout } else { 90 }

    $healthy = Wait-ForHealth -Container $ctr -Svc $svc -Timeout $timeout

    if ($healthy) {
        Write-Log "${svc}: HEALTHY"
    } else {
        if ($cfg.required) {
            Write-Log "${svc}: FAILED (required) - aborting deploy."
            $FailedServices += $svc
            break
        } else {
            Write-Warn "${svc}: FAILED (optional) - continuing without it."
            $FailedServices += $svc
        }
    }
}

# Check if any required service failed
$RequiredFailed = $false
foreach ($fsvc in $FailedServices) {
    $cfg = Get-SvcConfig -Svc $fsvc
    if ($cfg.required) {
        $RequiredFailed = $true
        break
    }
}

if ($RequiredFailed) {
    Write-Log "ROLLBACK: Required service failed. Tearing down all new slots..."
    foreach ($svc in $DeployServices) {
        $ctr = $NewContainers[$svc]
        Stop-WithDrain -Container $ctr -Timeout 10
        Remove-OldContainer -Container $ctr
    }
    Write-Log "Rollback complete - previous slots unchanged."
    exit 1
}

# Stop failed optional services
foreach ($fsvc in $FailedServices) {
    $ctr = $NewContainers[$fsvc]
    Write-Warn "Stopping failed optional service: $ctr"
    Stop-WithDrain -Container $ctr -Timeout 10
    Remove-OldContainer -Container $ctr
    $NewContainers.Remove($fsvc)
}

# ── Step 5: Switch Caddy (single reload for all upstreams) ─
Write-Log "Switching Caddy upstreams atomically..."

foreach ($svc in $DeployServices) {
    if (-not $NewContainers.ContainsKey($svc)) { continue }
    $ctr = $NewContainers[$svc]
    $envName = Get-UpstreamEnvVar -Svc $svc
    [Environment]::SetEnvironmentVariable($envName, $ctr, "Process")
}

# Export upstreams for services NOT being deployed (keep current)
foreach ($svc in $AllServices) {
    $envName = Get-UpstreamEnvVar -Svc $svc
    $currentVal = [Environment]::GetEnvironmentVariable($envName, "Process")
    if ([string]::IsNullOrWhiteSpace($currentVal)) {
        $active = Get-SlotForService -Svc $svc -State $CurrentState
        if ($active -ne "none") {
            $ctr = Get-ContainerName -Svc $svc -Slot $active
            [Environment]::SetEnvironmentVariable($envName, $ctr, "Process")
        }
    }
}

Invoke-Compose @("up", "-d", "--no-deps", "caddy")
Start-Sleep -Seconds 2
Write-Log "Caddy reloaded with new upstreams."

# ── Step 6: Drain old slots ───────────────────────────────
foreach ($svc in $DeployServices) {
    $active = Get-SlotForService -Svc $svc -State $CurrentState
    if ($active -eq "none") { continue }
    $oldCtr = Get-ContainerName -Svc $svc -Slot $active
    $cfg = Get-SvcConfig -Svc $svc
    $drainT = if ($cfg.drainTimeout) { $cfg.drainTimeout } else { $DrainTimeout }
    Stop-WithDrain -Container $oldCtr -Timeout $drainT
    Remove-OldContainer -Container $oldCtr
}

# ── Step 7: Save state and rollback info ───────────────────
$NewState = @{}
foreach ($key in $CurrentState.Keys) {
    if ($key -ne "timestamp") {
        $NewState[$key] = $CurrentState[$key]
    }
}
foreach ($svc in $DeployServices) {
    if ($NewContainers.ContainsKey($svc)) {
        $NewState[$svc] = $NewSlots[$svc]
    }
}
$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$NewState["timestamp"] = $ts

$NewState | ConvertTo-Json | Out-File -FilePath $StateFile -Encoding utf8
Write-Log "Deploy state saved."

$imagesMap = @{}
foreach ($svc in $DeployServices) {
    $imagesMap[$svc] = @{
        old = if ($OldImages.ContainsKey($svc)) { $OldImages[$svc] } else { "none" }
        new = if ($NewImages.ContainsKey($svc)) { $NewImages[$svc] } else { "none" }
    }
}

$rollbackInfo = @{
    current   = $NewState
    previous  = $CurrentState
    images    = $imagesMap
    timestamp = $ts
}
$rollbackInfo | ConvertTo-Json -Depth 4 | Out-File -FilePath $RollbackFile -Encoding utf8
Write-Log "Rollback info saved to .deploy-rollback"

# ── Step 8: Post-switch verification ───────────────────────
Write-Log "Running post-switch verification..."
$VerifyPass = $true

foreach ($svc in $DeployServices) {
    if (-not $NewContainers.ContainsKey($svc)) { continue }
    $ctr = $NewContainers[$svc]
    $healthy = Wait-ForHealth -Container $ctr -Svc $svc -Timeout 15
    if ($healthy) {
        Write-Log "${svc}: verified OK"
    } else {
        Write-Warn "${svc}: post-switch health check failed"
        $VerifyPass = $false
    }
}

if ($VerifyPass) {
    Write-Log "=== Deploy complete ==="
    foreach ($svc in $DeployServices) {
        if ($NewContainers.ContainsKey($svc)) {
            Write-Log "  ${svc}: $($NewContainers[$svc]) ($($NewImages[$svc]))"
        }
    }
} else {
    Write-Warn "Post-switch verification had failures. Services may be degraded."
    Write-Warn "Run: .\scripts\rollback.ps1 to revert."
    exit 1
}
