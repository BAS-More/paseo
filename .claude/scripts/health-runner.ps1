<#
.SYNOPSIS
  Health-runner umbrella - aggregates 4 tooling-health checks into one snapshot.

.DESCRIPTION
  Invokes the four standalone health scripts in sequence:
    mcp-validate.ps1
    mcp-health.ps1
    hook-integrity.ps1 -Mode verify
    tool-health-sweep.ps1

  For each: captures exit code, stdout/stderr, duration. Classifies the
  result by token-first / exit-fallback rules and aggregates to:

    red    - any FAIL/ERROR
    amber  - any WARN
    green  - all PASS (SKIP-only also counts as green)

  Writes JSON snapshot to ~/.claude/_logs/health-snapshot.json.
  Rolls the previous snapshot to health-snapshot.prev.json before overwriting.
  Fires a Windows toast (via notify-avi.ps1) on red transition only.

  Complements mcp-watchdog (process liveness) - this validates configured state.

.PARAMETER Quiet
  Suppress the stdout summary line. Used by the scheduled task.

.PARAMETER NoToast
  Skip the toast notification even on red transition.

.OUTPUTS
  Exit 0 = green. Exit 1 = red. Exit 2 = amber.

.NOTES
  Reuses notify-avi.ps1 for toast (no new BurntToast dependency).
  Each child script is invoked via "powershell -NoProfile -ExecutionPolicy Bypass".
  ASCII-only file (no em-dashes) so Windows PowerShell 5.1 reads it correctly.
#>

[CmdletBinding()]
param(
    [switch]$Quiet,
    [switch]$NoToast
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$claudeDir   = Join-Path $env:USERPROFILE '.claude'
$scriptsDir  = Join-Path $claudeDir 'scripts'
$logsDir     = Join-Path $claudeDir '_logs'
$snapPath    = Join-Path $logsDir 'health-snapshot.json'
$prevPath    = Join-Path $logsDir 'health-snapshot.prev.json'
# Per-process unique tmp filename so concurrent runners (e.g. scheduled fire
# overlapping with a manual run) don't collide on Move-Item.
$tmpPath     = Join-Path $logsDir ("health-snapshot.json.tmp." + [guid]::NewGuid().ToString('N'))
$notifyPath  = Join-Path $scriptsDir 'notify-avi.ps1'

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

# Ordered list of checks. Name + path + arg list.
$checks = @(
    [pscustomobject]@{ Name = 'mcp-validate';      Path = (Join-Path $scriptsDir 'mcp-validate.ps1');      Args = @() }
    [pscustomobject]@{ Name = 'mcp-health';        Path = (Join-Path $scriptsDir 'mcp-health.ps1');        Args = @() }
    [pscustomobject]@{ Name = 'hook-integrity';    Path = (Join-Path $scriptsDir 'hook-integrity.ps1');    Args = @('-Mode','verify') }
    [pscustomobject]@{ Name = 'tool-health-sweep'; Path = (Join-Path $scriptsDir 'tool-health-sweep.ps1'); Args = @() }
)

function Get-StatusFromOutput {
    param([string]$Out, [int]$ExitCode)

    $lines = $Out -split "`r?`n"

    # Token-first: FAIL/ERROR wins over WARN.
    $failLine = $lines | Where-Object { $_ -match '\[FAIL\]|\[ERROR\]' } | Select-Object -First 1
    if ($failLine) {
        return [pscustomobject]@{ Status = 'FAIL'; Reason = $failLine.Trim() }
    }
    $warnLine = $lines | Where-Object { $_ -match '\[WARN\]' } | Select-Object -First 1
    if ($warnLine) {
        return [pscustomobject]@{ Status = 'WARN'; Reason = $warnLine.Trim() }
    }
    if ($ExitCode -eq 0) {
        $lastNonEmpty = ($lines | Where-Object { $_.Trim() } | Select-Object -Last 1)
        $reason = if ($lastNonEmpty) { $lastNonEmpty.Trim() } else { 'OK' }
        return [pscustomobject]@{ Status = 'PASS'; Reason = $reason }
    }
    # Non-zero exit, no token signal - treat as fail.
    $lastLine = ($lines | Where-Object { $_.Trim() } | Select-Object -Last 1)
    $tail = if ($lastLine) { $lastLine.Trim() } else { '(no output)' }
    return [pscustomobject]@{ Status = 'FAIL'; Reason = ("exit {0}: {1}" -f $ExitCode, $tail) }
}

function Invoke-Check {
    param(
        [string]$Name,
        [string]$Path,
        [string[]]$ScriptArgs
    )
    # Param renamed from $Args to $ScriptArgs: PowerShell's $Args is an
    # automatic variable, and naming a function param $Args makes the splat
    # operator @Args resolve to the wrong scope - silently passing zero args
    # to the child script. That bit hook-integrity.ps1 hard (it has a
    # mandatory -Mode parameter and would hang on the prompt).

    if (-not (Test-Path $Path)) {
        return [pscustomobject]@{
            name        = $Name
            status      = 'SKIP'
            exit_code   = $null
            duration_ms = 0
            reason      = "script missing: $Path"
        }
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $exitCode = 0
    $out = ''
    try {
        if ($ScriptArgs -and $ScriptArgs.Count -gt 0) {
            $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Path @ScriptArgs 2>&1 | Out-String
        } else {
            $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Path 2>&1 | Out-String
        }
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }
    } catch {
        $sw.Stop()
        return [pscustomobject]@{
            name        = $Name
            status      = 'FAIL'
            exit_code   = -1
            duration_ms = [int]$sw.Elapsed.TotalMilliseconds
            reason      = "exception: $($_.Exception.Message)"
        }
    }
    $sw.Stop()

    $cls = Get-StatusFromOutput -Out $out -ExitCode $exitCode
    return [pscustomobject]@{
        name        = $Name
        status      = $cls.Status
        exit_code   = $exitCode
        duration_ms = [int]$sw.Elapsed.TotalMilliseconds
        reason      = $cls.Reason
    }
}

# Run all checks. Outer try guarantees a snapshot is written even if logic blows up.
$results = @()
$totalSw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    foreach ($c in $checks) {
        $results += Invoke-Check -Name $c.Name -Path $c.Path -ScriptArgs $c.Args
    }
} catch {
    $results += [pscustomobject]@{
        name        = 'health-runner-internal'
        status      = 'FAIL'
        exit_code   = -1
        duration_ms = 0
        reason      = "runner exception: $($_.Exception.Message)"
    }
}
$totalSw.Stop()

# Aggregate
$failCount  = @($results | Where-Object { $_.status -eq 'FAIL' }).Count
$warnCount  = @($results | Where-Object { $_.status -eq 'WARN' }).Count
$passCount  = @($results | Where-Object { $_.status -eq 'PASS' }).Count
$skipCount  = @($results | Where-Object { $_.status -eq 'SKIP' }).Count

$aggregate = if ($failCount -gt 0) { 'red' }
             elseif ($warnCount -gt 0) { 'amber' }
             else { 'green' }

# Read previous aggregate (for transition detection) BEFORE rolling.
$prevAggregate = $null
if (Test-Path $snapPath) {
    try {
        $prevSnap = Get-Content $snapPath -Raw -ErrorAction Stop | ConvertFrom-Json
        if ($prevSnap.PSObject.Properties.Name -contains 'aggregate') {
            $prevAggregate = $prevSnap.aggregate
        }
    } catch {
        $prevAggregate = $null
    }
    # Roll: copy current -> prev (overwrite)
    try {
        Copy-Item -Path $snapPath -Destination $prevPath -Force -ErrorAction Stop
    } catch {
        # Non-fatal; continue.
    }
}

# Build snapshot payload
$nowUtc = [DateTimeOffset]::Now
$payload = [pscustomobject]@{
    generated_epoch = [int64]$nowUtc.ToUnixTimeSeconds()
    generated_at    = $nowUtc.ToString('o')
    host            = $env:COMPUTERNAME
    aggregate       = $aggregate
    checks          = $results
}

# Atomic-ish write: tmp then move. tmp filename is per-process (GUID), so
# concurrent runners do not collide. Clean up the tmp on Move-Item failure
# so a crashed run doesn't leak files.
try {
    $payload | ConvertTo-Json -Depth 6 | Out-File -FilePath $tmpPath -Encoding utf8 -Force
    Move-Item -Path $tmpPath -Destination $snapPath -Force
} catch {
    Write-Host ("[health-runner] failed to write snapshot: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if (Test-Path $tmpPath) {
        Remove-Item -Path $tmpPath -Force -ErrorAction SilentlyContinue
    }
}

# Toast on red transition (red now, not red before).
if ($aggregate -eq 'red' -and $prevAggregate -ne 'red' -and -not $NoToast) {
    if (Test-Path $notifyPath) {
        $failedNames = ($results | Where-Object { $_.status -eq 'FAIL' } | ForEach-Object { $_.name }) -join ', '
        $firstReason = ($results | Where-Object { $_.status -eq 'FAIL' } | Select-Object -First 1 -ExpandProperty reason)
        if (-not $firstReason) { $firstReason = '' }
        if ($firstReason.Length -gt 120) { $firstReason = $firstReason.Substring(0, 117) + '...' }
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $notifyPath `
                -Title 'Health: RED' `
                -Body  ("$failedNames`: $firstReason") `
                -Severity 'Critical' `
                -Component 'health-runner' 2>&1 | Out-Null
        } catch {
            Write-Host ("[health-runner] toast failed: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        }
    }
}

# Stdout summary
if (-not $Quiet) {
    $color = switch ($aggregate) {
        'green' { 'Green' }
        'amber' { 'Yellow' }
        'red'   { 'Red' }
        default { 'Gray' }
    }
    $secs = [math]::Round($totalSw.Elapsed.TotalSeconds, 1)
    Write-Host ("[health-runner] {0} | red={1} amber={2} green={3} skip={4} | {5}s" -f `
        $aggregate.ToUpper(), $failCount, $warnCount, $passCount, $skipCount, $secs) -ForegroundColor $color
}

# Exit code: 0 green, 1 red, 2 amber
switch ($aggregate) {
    'green' { exit 0 }
    'red'   { exit 1 }
    'amber' { exit 2 }
    default { exit 0 }
}
