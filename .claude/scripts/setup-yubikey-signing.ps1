<#
.SYNOPSIS
  Configure git to sign commits with a hardware-resident SSH key on a
  YubiKey 5 (FIDO2 ed25519-sk).

.DESCRIPTION
  Replaces the current software ed25519 signing key
  (~/.ssh/id_ed25519) with a hardware-bound ed25519-sk key. The private
  scalar never leaves the YubiKey; signing requires the device + a touch.

  After this script:
    - ~/.ssh/id_ed25519_sk{,.pub} exist (the .pub holds the public half;
      the private file is just a credential handle, useless without the
      YubiKey).
    - git config user.signingkey points to the .pub.
    - The new .pub is appended to ~/.config/git/allowed_signers so local
      `git log --show-signature` validates.
    - GitHub still needs the new pub uploaded as a Signing Key — script
      copies it to clipboard + opens the page.

  Prereqs (one-time, manual):
    1. Plug in a YubiKey 5 (or any FIDO2/U2F authenticator with
       ed25519-sk support).
    2. OpenSSH 8.2+ (Windows 10/11 ships 8.x; verify: ssh -V).
    3. Optional: set a YubiKey PIN at https://www.yubico.com/manager/.

  After running:
    - Old SSH auth key on GitHub stays valid (we don't revoke).
    - Old signing key registration on GitHub should be deleted manually
      to ensure all NEW commits use the hardware key.

.PARAMETER KeyName
  ssh-keygen output filename. Default: id_ed25519_sk

.PARAMETER Comment
  Embedded comment in the public key. Default: "claude-home-yubikey-<hostname>"

.PARAMETER Resident
  If set, generate a *resident* credential (key data lives on the YubiKey
  itself; usable from any machine with `ssh-keygen -K`). Default: false
  (non-resident — credential file required alongside the YubiKey).
#>
[CmdletBinding()]
param(
    [string]$KeyName  = 'id_ed25519_sk',
    [string]$Comment  = "claude-home-yubikey-$env:COMPUTERNAME",
    [switch]$Resident
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 1. Pre-flight
$sshDir = Join-Path $env:USERPROFILE '.ssh'
if (-not (Test-Path $sshDir)) { New-Item -Path $sshDir -ItemType Directory -Force | Out-Null }

$keyPath  = Join-Path $sshDir $KeyName
$pubPath  = "$keyPath.pub"

$ssh = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $ssh) { throw 'ssh.exe not on PATH' }
$keygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
if (-not $keygen) { throw 'ssh-keygen not on PATH' }

$ver = & ssh -V 2>&1
if ($ver -notmatch 'OpenSSH_(\d+)\.(\d+)') {
    Write-Output "WARN: could not parse ssh version: $ver"
} else {
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]
    if ($major -lt 8 -or ($major -eq 8 -and $minor -lt 2)) {
        throw "OpenSSH 8.2+ required for ed25519-sk; found $ver"
    }
}

if (Test-Path $keyPath) {
    Write-Output "Key already exists at $keyPath. Refusing to overwrite."
    Write-Output "Delete or move it first if you want a fresh one."
    Write-Output "  Move-Item '$keyPath' '$keyPath.bak.$(Get-Date -f yyyyMMddHHmm)'"
    exit 1
}

# 2. Generate
Write-Output 'Generating hardware-bound ed25519-sk key...'
Write-Output 'Touch the YubiKey when its LED blinks.'
$flags = @('-t', 'ed25519-sk', '-O', 'application=ssh:claude-home', '-C', $Comment, '-f', $keyPath, '-N', '')
if ($Resident) { $flags += @('-O', 'resident') }

& ssh-keygen @flags
if ($LASTEXITCODE -ne 0) {
    throw "ssh-keygen failed (exit $LASTEXITCODE). Common causes: no FIDO2 device, device locked, OpenSSH < 8.2, missing libfido2."
}

if (-not (Test-Path $pubPath)) { throw "Expected $pubPath after ssh-keygen, not found." }

# 3. Wire git
Write-Output ''
Write-Output 'Configuring git signing...'
& git config --global gpg.format ssh
& git config --global user.signingkey $pubPath
& git config --global commit.gpgsign true
& git config --global tag.gpgsign true

# allowed_signers entry — local verify
$allowedSigners = Join-Path $env:USERPROFILE '.config\git\allowed_signers'
$asDir = Split-Path $allowedSigners -Parent
if (-not (Test-Path $asDir)) { New-Item -Path $asDir -ItemType Directory -Force | Out-Null }
$pubLine = (Get-Content $pubPath -Raw).Trim()
$email = (& git config --global user.email).Trim()
if (-not $email) { throw 'git config user.email is unset; set it before signing' }
$asLine = "$email $pubLine"
if (-not (Test-Path $allowedSigners) -or -not (Select-String -Path $allowedSigners -SimpleMatch $pubLine -Quiet)) {
    Add-Content -Path $allowedSigners -Value $asLine -Encoding UTF8
    Write-Output "  Appended to $allowedSigners"
}
& git config --global gpg.ssh.allowedSignersFile $allowedSigners

# 4. Test sign
Write-Output ''
Write-Output 'Test-signing a synthetic commit...'
$repo = Join-Path $env:TEMP "yubikey-sign-test-$(Get-Random)"
New-Item -Path $repo -ItemType Directory -Force | Out-Null
Push-Location $repo
try {
    & git init --quiet
    'hello' | Out-File 'a.txt' -Encoding UTF8
    & git add a.txt
    Write-Output 'Touch YubiKey to sign...'
    & git commit -S -m 'yubikey signing test' --quiet
    if ($LASTEXITCODE -ne 0) { throw "test commit failed" }
    $sig = & git log --show-signature -1 2>&1
    if ($sig -match 'Good "git" signature') {
        Write-Output '  Test commit signed and verified.'
    } else {
        Write-Output 'Verification output:'
        Write-Output $sig
    }
}
finally {
    Pop-Location
    Remove-Item $repo -Recurse -Force -ErrorAction SilentlyContinue
}

# 5. Upload pub to GitHub
Write-Output ''
Write-Output 'Copying public key to clipboard...'
$pubLine | Set-Clipboard
Write-Output 'Open https://github.com/settings/ssh/new'
Write-Output '  Title:    yubikey-signing'
Write-Output '  Key type: SIGNING KEY (not authentication)'
Write-Output '  Paste:    Ctrl+V'
Write-Output '  Save'
Write-Output ''
Write-Output 'After GitHub registration, delete the OLD signing key registration so'
Write-Output 'all NEW commits force the hardware key.'
Write-Output ''
Write-Output 'Done. Next commit will require a YubiKey touch.'

# 6. Audit log
$audit = Join-Path $env:USERPROFILE '.claude\scripts\audit_chain.py'
if (Test-Path $audit) {
    & python $audit log security yubikey_signing_enabled -f keypath="$pubPath" -f resident=$Resident.IsPresent -f host=$env:COMPUTERNAME 2>&1 | Out-Null
}
