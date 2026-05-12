<#
.SYNOPSIS
  Rotate the SSH key used for git commit signing.

.DESCRIPTION
  Generates a fresh ed25519 key, registers it as the signing key in
  ~/.config/git/allowed_signers (keeping historical fingerprints valid),
  archives the previous key, and prints the public key so Avi can update
  GitHub / Codeberg signing-key entries.

  Cadence: quarterly via scheduled task or manual invocation. Limits the
  compromise window for the unencrypted key.

.PARAMETER Quarter
  Label suffix for the new key (e.g. 2026Q2). Defaults to current quarter.

.PARAMETER NoInteractive
  Skip all manual prompts. Required for scheduled-task use. Prints the
  pubkey to stdout but cannot upload it to GitHub/Codeberg — that still
  needs a human.
#>

[CmdletBinding()]
param(
    [string]$Quarter,
    [switch]$NoInteractive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $Quarter) {
    $m = [int](Get-Date -Format 'MM')
    $q = [Math]::Ceiling($m / 3)
    $Quarter = "$(Get-Date -Format 'yyyy')Q$q"
}

$sshDir = Join-Path $env:USERPROFILE '.ssh'
$oldKey = Join-Path $sshDir 'id_ed25519'
$oldPub = "$oldKey.pub"
$newKey = Join-Path $sshDir "id_ed25519_signing_$Quarter"
$newPub = "$newKey.pub"
$archiveDir = Join-Path $sshDir 'archive'

$allowedSignersDir  = Join-Path $env:USERPROFILE '.config\git'
$allowedSignersFile = Join-Path $allowedSignersDir 'allowed_signers'

New-Item -Path $archiveDir -ItemType Directory -Force | Out-Null
New-Item -Path $allowedSignersDir -ItemType Directory -Force | Out-Null

if (Test-Path $newKey) {
    Write-Output "Key for $Quarter already exists ($newKey). Skipping."
    exit 0
}

# 1. Generate new key, passphrase-less (machine-resident convention)
Write-Output "Generating new signing key: $newKey"
$comment = "claude-code-signing-$Quarter@avisurface"
& ssh-keygen -t ed25519 -f $newKey -N '""' -C $comment -q
if ($LASTEXITCODE -ne 0) { throw "ssh-keygen failed (exit $LASTEXITCODE)" }

# 2. Archive current key
if (Test-Path $oldKey) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item $oldKey (Join-Path $archiveDir "id_ed25519-$stamp") -Force
    Copy-Item $oldPub (Join-Path $archiveDir "id_ed25519-$stamp.pub") -Force
    Write-Output "Archived previous key -> $archiveDir"
}

# 3. Update allowed_signers (append new pubkey, keep old ones for historical verification)
$email = (& git -C (Join-Path $env:USERPROFILE '.claude') config user.email).Trim()
if (-not $email) { $email = 'avi@basnmore.com.au' }
$newPubLine = "$email namespaces=`"git`" $(Get-Content $newPub -Raw)".Trim()
if (Test-Path $allowedSignersFile) {
    $existing = Get-Content $allowedSignersFile
    # Dedup — only add if fingerprint not present
    $newFpMatch = ($newPubLine -split ' ')[-2..-1] -join ' '  # last two tokens = key data + comment
    $alreadyIn = $existing | Where-Object { $_ -like "*$newFpMatch*" }
    if (-not $alreadyIn) {
        Add-Content -Path $allowedSignersFile -Value $newPubLine -Encoding UTF8
        Write-Output "Appended new key to allowed_signers"
    } else {
        Write-Output "New key already in allowed_signers (deduped)"
    }
} else {
    Set-Content -Path $allowedSignersFile -Value $newPubLine -Encoding UTF8
    Write-Output "Created allowed_signers with new key"
}

# 4. Point git signing at new key (local to ~/.claude repo)
$claudeRepo = Join-Path $env:USERPROFILE '.claude'
if (Test-Path (Join-Path $claudeRepo '.git')) {
    & git -C $claudeRepo config user.signingkey $newPub 2>&1 | Out-Null
    Write-Output "Set ~/.claude signingkey -> $newPub"
}

# 5. Announce
Write-Output ''
Write-Output '─────────────────────────────────────────────────────────────'
Write-Output 'ACTION REQUIRED (manual):'
Write-Output ''
Write-Output '  1. Upload the new pubkey to GitHub as a SIGNING key:'
Write-Output '     https://github.com/settings/ssh/new?type=signing'
Write-Output '  2. Upload same to Codeberg (if configured)'
Write-Output ''
Write-Output '  Public key:'
Write-Output ''
Get-Content $newPub
Write-Output ''
Write-Output '─────────────────────────────────────────────────────────────'

if (-not $NoInteractive) {
    $notify = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'
    if (Test-Path $notify) {
        & pwsh -NoProfile -File $notify -Title 'SSH signing key rotated' -Message "New key: $newPub. Upload to GitHub signing keys."
    }
}
