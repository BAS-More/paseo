<#
.SYNOPSIS
  Register ClaudeCode-R2-Backup scheduled task — daily encrypted offsite backup.

.DESCRIPTION
  Two-step pipeline:
    1. backup-to-third-provider.ps1 → encrypted .tar.enc in C:\ThirdBackup
    2. backup-to-r2.py             → upload newest bundle to Cloudflare R2

  Runs daily at 03:30. Logs to ~/.claude/_logs/. Fails the healthcheck-ping
  on error so healthchecks.io alerts.

  Prereqs (verified before registering):
    - vault: r2/access-key-id, r2/secret-access-key, r2/endpoint, r2/bucket
    - vault: third-backup/passphrase
    - python with boto3 installed
#>

[CmdletBinding()]
param(
    [string]$Time = '03:30',
    [string]$Target = 'C:\ThirdBackup'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName  = 'ClaudeCode-R2-Backup'
$thirdProv = Join-Path $env:USERPROFILE '.claude\scripts\backup-to-third-provider.ps1'
$r2Py      = Join-Path $env:USERPROFILE '.claude\scripts\backup-to-r2.py'
$wrapper   = Join-Path $env:USERPROFILE '.claude\scripts\_run-r2-backup.ps1'
$vault     = 'C:\Dev\tools\vault\vault.py'

foreach ($p in @($thirdProv, $r2Py, $vault)) {
    if (-not (Test-Path $p)) { throw "Missing: $p" }
}

# Verify pwsh (PowerShell 7+) is on PATH — the wrapper invokes
# `pwsh -NoProfile -File <thirdProv>` for step 1. Without it, every
# scheduled run dies before archive creation and the offsite chain never
# completes. Windows PowerShell 5.1 (`powershell.exe`) is not a drop-in
# replacement: backup-to-third-provider.ps1 uses AesGcm + PS7-only syntax.
$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $pwshCmd) {
    throw 'pwsh (PowerShell 7+) not on PATH. Install from https://aka.ms/PSWindows or run `winget install Microsoft.PowerShell` before registering this task.'
}

# Verify vault has required creds
$required = @(
    @{ s = 'r2'; k = 'access-key-id' },
    @{ s = 'r2'; k = 'secret-access-key' },
    @{ s = 'r2'; k = 'endpoint' },
    @{ s = 'r2'; k = 'bucket' },
    @{ s = 'third-backup'; k = 'passphrase' }
)
foreach ($r in $required) {
    $v = & python $vault get $r.s $r.k 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $v) {
        throw "Missing vault entry: $($r.s)/$($r.k). Run: python $vault set $($r.s) $($r.k) <value>"
    }
}

# Verify boto3
& python -c "import boto3" 2>$null
if ($LASTEXITCODE -ne 0) { throw 'boto3 not installed. Run: pip install boto3' }

# Wrapper script — chains the two steps with logging
$wrapperBody = @"
`$ErrorActionPreference = 'Continue'
`$logDir = Join-Path `$env:USERPROFILE '.claude\_logs'
New-Item -Path `$logDir -ItemType Directory -Force | Out-Null
`$log = Join-Path `$logDir ("r2-backup-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')

"[`$(Get-Date -Format 'HH:mm:ss')] === r2-backup chain starting ===" | Add-Content `$log

# Step 1: third-provider archive
& pwsh -NoProfile -File '$thirdProv' -Target '$Target' 2>&1 | Tee-Object -FilePath `$log -Append
`$step1 = `$LASTEXITCODE

# Step 2: R2 upload (always attempt — picks newest archive)
`$env:THIRDBACKUP_DIR = '$Target'
& python '$r2Py' 2>&1 | Tee-Object -FilePath `$log -Append
`$step2 = `$LASTEXITCODE

if (`$step1 -ne 0 -or `$step2 -ne 0) {
    "[`$(Get-Date -Format 'HH:mm:ss')] FAIL step1=`$step1 step2=`$step2" | Add-Content `$log
    exit 1
}
"[`$(Get-Date -Format 'HH:mm:ss')] === r2-backup chain ok ===" | Add-Content `$log
exit 0
"@
Set-Content -Path $wrapper -Value $wrapperBody -Encoding UTF8

$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapper`""

& schtasks /Delete /F /TN $taskName 2>&1 | Out-Null
& schtasks /Create /F /SC DAILY /ST $Time /TN $taskName /TR $cmd /RL LIMITED /IT 2>&1 | Out-String | Write-Output
