<#
.SYNOPSIS
  Register ClaudeCode-WatchdogAPI — keeps watchdog HTTP API on :3400 alive.

.DESCRIPTION
  Two triggers:
    1. AtLogOn — starts guard when user logs in
    2. 5-minute repetition (9999-day duration) — re-fires if guard died

  -MultipleInstances IgnoreNew means the 5-min fires are no-ops while the
  guard is running. When guard dies (crash/SIGINT), next 5-min trigger
  respawns it within 5 minutes.

  ExecutionTimeLimit 0 = unlimited. Guard is an infinite respawn loop
  with exponential backoff (5s → 300s cap) around `watchdog api start`.

  No admin required.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ClaudeCode-WatchdogAPI'
$watchdog = 'C:\Dev\watchdog-security\dist\index.js'
$guardPath = Join-Path $env:USERPROFILE '.claude\scripts\watchdog-api-guard.ps1'

if (-not (Test-Path $watchdog)) { throw "Missing: $watchdog (run: cd C:/Dev/watchdog-security && npm run build)" }

# Materialise guard script (infinite respawn loop)
$guard = @"
`$ErrorActionPreference = 'Continue'
`$logDir = Join-Path `$env:USERPROFILE '.claude\_logs'
`$log = Join-Path `$logDir 'watchdog-api.log'
New-Item -Path `$logDir -ItemType Directory -Force | Out-Null
`$backoff = 5
while (`$true) {
    try {
        `"[`$(Get-Date -Format 'o')] starting watchdog api`" | Add-Content -Path `$log -Encoding UTF8
        & node '$watchdog' api start 2>&1 | Add-Content -Path `$log -Encoding UTF8
        `"[`$(Get-Date -Format 'o')] api exited (code `$LASTEXITCODE)`" | Add-Content -Path `$log -Encoding UTF8
    } catch {
        `"[`$(Get-Date -Format 'o')] guard caught: `$_`" | Add-Content -Path `$log -Encoding UTF8
    }
    Start-Sleep -Seconds `$backoff
    `$backoff = [Math]::Min(`$backoff * 2, 300)
}
"@
Set-Content -Path $guardPath -Value $guard -Encoding UTF8

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$guardPath`""

$trig1 = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trig2 = New-ScheduledTaskTrigger `
    -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 9999)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit 0 `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($trig1, $trig2) `
    -Principal $principal `
    -Settings $settings `
    -Description 'Watchdog HTTP API keepalive (logon + 5-min respawn).' | Out-Null

Write-Output "Registered $taskName (AtLogOn + 5-min respawn)"
Write-Output 'Start now: Start-ScheduledTask -TaskName ' + $taskName
