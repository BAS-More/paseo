$ErrorActionPreference = 'Continue'
$logDir = Join-Path $env:USERPROFILE '.claude\_logs'
New-Item -Path $logDir -ItemType Directory -Force | Out-Null
$log = Join-Path $logDir ("r2-backup-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')

"[$(Get-Date -Format 'HH:mm:ss')] === r2-backup chain starting ===" | Add-Content $log

# Step 1: third-provider archive
& pwsh -NoProfile -File '$env:USERPROFILE\.claude\scripts\backup-to-third-provider.ps1' -Target 'C:\ThirdBackup' 2>&1 | Tee-Object -FilePath $log -Append
$step1 = $LASTEXITCODE

# Step 2: R2 upload (always attempt — picks newest archive)
$env:THIRDBACKUP_DIR = 'C:\ThirdBackup'
& python '$env:USERPROFILE\.claude\scripts\backup-to-r2.py' 2>&1 | Tee-Object -FilePath $log -Append
$step2 = $LASTEXITCODE

if ($step1 -ne 0 -or $step2 -ne 0) {
    "[$(Get-Date -Format 'HH:mm:ss')] FAIL step1=$step1 step2=$step2" | Add-Content $log
    exit 1
}
"[$(Get-Date -Format 'HH:mm:ss')] === r2-backup chain ok ===" | Add-Content $log
exit 0
