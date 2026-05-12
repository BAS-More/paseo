<#
.SYNOPSIS
  End-to-end validation of every MCP server in mcp-registry.json.

.DESCRIPTION
  For each server:
    1. Entry file exists                    (skipped for npx/uvx)
    2. Spawns via its command + args        (no immediate crash)
    3. Responds to MCP `initialize`         (JSON-RPC handshake over stdio)
    4. Reports server name + version + tool count from the handshake

  Output: table + JSONL log at ~/.claude/_logs/mcp-handshake.jsonl
  Exit 0 = all critical pass, Exit 1 = any critical fail.
#>

[CmdletBinding()]
param(
    [string]$RegistryPath = (Join-Path $env:USERPROFILE '.claude\mcp-registry.json'),
    [int]$HandshakeTimeoutSec = 10
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $env:USERPROFILE '.claude\_logs\mcp-handshake.jsonl'
$logDir  = Split-Path $logPath
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-JsonLog { param($obj)
    ($obj | ConvertTo-Json -Compress -Depth 6) | Add-Content -Path $logPath -Encoding UTF8
}

if (-not (Test-Path $RegistryPath)) { throw "Registry missing: $RegistryPath" }
$reg = Get-Content $RegistryPath -Raw | ConvertFrom-Json

$results = @()

foreach ($name in ($reg.servers | Get-Member -MemberType NoteProperty | ForEach-Object Name)) {
    $cfg = $reg.servers.$name
    $row = [ordered]@{
        server   = $name
        critical = [bool]$cfg.critical
        file_ok  = $null
        spawn_ok = $null
        handshake_ok = $null
        server_name = $null
        server_version = $null
        tool_count = $null
        error = $null
        ts = (Get-Date).ToString('o')
    }

    if ($cfg.entry_check) {
        $row.file_ok = [bool](Test-Path $cfg.entry_check)
        if (-not $row.file_ok) {
            $row.error = "entry_file_missing: $($cfg.entry_check)"
            $results += [pscustomobject]$row
            Write-JsonLog ([pscustomobject]$row)
            continue
        }
    } else {
        $row.file_ok = $true
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    # Windows: npx/yarn/pnpm are .cmd shims — Process.Start can't find them
    # unless we resolve the full path or route through cmd.exe.
    $cmdName = [string]$cfg.command
    $isExeLike = ($cmdName -match '\.exe$') -or ($cmdName -match '[\\/]') -or (Test-Path $cmdName -ErrorAction SilentlyContinue)
    $needsShell = -not $isExeLike

    $argStr = ($cfg.args | ForEach-Object {
        $s = [string]$_
        if ($s -match '\s') { '"' + $s + '"' } else { $s }
    }) -join ' '

    if ($needsShell) {
        $psi.FileName  = $env:ComSpec   # cmd.exe
        $psi.Arguments = "/c $cmdName $argStr"
    } else {
        $psi.FileName  = $cmdName
        $psi.Arguments = $argStr
    }
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow  = $true

    $proc = $null
    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) {
            $stderr = $proc.StandardError.ReadToEnd()
            $row.spawn_ok = $false
            $snippet = if ($stderr) { $stderr.Substring(0, [Math]::Min(240, $stderr.Length)) } else { '<no stderr>' }
            $row.error = "exited_early(code=$($proc.ExitCode)): $snippet"
            $results += [pscustomobject]$row
            Write-JsonLog ([pscustomobject]$row)
            continue
        }
        $row.spawn_ok = $true

        $initReq = @{
            jsonrpc = '2.0'
            id = 1
            method = 'initialize'
            params = @{
                protocolVersion = '2024-11-05'
                capabilities = @{}
                clientInfo = @{ name = 'mcp-validator'; version = '1.0' }
            }
        } | ConvertTo-Json -Compress -Depth 6

        $proc.StandardInput.WriteLine($initReq)
        $proc.StandardInput.Flush()

        $readTask = $proc.StandardOutput.ReadLineAsync()
        $deadline = [DateTime]::UtcNow.AddSeconds($HandshakeTimeoutSec)
        while (-not $readTask.IsCompleted -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 200
        }

        if (-not $readTask.IsCompleted) {
            $row.handshake_ok = $false
            $row.error = "handshake_timeout_${HandshakeTimeoutSec}s"
        } else {
            $line = $readTask.Result
            try {
                $resp = $line | ConvertFrom-Json
                if ($resp.result -and $resp.result.serverInfo) {
                    $row.handshake_ok = $true
                    $row.server_name = $resp.result.serverInfo.name
                    $row.server_version = $resp.result.serverInfo.version

                    $proc.StandardInput.WriteLine((@{jsonrpc='2.0';method='notifications/initialized';params=@{}} | ConvertTo-Json -Compress))
                    $proc.StandardInput.WriteLine((@{jsonrpc='2.0';id=2;method='tools/list';params=@{}} | ConvertTo-Json -Compress))
                    $proc.StandardInput.Flush()
                    $tl = $proc.StandardOutput.ReadLineAsync()
                    $dl2 = [DateTime]::UtcNow.AddSeconds(5)
                    while (-not $tl.IsCompleted -and [DateTime]::UtcNow -lt $dl2) { Start-Sleep -Milliseconds 150 }
                    if ($tl.IsCompleted) {
                        try {
                            $tresp = $tl.Result | ConvertFrom-Json
                            if ($tresp.result -and $tresp.result.tools) {
                                $row.tool_count = @($tresp.result.tools).Count
                            }
                        } catch { }
                    }
                } elseif ($resp.error) {
                    $row.handshake_ok = $false
                    $row.error = "rpc_error: $($resp.error.message)"
                } else {
                    $row.handshake_ok = $false
                    $snippet = if ($line) { $line.Substring(0,[Math]::Min(140,$line.Length)) } else { '<empty>' }
                    $row.error = "unexpected_response: $snippet"
                }
            } catch {
                $row.handshake_ok = $false
                $row.error = "parse_error: " + $_.Exception.Message
            }
        }
    } catch {
        $row.spawn_ok = $false
        $row.error = "spawn_exception: " + $_.Exception.Message
    } finally {
        if ($proc -and -not $proc.HasExited) {
            try { $proc.Kill($true) } catch { }
        }
    }

    $results += [pscustomobject]$row
    Write-JsonLog ([pscustomobject]$row)
}

Write-Host ""
Write-Host "=== MCP Handshake Validation Report ===" -ForegroundColor Cyan
$results | Format-Table server, critical, file_ok, spawn_ok, handshake_ok, server_name, server_version, tool_count, error -AutoSize -Wrap

$criticalFails = $results | Where-Object { $_.critical -and -not $_.handshake_ok }
$totalPass     = ($results | Where-Object handshake_ok).Count
$totalCount    = $results.Count

Write-Host ""
Write-Host "Passed: $totalPass / $totalCount" -ForegroundColor $(if ($totalPass -eq $totalCount) { 'Green' } else { 'Yellow' })
Write-Host "Log:    $logPath"

if ($criticalFails) {
    Write-Host ""
    Write-Host "CRITICAL FAILURES:" -ForegroundColor Red
    $criticalFails | ForEach-Object { Write-Host "  - $($_.server): $($_.error)" -ForegroundColor Red }
    exit 1
}
exit 0
