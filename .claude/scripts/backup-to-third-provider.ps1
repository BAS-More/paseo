<#
.SYNOPSIS
  Third-region backup — escape MS-owned infra (OneDrive + GitHub both MS).

.DESCRIPTION
  Creates an encrypted tarball of critical state and uploads to a
  non-Microsoft backup target. Default: local encrypted bundle in
  D:\ThirdBackup\ (separate physical device). Optional: extend to
  Backblaze B2, Google Drive, or rsync.net via pluggable uploader.

  Contents bundled:
    - ~/.claude/ (minus gitignored)
    - ~/.claude.json
    - Vault .vault export (already encrypted, safe to include)
    - mcp-manifest.json
    - RECOVERY.md

  Encryption: AES-256 via OpenSSL (or built-in .NET AES if openssl absent).
  Passphrase: fetched from vault as `third-backup/passphrase` —
  `python C:/Dev/tools/vault/vault.py set third-backup passphrase <long-random>`

  Retention: keeps last 8 archives (rolling 8-week window if run weekly).

.PARAMETER Target
  Override default target dir (D:\ThirdBackup).

.PARAMETER KeepCount
  How many archives to retain (default 8).
#>

[CmdletBinding()]
param(
    [string]$Target = 'D:\ThirdBackup',
    [int]$KeepCount = 8
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$stamp  = Get-Date -Format 'yyyy-MM-dd-HHmm'
$vault  = 'C:\Dev\tools\vault\vault.py'
$claudeDir = Join-Path $env:USERPROFILE '.claude'
$claudeJson = Join-Path $env:USERPROFILE '.claude.json'
$notify = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'
$logDir = Join-Path $claudeDir '_logs'
$logFile = Join-Path $logDir "third-backup-$stamp.log"

function Log($msg) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
    Write-Output $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

New-Item -Path $logDir -ItemType Directory -Force | Out-Null

# Verify target drive present (e.g. external USB). If not, exit cleanly so
# Task Scheduler doesn't show this as a failure when the drive isn't plugged in.
$targetRoot = ([System.IO.Path]::GetPathRoot($Target)).TrimEnd('\')
if ($targetRoot -and -not (Test-Path $targetRoot)) {
    Log "Target drive '$targetRoot' not present (external drive unplugged?). Skipping cleanly."
    exit 0
}

New-Item -Path $Target -ItemType Directory -Force | Out-Null
Log "Third-provider backup starting -> $Target"

# 1. Fetch passphrase from vault
Log 'Fetching passphrase from vault...'
$passphrase = & python $vault get third-backup passphrase 2>&1
if ($LASTEXITCODE -ne 0) {
    $msg = "vault get third-backup/passphrase failed. Set via: python $vault set third-backup passphrase <32+char-random>"
    Log $msg
    if (Test-Path $notify) { & pwsh -NoProfile -File $notify -Title 'Third-backup needs setup' -Message $msg 2>&1 | Out-Null }
    throw $msg
}
$passphrase = $passphrase.Trim()
if ($passphrase.Length -lt 16) { throw 'passphrase too short — regenerate' }

# 2. Stage bundle in TEMP (never leave decrypted on disk outside TEMP)
$stage = Join-Path $env:TEMP "third-backup-$stamp"
New-Item -Path $stage -ItemType Directory -Force | Out-Null
Log "Staging in $stage"

try {
    # 2a. Copy ~/.claude but exclude what .gitignore excludes + caches
    $exclude = @(
        '.git', 'node_modules', 'cache', 'session-env', 'session-logs',
        'shell-snapshots', 'sessions', 'plugins', '_logs',
        'backups'  # historical snapshots already redundant
    )
    $dest = Join-Path $stage '.claude'
    New-Item -Path $dest -ItemType Directory -Force | Out-Null
    $excludeArgs = $exclude | ForEach-Object { '/XD'; (Join-Path $claudeDir $_) }
    & robocopy $claudeDir $dest /E /NDL /NP /NJH /NJS /R:2 /W:5 @excludeArgs 2>&1 | Out-Null
    # robocopy exit <8 = success
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }

    # 2b. Copy .claude.json (sibling file)
    Copy-Item $claudeJson (Join-Path $stage '.claude.json') -Force

    # 2c. Include vault backup if present
    $oneDriveRoot = if ($env:OneDrive) { $env:OneDrive } else { Join-Path $env:USERPROFILE 'OneDrive' }
    $vaultBackup = Join-Path $oneDriveRoot 'ClaudeVault\vault.sync'
    if (Test-Path $vaultBackup) {
        Copy-Item $vaultBackup (Join-Path $stage 'vault.sync') -Force
        Log "  included vault.sync"
    }

    # 3. Tar the stage dir (tar is built into Windows 10+)
    # Use absolute path to Windows tar.exe — Git Bash / MSYS2 tar shadows it
    # in PATH and treats Windows paths (e.g. C:) as remote-host references,
    # failing with: "Cannot connect to C: resolve failed" (exit 128).
    $tar = Join-Path $env:TEMP "third-backup-$stamp.tar"
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $tarExe)) { throw "Windows tar.exe not found at $tarExe (Win10+ required)" }
    Push-Location $stage
    try {
        $tarOut = & $tarExe -cf $tar . 2>&1
        if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE): $tarOut" }
    } finally { Pop-Location }

    $tarSize = (Get-Item $tar).Length
    Log "Tarball: $tarSize bytes"

    # 4. Encrypt with AES-256-GCM via .NET (no openssl dependency)
    $encrypted = Join-Path $Target "claude-resilience-$stamp.tar.enc"
    Add-Type -AssemblyName System.Security

    # Derive key via PBKDF2 with random salt
    $salt = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($salt)
    $nonce = New-Object byte[] 12
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($nonce)
    $pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($passphrase, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $key = $pbkdf2.GetBytes(32)

    $plaintext = [System.IO.File]::ReadAllBytes($tar)
    $ciphertext = New-Object byte[] $plaintext.Length
    $tag = New-Object byte[] 16

    $aes = New-Object System.Security.Cryptography.AesGcm($key, 16)
    try {
        $aes.Encrypt($nonce, $plaintext, $ciphertext, $tag)
    } finally { $aes.Dispose() }

    # Envelope: magic(4) + salt(32) + nonce(12) + tag(16) + ciphertext
    $magic = [System.Text.Encoding]::ASCII.GetBytes('TB01')
    $out = New-Object System.IO.FileStream($encrypted, 'Create')
    try {
        $out.Write($magic, 0, 4)
        $out.Write($salt, 0, 32)
        $out.Write($nonce, 0, 12)
        $out.Write($tag, 0, 16)
        $out.Write($ciphertext, 0, $ciphertext.Length)
    } finally { $out.Dispose() }

    $encSize = (Get-Item $encrypted).Length
    Log "Encrypted: $encrypted ($encSize bytes)"

    # 5. Retention prune
    # Force array via @(...) — single-item results from Get-ChildItem return a
    # raw FileInfo without a .Count property under StrictMode.
    $all = @(Get-ChildItem $Target -Filter 'claude-resilience-*.tar.enc' -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending)
    if ($all.Count -gt $KeepCount) {
        $toDelete = $all | Select-Object -Skip $KeepCount
        foreach ($f in $toDelete) {
            Remove-Item $f.FullName -Force
            Log "  pruned $($f.Name)"
        }
    }

    $retained = [Math]::Min($all.Count, $KeepCount)
    Log "Success. Archives retained: $retained"
}
finally {
    # 6. Shred stage + unencrypted tar
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
    $tar = Join-Path $env:TEMP "third-backup-$stamp.tar"
    if (Test-Path $tar) { Remove-Item $tar -Force -ErrorAction SilentlyContinue }
}
