<#
.SYNOPSIS
  Decrypt + extract a third-provider backup bundle.

.DESCRIPTION
  Counterpart to backup-to-third-provider.ps1. Reads a .tar.enc bundle,
  decrypts with AES-GCM using the passphrase from vault (`third-backup/passphrase`),
  extracts to the chosen target.

.PARAMETER Archive
  Path to .tar.enc bundle. Defaults to most-recent in D:\ThirdBackup.

.PARAMETER Out
  Target dir (must not exist or be empty). Defaults to $env:TEMP\claude-restored-<timestamp>.

.EXAMPLE
  pwsh -File restore-from-third-provider.ps1
  pwsh -File restore-from-third-provider.ps1 -Archive D:\ThirdBackup\claude-resilience-2026-04-22-1200.tar.enc
#>

[CmdletBinding()]
param(
    [string]$Archive,
    [string]$Out
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $Archive) {
    $default = 'D:\ThirdBackup'
    if (-not (Test-Path $default)) { throw 'no -Archive given and D:\ThirdBackup does not exist' }
    $latest = Get-ChildItem $default -Filter 'claude-resilience-*.tar.enc' |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw "no claude-resilience-*.tar.enc in $default" }
    $Archive = $latest.FullName
}

if (-not (Test-Path $Archive)) { throw "archive missing: $Archive" }

if (-not $Out) {
    $Out = Join-Path $env:TEMP "claude-restored-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
}

if (Test-Path $Out) {
    $items = Get-ChildItem $Out -Force -ErrorAction SilentlyContinue
    if ($items.Count -gt 0) { throw "-Out exists and is not empty: $Out" }
} else {
    New-Item -Path $Out -ItemType Directory -Force | Out-Null
}

Write-Output "Archive: $Archive"
Write-Output "Target:  $Out"

# Fetch passphrase
$passphrase = & python 'C:\Dev\tools\vault\vault.py' get third-backup passphrase 2>&1
if ($LASTEXITCODE -ne 0) { throw 'vault missing third-backup/passphrase' }
$passphrase = $passphrase.Trim()

# Read envelope
$bytes = [System.IO.File]::ReadAllBytes($Archive)
if ($bytes.Length -lt (4 + 32 + 12 + 16)) { throw 'archive too short' }

$magic = [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4)
if ($magic -ne 'TB01') { throw "unknown format: $magic" }

$salt = $bytes[4..35]
$nonce = $bytes[36..47]
$tag = $bytes[48..63]
$ciphertext = $bytes[64..($bytes.Length - 1)]

# Derive key
$pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes(
    $passphrase, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
$key = $pbkdf2.GetBytes(32)

# Decrypt
$plaintext = New-Object byte[] $ciphertext.Length
$aes = New-Object System.Security.Cryptography.AesGcm($key, 16)
try {
    $aes.Decrypt($nonce, $ciphertext, $tag, $plaintext)
} finally { $aes.Dispose() }

# Write tar + extract
$tar = Join-Path $env:TEMP "restore-$(Get-Date -Format 'yyyyMMddHHmmss').tar"
[System.IO.File]::WriteAllBytes($tar, $plaintext)

try {
    Push-Location $Out
    try { & tar -xf $tar } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "tar extract failed (exit $LASTEXITCODE)" }
}
finally {
    Remove-Item $tar -Force -ErrorAction SilentlyContinue
}

$count = (Get-ChildItem $Out -Recurse -File | Measure-Object).Count
Write-Output "Extracted $count files to $Out"
