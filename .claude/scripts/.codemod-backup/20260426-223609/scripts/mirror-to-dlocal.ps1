# mirror-to-dlocal.ps1
# Mirrors critical data to D:\ClaudeCode-Mirror as local redundancy layer.
# Runs hourly; skips if D: is unmounted (user unplugged — intentional airgap).
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$target = "D:\ClaudeCode-Mirror"
$log = "D:\ClaudeCode-Mirror\_mirror.log"

# Abort if D: not mounted
if (-not (Test-Path "D:\")) {
    Write-Output "D: not mounted — skipping mirror (airgap mode)"
    exit 0
}

if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
}

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $log -Value "[$ts] mirror start"

# 1. Mirror .claude/ (exclude transient)
& robocopy.exe `
    "C:\Users\Avi Bendetsky\.claude" `
    "$target\.claude" `
    /MIR /FFT /Z /W:2 /R:2 /XJ `
    /XD "cache" "session-env" "session-logs" "shell-snapshots" "node_modules" ".git\objects\pack" `
    /XF "*.tmp" "*.log" "*.pre-*-20??????-*" ".credentials.json" `
    /NP /NDL /NJH /NJS | Out-Null

# 2. Mirror Total Recall DB (explicit file copy)
$trSrc = "C:\Users\Avi Bendetsky\AppData\Roaming\total-recall"
$trDst = "$target\total-recall"
if (Test-Path $trSrc) {
    if (-not (Test-Path $trDst)) { New-Item -ItemType Directory -Path $trDst -Force | Out-Null }
    & robocopy.exe $trSrc $trDst data.db data.db.backup config.json `
        /FFT /Z /W:2 /R:2 /NP /NDL /NJH /NJS | Out-Null
    # Backup DB dir
    if (Test-Path "$trSrc\backups") {
        & robocopy.exe "$trSrc\backups" "$trDst\backups" /MIR /FFT /Z /W:2 /R:2 /NP /NDL /NJH /NJS | Out-Null
    }
}

# 3. Mirror .claude.json main config
Copy-Item "C:\Users\Avi Bendetsky\.claude.json" "$target\.claude.json" -Force -ErrorAction SilentlyContinue

# 4. Compute + log sizes
$size = (Get-ChildItem $target -Recurse -ErrorAction SilentlyContinue | Measure-Object -Sum Length).Sum / 1MB
$sizeStr = "{0:N1} MB" -f $size
Add-Content -Path $log -Value "[$ts] mirror OK — $sizeStr total"

Write-Output "Mirror complete: $target ($sizeStr)"
