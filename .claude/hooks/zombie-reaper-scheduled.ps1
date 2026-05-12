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

if ($killed -gt 0) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "$ts | Reaped $killed orphaned process(es)"
}
