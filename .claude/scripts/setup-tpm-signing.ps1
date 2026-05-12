<#
.SYNOPSIS
  Configure git to sign commits with a TPM-backed SSH key via Windows Hello
  (FIDO2 platform authenticator). Free, hardware-backed, but bound to this PC.

.DESCRIPTION
  Generates an ed25519-sk SSH key whose private scalar is sealed by the
  TPM 2.0 chip on this laptop. Signing requires Windows Hello (PIN /
  fingerprint / face) per commit. Equivalent security to a YubiKey for
  the laptop-compromise threat — adversary with full disk access still
  cannot extract the key — but with no portability across machines.

  Trade-offs vs. YubiKey:
    + Free (uses chip already in this laptop)
    + No physical device to lose
    - Bound to THIS PC. Fresh laptop = regenerate key + re-register on GitHub.
    - Recovery story: if Windows reinstall wipes TPM, key is gone forever.

  Prereqs:
    - Windows 11 22H2+ (older versions have weaker FIDO2 platform integration)
    - TPM 2.0 enabled (verified before key gen)
    - Windows Hello set up (PIN at minimum; fingerprint / Hello Face better)
    - OpenSSH 9.x+ on PATH (Microsoft.OpenSSH)

  After this script:
    - ~/.ssh/id_ed25519_tpm{,.pub} exist (the .pub is the public half;
      .priv file is a credential-handle, opaque without the TPM).
    - git config user.signingkey points to the .pub.
    - allowed_signers entry added.
    - .pub copied to clipboard for GitHub upload.

.PARAMETER KeyName
  ssh-keygen output filename. Default: id_ed25519_tpm

.PARAMETER Comment
  Embedded comment in public key. Default: "claude-home-tpm-<hostname>"
#>
[CmdletBinding()]
param(
    [string]$KeyName = 'id_ed25519_tpm',
    [string]$Comment = "claude-home-tpm-$env:COMPUTERNAME"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ─── Pre-flight ────────────────────────────────────────────────────────────

# 1. TPM 2.0 present
$tpmPnp = Get-PnpDevice -Class 'SecurityDevices' -ErrorAction SilentlyContinue |
          Where-Object { $_.FriendlyName -match 'TPM' -and $_.Status -eq 'OK' }
if (-not $tpmPnp) {
    # Surface devices report via different class
    $tpmPnp = Get-PnpDevice -ErrorAction SilentlyContinue |
              Where-Object { $_.FriendlyName -match 'TPM' -and $_.Status -eq 'OK' }
}
if (-not $tpmPnp) {
    throw 'No active TPM detected. Enable TPM 2.0 in BIOS and rerun.'
}
Write-Output "TPM device: $($tpmPnp.FriendlyName) (Status: $($tpmPnp.Status))"

# 2. Force native Windows OpenSSH (Git's bundled version doesn't see Hello)
$nativeSsh    = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$nativeKeygen = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh-keygen.exe'
if (-not (Test-Path $nativeKeygen)) {
    throw "Native ssh-keygen not found at $nativeKeygen. Install OpenSSH client capability first."
}
$ver = & $nativeSsh -V 2>&1
if ($ver -notmatch 'OpenSSH_for_Windows_(\d+)\.(\d+)') {
    Write-Output "WARN: could not parse native OpenSSH version: $ver"
} else {
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]
    if ($major -lt 9) {
        throw "Native OpenSSH 9.x+ required for Windows Hello FIDO2; found $ver"
    }
    Write-Output "Native OpenSSH: $ver"
}

# 3. SSH dir
$sshDir  = Join-Path $env:USERPROFILE '.ssh'
$keyPath = Join-Path $sshDir $KeyName
$pubPath = "$keyPath.pub"
if (-not (Test-Path $sshDir)) { New-Item -Path $sshDir -ItemType Directory -Force | Out-Null }
if (Test-Path $keyPath) {
    Write-Output "Key already exists at $keyPath. Refusing to overwrite."
    Write-Output "  Move-Item '$keyPath' '$keyPath.bak.$(Get-Date -f yyyyMMddHHmm)'"
    Write-Output "  Move-Item '$pubPath' '$pubPath.bak.$(Get-Date -f yyyyMMddHHmm)'"
    exit 1
}

# ─── Generate ──────────────────────────────────────────────────────────────

Write-Output ''
Write-Output 'Generating ed25519-sk against Windows Hello...'
Write-Output 'Watch for the Windows Security prompt (PIN / fingerprint / face).'
Write-Output ''

# -O resident: stash the credential ON the authenticator (Windows Hello blob
#              in the TPM) so future ssh-keygen -K can recover it after a
#              file loss. Without resident, losing the credential file =
#              losing the key.
# -O application=ssh:claude-home-tpm: namespace so multiple ssh-sk credentials
#              don't collide.
& $nativeKeygen -t ed25519-sk -O 'resident' -O 'application=ssh:claude-home-tpm' `
                -O 'verify-required' -C $Comment -f $keyPath -N ''
if ($LASTEXITCODE -ne 0) {
    throw @"
ssh-keygen failed (exit $LASTEXITCODE). Common causes:
  - Windows Hello not enrolled (Settings -> Sign-in options -> set a PIN).
  - This is Windows 10 / 11 < 22H2 (Hello FIDO2 integration is missing).
  - libfido2.dll missing from C:\Windows\System32\OpenSSH\.
  - WSL or VM passthrough hijacking the platform authenticator.
"@
}
if (-not (Test-Path $pubPath)) { throw "Expected $pubPath after ssh-keygen, not found." }
Write-Output "Key written: $keyPath{,.pub}"

# ─── Wire git ──────────────────────────────────────────────────────────────

Write-Output ''
Write-Output 'Configuring git signing...'
& git config --global gpg.format ssh
& git config --global user.signingkey $pubPath
& git config --global commit.gpgsign true
& git config --global tag.gpgsign true

# Force git to use NATIVE ssh (Hello-capable) for any signing op, not Git's
# bundled OpenSSH which can't see Windows Hello.
& git config --global gpg.ssh.program $nativeSsh.Replace('\', '/')

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

# ─── Test sign ─────────────────────────────────────────────────────────────

Write-Output ''
Write-Output 'Test-signing a synthetic commit (Hello prompt incoming)...'
$repo = Join-Path $env:TEMP "tpm-sign-test-$(Get-Random)"
New-Item -Path $repo -ItemType Directory -Force | Out-Null
Push-Location $repo
try {
    & git init --quiet
    'hello' | Out-File 'a.txt' -Encoding UTF8
    & git add a.txt
    & git commit -S -m 'tpm signing test' --quiet
    if ($LASTEXITCODE -ne 0) { throw 'test commit failed (Hello prompt declined?)' }
    $sig = & git log --show-signature -1 2>&1
    if ($sig -match 'Good "git" signature') {
        Write-Output '  Test commit signed and locally verified.'
    } else {
        Write-Output 'Verification output:'
        Write-Output $sig
    }
}
finally {
    Pop-Location
    Remove-Item $repo -Recurse -Force -ErrorAction SilentlyContinue
}

# ─── GitHub registration ───────────────────────────────────────────────────

Write-Output ''
Write-Output 'Copying public key to clipboard...'
$pubLine | Set-Clipboard
Write-Output 'Open https://github.com/settings/ssh/new'
Write-Output '  Title:    tpm-signing-' + $env:COMPUTERNAME
Write-Output '  Key type: SIGNING KEY (not authentication)'
Write-Output '  Paste:    Ctrl+V  (already on clipboard)'
Write-Output '  Save'
Write-Output ''
Write-Output 'After GitHub registers it, delete the OLD signing-key registration so'
Write-Output 'new commits force the TPM-backed key.'

# ─── Audit log ─────────────────────────────────────────────────────────────

$audit = Join-Path $env:USERPROFILE '.claude\scripts\audit_chain.py'
if (Test-Path $audit) {
    & python $audit log security tpm_signing_enabled `
        -f keypath="$pubPath" -f resident=true -f host=$env:COMPUTERNAME `
        -f tpm="$($tpmPnp.FriendlyName)" 2>&1 | Out-Null
}

Write-Output ''
Write-Output 'Done. Every future commit now needs a Windows Hello unlock.'
Write-Output 'If Hello unlock is annoying for high-frequency commits, configure'
Write-Output '  ssh-add (cache for session) — but caching reduces the security gain.'
