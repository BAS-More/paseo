#!/usr/bin/env pwsh
# Full-stack instant rollback to the previous deployment (Windows / Docker Desktop).
#
# Reads .deploy-rollback (JSON, written by deploy.ps1) to determine which images
# and slots to restore. Starts previous slots in dependency order, health-checks
# them, switches Caddy atomically, and drains the current slots.
#
# Usage:
#   .\scripts\rollback.ps1                             # rollback all services
#   .\scripts\rollback.ps1 -Service paseo              # rollback only Paseo
#   .\scripts\rollback.ps1 -Service paseo -Image "ghcr.io/bas-more/paseo/paseo-daemon:v0.2.0"
#
# Prerequisites: docker, docker compose

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

param(
    [string]$Service = "",
    [string]$Image = "",
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

$AllServices = @("9router", "crewai", "soifer", "paseo")

# ── Helpers ─────────────────────────────────────────────────
function Write-Log {
    param([string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Write-Host "[rollback] $ts  $Message"
}

function Write-Warn {
    param([string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Write-Host "[rollback] $ts  WARNING: $Message" -ForegroundColor Yellow
}

function Invoke-Compose {
    param([string[]]$Arguments)
    $allArgs = @("-f", $ComposeProd, "-f", $ComposeDeploy) + $Arguments
    & docker compose @allArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE"
    }
}

$DeployConfig = Get-Content $ConfigFile -Raw | ConvertFrom-Json

function Get-SvcConfig {
    param([string]$Svc)
    $DeployConfig.services.$Svc
}

function Load-State {
    if (-not (Test-Path $StateFile)) { return @{} }
    $raw = (Get-Content $StateFile -Raw).Trim()
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

# ── Preflight ──────────────────────────────────────────────
$dockerVer = & docker --version 2>$null
if ($LASTEXITCODE -ne 0) { throw "Docker is not installed or not running." }

if (-not (Test-Path $ComposeProd))   { throw "Missing $ComposeProd" }
if (-not (Test-Path $ComposeDeploy)) { throw "Missing $ComposeDeploy" }
if (-not (Test-Path $ConfigFile))    { throw "Missing $ConfigFile" }

# Load rollback metadata
$RollbackData = @{}
if (Test-Path $RollbackFile) {
    $raw = (Get-Content $RollbackFile -Raw).Trim()
    try {
        $RollbackData = $raw | ConvertFrom-Json -AsHashtable
    } catch {
        # Backward compat: old key=value format
        $match = [regex]::Match($raw, "ROLLBACK_TO_IMAGE=(.+)")
        if ($match.Success) {
            $RollbackData = @{
                images = @{ paseo = @{ old = $match.Groups[1].Value.Trim() } }
            }
        }
    }
}

$CurrentState = Load-State

# Determine services to rollback
$RollbackServices = @()
if (-not [string]::IsNullOrWhiteSpace($Service)) {
    if ($AllServices -notcontains $Service) {
        throw "Unknown service: $Service (valid: $($AllServices -join ', '))"
    }
    $RollbackServices = @($Service)
} else {
    $RollbackServices = $AllServices
}

Write-Log "=== Full-Stack Rollback ==="
Write-Log "Services: $($RollbackServices -join ', ')"

# Resolve rollback images per service
$RollbackImages = @{}
$TargetSlots = @{}
$TargetContainers = @{}

foreach ($svc in $RollbackServices) {
    $currentSlot = Get-SlotForService -Svc $svc -State $CurrentState
    $targetSlot = Get-OppositeSlot -Slot $currentSlot
    $TargetSlots[$svc] = $targetSlot
    $TargetContainers[$svc] = Get-ContainerName -Svc $svc -Slot $targetSlot

    if (-not [string]::IsNullOrWhiteSpace($Image) -and $RollbackServices.Count -eq 1) {
        $RollbackImages[$svc] = $Image
    } else {
        $img = ""
        if ($RollbackData.ContainsKey("images") -and $RollbackData.images.ContainsKey($svc)) {
            $img = $RollbackData.images.$svc.old
        }
        if ([string]::IsNullOrWhiteSpace($img) -or $img -eq "none" -or $img -eq "unknown") {
            $cfg = Get-SvcConfig -Svc $svc
            if ($cfg.required) {
                throw "No rollback image found for required service: $svc. Specify -Image explicitly."
            } else {
                Write-Warn "No rollback image for optional service: $svc. Skipping."
                $TargetContainers.Remove($svc)
                continue
            }
        }
        $RollbackImages[$svc] = $img
    }

    Write-Log "  ${svc}: slot $currentSlot -> $targetSlot (image: $($RollbackImages[$svc]))"
}

# ── Step 1: Pull rollback images ──────────────────────────
foreach ($svc in $RollbackServices) {
    if (-not $TargetContainers.ContainsKey($svc)) { continue }
    $img = $RollbackImages[$svc]
    Write-Log "Pulling $img..."
    & docker pull $img
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Pull failed for $svc; using local cache if available."
    }
}

# ── Step 2: Start rollback slots ──────────────────────────
foreach ($svc in $RollbackServices) {
    if (-not $TargetContainers.ContainsKey($svc)) { continue }
    $ctr = $TargetContainers[$svc]
    $slot = $TargetSlots[$svc]
    $img = $RollbackImages[$svc]
    $imgVar = Get-ImageEnvVar -Svc $svc -Slot $slot

    Write-Log "Starting $ctr with rollback image..."
    Remove-OldContainer -Container $ctr
    [Environment]::SetEnvironmentVariable($imgVar, $img, "Process")
    Invoke-Compose @("up", "-d", "--no-deps", "${svc}-${slot}")
}

# ── Step 3: Health-check ─────────────────────────────────
foreach ($svc in $RollbackServices) {
    if (-not $TargetContainers.ContainsKey($svc)) { continue }
    $ctr = $TargetContainers[$svc]
    $cfg = Get-SvcConfig -Svc $svc
    $timeout = if ($cfg.healthTimeout) { $cfg.healthTimeout } else { 60 }

    $healthy = Wait-ForHealth -Container $ctr -Svc $svc -Timeout $timeout
    if (-not $healthy) {
        if ($cfg.required) {
            throw "Rollback target $ctr failed health check. Manual intervention required."
        } else {
            Write-Warn "$svc rollback failed health check (optional). Continuing."
            Remove-OldContainer -Container $ctr
            $TargetContainers.Remove($svc)
        }
    }
}

# ── Step 4: Switch Caddy atomically ──────────────────────
Write-Log "Switching Caddy upstreams..."

foreach ($svc in $RollbackServices) {
    if (-not $TargetContainers.ContainsKey($svc)) { continue }
    $ctr = $TargetContainers[$svc]
    $envName = Get-UpstreamEnvVar -Svc $svc
    [Environment]::SetEnvironmentVariable($envName, $ctr, "Process")
}

foreach ($svc in $AllServices) {
    $envName = Get-UpstreamEnvVar -Svc $svc
    $val = [Environment]::GetEnvironmentVariable($envName, "Process")
    if ([string]::IsNullOrWhiteSpace($val)) {
        $active = Get-SlotForService -Svc $svc -State $CurrentState
        if ($active -ne "none") {
            $ctr = Get-ContainerName -Svc $svc -Slot $active
            [Environment]::SetEnvironmentVariable($envName, $ctr, "Process")
        }
    }
}

Invoke-Compose @("up", "-d", "--no-deps", "caddy")
Start-Sleep -Seconds 2

# ── Step 5: Drain old slots ──────────────────────────────
foreach ($svc in $RollbackServices) {
    $currentSlot = Get-SlotForService -Svc $svc -State $CurrentState
    if ($currentSlot -eq "none") { continue }
    $oldCtr = Get-ContainerName -Svc $svc -Slot $currentSlot
    $cfg = Get-SvcConfig -Svc $svc
    $drainT = if ($cfg.drainTimeout) { $cfg.drainTimeout } else { $DrainTimeout }
    Stop-WithDrain -Container $oldCtr -Timeout $drainT
    Remove-OldContainer -Container $oldCtr
}

# ── Step 6: Save state ───────────────────────────────────
$NewState = @{}
foreach ($key in $CurrentState.Keys) {
    if ($key -ne "timestamp") { $NewState[$key] = $CurrentState[$key] }
}
foreach ($svc in $RollbackServices) {
    if ($TargetContainers.ContainsKey($svc)) {
        $NewState[$svc] = $TargetSlots[$svc]
    }
}
$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$NewState["timestamp"] = $ts

$NewState | ConvertTo-Json | Out-File -FilePath $StateFile -Encoding utf8

Write-Log "=== Rollback complete ==="
foreach ($svc in $RollbackServices) {
    if ($TargetContainers.ContainsKey($svc)) {
        Write-Log "  ${svc}: $($TargetContainers[$svc]) ($($RollbackImages[$svc]))"
    }
}
