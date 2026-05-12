# Scheduled zombie reaper — runs every 2 minutes via Task Scheduler.
# Kills orphaned MCP server processes from Claude Code sessions on Windows.
# Logs kills to ~/.claude/_logs/zombie-reaper.log

$logDir = "$env:USERPROFILE\.claude\_logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = "$logDir\zombie-reaper.log"

$self = $PID
$killed = 0
$patterns = @(
    'playwright', 'context7', 'mcp-pdf', 'server-pdf', 'vault_mcp',
    'knowledge-graph', 'watchdog-security', 'serena', 'windows-mcp',
    'cursortouch', 'graphiti', 'synthlang', 'total-recall', 'fact-mcp',
    'design-extract', 'chrome-devtools-mcp', 'npx-cli.js', 'caveman-activate',
    'context-mode', 'uv\cache\builds', 'uv\cache\archive',
    'avios-context-mcp', 'sequential-thinking', 'claude-bridge'
)

$cutoff = (Get-Date).AddMinutes(-3)

# Build live PID set
$alive = @{}
Get-Process | ForEach-Object { $alive[$_.Id] = $true }

# Phase 1: Kill MCP zombie processes older than 3 min with dead parents
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @('node.exe', 'python.exe', 'cmd.exe') -and
    $_.ProcessId -ne $self -and
    $_.CreationDate -lt $cutoff
} | ForEach-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) { return }
    $match = $false
    foreach ($p in $patterns) { if ($cmd -like "*$p*") { $match = $true; break } }
    if (-not $match) { return }

    # Only kill if parent is dead (orphaned)
    $parentAlive = $_.ParentProcessId -gt 0 -and $alive.ContainsKey($_.ParentProcessId)
    if (-not $parentAlive) {
        taskkill /F /T /PID $_.ProcessId 2>$null | Out-Null
        $killed++
    }
}

# Phase 2: Kill orphaned conhosts older than 3 min
Get-CimInstance Win32_Process -Filter "Name='conhost.exe'" | Where-Object {
    $_.ProcessId -ne $self -and $_.CreationDate -lt $cutoff
} | ForEach-Object {
    if ($_.ParentProcessId -gt 0 -and -not $alive.ContainsKey($_.ParentProcessId)) {
        taskkill /F /PID $_.ProcessId 2>$null | Out-Null
        $killed++
    }
}

# Phase 3: Kill/sandbox stale Claude Code CLI sessions
# Rule A: 2-8h old AND idle (< 60s CPU) — abandoned tab, kill it
# Rule B: 8h+ AND idle (< 120s CPU) — flag for user review, don't kill
$ccIdleCutoff = (Get-Date).AddHours(-2)
$ccOldCutoff = (Get-Date).AddHours(-8)
$idleCpuShort = 60   # seconds — threshold for 2-8h sessions
$idleCpuLong = 120   # seconds — threshold for 8h+ sessions
$sandboxFile = "$env:USERPROFILE\.claude\_logs\stale-sessions.json"

Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match 'claude-code.*claude\.exe.*stream-json'
} | ForEach-Object {
    $age = ((Get-Date) - $_.CreationDate).TotalHours
    $proc = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { return }
    $cpuSec = [math]::Round($proc.TotalProcessorTime.TotalSeconds)
    $mb = [math]::Round($proc.WorkingSet64 / 1MB)

    if ($_.CreationDate -lt $ccOldCutoff -and $cpuSec -lt $idleCpuLong) {
        # Rule B: old + idle — sandbox (suspend + flag for user)
        # Suspend the process to stop resource usage
        try {
            # Use debug API to suspend — lightweight freeze
            & pssuspend64.exe $_.ProcessId 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) {
                # pssuspend not available — just flag without suspending
            }
        } catch {}

        # Write to stale-sessions log for user review
        $entry = @{
            pid = $_.ProcessId
            age_hours = [math]::Round($age, 1)
            cpu_seconds = $cpuSec
            mb = $mb
            created = $_.CreationDate.ToString("yyyy-MM-dd HH:mm")
            flagged = (Get-Date).ToString("yyyy-MM-dd HH:mm")
            status = "sandboxed"
        }
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path $logFile -Value "$ts | SANDBOXED PID=$($_.ProcessId) age=$([math]::Round($age,1))h cpu=${cpuSec}s mb=$mb — awaiting user decision"
    }
    elseif ($_.CreationDate -lt $ccIdleCutoff -and $_.CreationDate -ge $ccOldCutoff -and $cpuSec -lt $idleCpuShort) {
        # Rule A: 2-8h + idle — kill
        taskkill /T /F /PID $_.ProcessId 2>$null | Out-Null
        $killed++
    }
    # Active sessions (high CPU) at any age: left alone
}

if ($killed -gt 0) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "$ts | Reaped $killed orphaned process(es)"
}
