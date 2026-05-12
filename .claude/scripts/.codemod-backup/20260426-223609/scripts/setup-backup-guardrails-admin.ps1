# setup-backup-guardrails-admin.ps1
# Run as Administrator.
# Configures: System Restore, VSS shadow copies, auto-commit scheduled task.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Must run as Administrator. Right-click PowerShell → Run as Administrator."
    exit 1
}

Write-Output "=== Phase 2 admin setup ==="
Write-Output ""

# --- 1. Enable System Protection (System Restore) on C: ---
Write-Output "[1/4] Enabling System Restore on C:"
try {
    Enable-ComputerRestore -Drive "C:\" -ErrorAction Stop
    # Adjust disk usage (default 3%, bump to 10%)
    vssadmin resize shadowstorage /for=C: /on=C: /maxsize=10% 2>&1 | Out-Null
    # Create initial restore point
    Checkpoint-Computer -Description "Post-recovery baseline $(Get-Date -Format yyyy-MM-dd)" -RestorePointType "MODIFY_SETTINGS" -ErrorAction Stop
    Write-Output "  OK — System Restore enabled, baseline created"
} catch {
    Write-Output "  WARN: $_"
}

# --- 2. VSS automatic shadow copies (daily 7am + noon) ---
Write-Output "[2/4] Configuring VSS shadow copies schedule"
try {
    # Task: create VSS snapshot of C: twice daily
    $vssAction = New-ScheduledTaskAction -Execute "C:\Windows\System32\vssadmin.exe" -Argument "create shadow /for=C:"
    $vssTrigger1 = New-ScheduledTaskTrigger -Daily -At 7am
    $vssTrigger2 = New-ScheduledTaskTrigger -Daily -At 12pm
    $vssSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    $vssPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
    Register-ScheduledTask -TaskName "ClaudeCode-VSS-Snapshot" -Action $vssAction -Trigger @($vssTrigger1, $vssTrigger2) -Settings $vssSettings -Principal $vssPrincipal -Force | Out-Null
    Write-Output "  OK — VSS snapshot task registered (7am + 12pm daily)"
} catch {
    Write-Output "  WARN: $_"
}

# --- 3. Git auto-commit scheduled task ---
Write-Output "[3/4] Registering git auto-commit task"
try {
    $gcAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\Avi Bendetsky\.claude\scripts\git-autocommit-claude.ps1"'
    $gcTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 30)
    $gcSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $gcPrincipal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName "ClaudeCode-Git-AutoCommit" -Action $gcAction -Trigger $gcTrigger -Settings $gcSettings -Principal $gcPrincipal -Force | Out-Null
    Write-Output "  OK — Auto-commit task registered (every 30 min)"
} catch {
    Write-Output "  WARN: $_"
}

# --- 4. Weekly Windows image backup (wbadmin) ---
Write-Output "[4/4] Weekly system image backup"
try {
    # Target external drive if exists, else skip
    $targets = @("D:\SystemImageBackups", "E:\SystemImageBackups")
    $imgTarget = $null
    foreach ($t in $targets) {
        $drive = $t.Substring(0, 2)
        if (Test-Path $drive) { $imgTarget = $t; break }
    }
    if ($imgTarget) {
        if (-not (Test-Path $imgTarget)) { New-Item -ItemType Directory -Path $imgTarget -Force | Out-Null }
        $imgAction = New-ScheduledTaskAction -Execute "wbadmin.exe" -Argument "start backup -backupTarget:$imgTarget -include:C: -allCritical -quiet"
        $imgTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
        $imgSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4)
        $imgPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
        Register-ScheduledTask -TaskName "ClaudeCode-Weekly-ImageBackup" -Action $imgAction -Trigger $imgTrigger -Settings $imgSettings -Principal $imgPrincipal -Force | Out-Null
        Write-Output "  OK — Weekly image backup to $imgTarget (Sunday 3am)"
    } else {
        Write-Output "  SKIP — no external drive (D: or E:) found. Attach drive and re-run."
    }
} catch {
    Write-Output "  WARN: $_"
}

Write-Output ""
Write-Output "=== DONE ==="
Write-Output "Scheduled tasks:"
Get-ScheduledTask | Where-Object { $_.TaskName -match '^ClaudeCode-' } | Select-Object TaskName, State | Format-Table -AutoSize
