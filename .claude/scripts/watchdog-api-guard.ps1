$ErrorActionPreference = 'Continue'
$logDir = Join-Path $env:USERPROFILE '.claude\_logs'
$log = Join-Path $logDir 'watchdog-api.log'
New-Item -Path $logDir -ItemType Directory -Force | Out-Null
$backoff = 5

function Write-Log([string]$msg) {
    $fs = [System.IO.FileStream]::new($log, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    $sw = [System.IO.StreamWriter]::new($fs)
    $sw.WriteLine($msg)
    $sw.Close()
    $fs.Close()
}

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { $nodePath = 'node' }
$scriptPath = 'C:\Dev\watchdog-security\dist\index.js'

while ($true) {
    try {
        Write-Log "[$(Get-Date -Format 'o')] starting watchdog api"
        # Use cmd /c with native > redirection. PowerShell's Start-Process
        # and pipe-based redirections both cause node event loop hangs under
        # PS 5.1 due to file descriptor buffering issues.
        $outFile = "$log.stdout"
        & cmd /c "`"$nodePath`" `"$scriptPath`" api start > `"$outFile`" 2>&1"
        if (Test-Path $outFile) {
            $size = (Get-Item $outFile).Length
            Write-Log "[$(Get-Date -Format 'o')] api exited (code $LASTEXITCODE, ${size}B output)"
            Remove-Item $outFile -Force -ErrorAction SilentlyContinue
        } else {
            Write-Log "[$(Get-Date -Format 'o')] api exited (code $LASTEXITCODE)"
        }
    } catch {
        Write-Log "[$(Get-Date -Format 'o')] guard caught: $_"
    }
    Start-Sleep -Seconds $backoff
    $backoff = [Math]::Min($backoff * 2, 300)
}
