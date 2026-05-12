<#
.SYNOPSIS
  Pin GitHub + Codeberg SSH host keys in ~/.ssh/known_hosts.

.DESCRIPTION
  Writes vendor-published raw host keys directly. These values are from:
    GitHub:    https://api.github.com/meta (ssh_keys array, last verified 2026-04-22)
    Codeberg:  https://docs.codeberg.org/security/ssh-fingerprint/

  Rationale for not using ssh-keyscan: Windows built-in OpenSSH cannot
  negotiate modern KEX methods used by these hosts (sntrup761x25519-sha512).
  Hardcoding vendor-published values is safer anyway — keyscan trusts the
  wire; vendor docs are the source of truth.

  Also sets StrictHostKeyChecking=yes in ~/.ssh/config for these hosts so
  MITM attempts fail loudly instead of silently accepting a new key.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sshDir = Join-Path $env:USERPROFILE '.ssh'
$knownHosts = Join-Path $sshDir 'known_hosts'
$config = Join-Path $sshDir 'config'

New-Item -Path $sshDir -ItemType Directory -Force | Out-Null
if (-not (Test-Path $knownHosts)) { New-Item -Path $knownHosts -ItemType File -Force | Out-Null }
if (-not (Test-Path $config))     { New-Item -Path $config -ItemType File -Force | Out-Null }

# Vendor-published host keys (verified against https).
# Update when a vendor rotates (announced in advance; check their docs).
$pinned = @(
    'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
    'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=',
    'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=',
    # Source: https://codeberg.org/codeberg/org/raw/branch/main/Imprint.md
    # Fingerprints (SHA256) per https://docs.codeberg.org/security/ssh-fingerprint/:
    #   ED25519: mIlxA9k46MmM6qdJOdMnAQpzGxF4WIVVL+fj+wZbw0g
    #   RSA:     6QQmYi4ppFS4/+zSZ5S4IU+4sa6rwvQ4PbhCtPEBekQ
    #   ECDSA:   T9FYDEHELhVkulEKKwge5aVhVTbqCW0MIRwAfpARs/E
    'codeberg.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIVIC02vnjFyL+I4RHfvIGNtOgJMe769VTF1VR4EB3ZB',
    'codeberg.org ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC8hZi7K1/2E2uBX8gwPRJAHvRAob+3Sn+y2hxiEhN0buv1igjYFTgFO2qQD8vLfU/HT/P/rqvEeTvaDfY1y/vcvQ8+YuUYyTwE2UaVU5aJv89y6PEZBYycaJCPdGIfZlLMmjilh/Sk8IWSEK6dQr+g686lu5cSWrFW60ixWpHpEVB26eRWin3lKYWSQGMwwKv4LwmW3ouqqs4Z4vsqRFqXJ/eCi3yhpT+nOjljXvZKiYTpYajqUC48IHAxTWugrKe1vXWOPxVXXMQEPsaIRc2hpK+v1LmfB7GnEGvF1UAKnEZbUuiD9PBEeD5a1MZQIzcoPWCrTxipEpuXQ5Tni4mN',
    'codeberg.org ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBL2pDxWr18SoiDJCGZ5LmxPygTlPu+cCKSkpqkvCyQzl5xmIMeKNdfdBpfbCGDPoZQghePzFZkKJNR/v9Win3Sc='
)

# Preserve user's existing known_hosts except the lines we manage
$existing = Get-Content $knownHosts -ErrorAction SilentlyContinue
$kept = @()
foreach ($line in $existing) {
    if ($line -and $line -notmatch '^(github\.com|codeberg\.org)[, ]') {
        $kept += $line
    }
}
$kept += $pinned

# Write with explicit LF line endings (OpenSSH struggles with CRLF in known_hosts)
[System.IO.File]::WriteAllText($knownHosts, (($kept -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output "Wrote $($pinned.Count) pinned entries to $knownHosts"

# ssh/config: StrictHostKeyChecking=yes for these hosts
$configText = Get-Content $config -Raw -ErrorAction SilentlyContinue
if (-not $configText) { $configText = '' }

$marker = '# pin-ssh-host-keys.ps1'
# ssh config does NOT quote paths — use forward slashes and ~ or put in quotes.
$knownHostsForSsh = $knownHosts.Replace('\', '/')

$pinBlock = @"

$marker
Host github.com codeberg.org
    StrictHostKeyChecking yes
    UserKnownHostsFile "$knownHostsForSsh"
# pin-block-end
"@

if ($configText -notmatch [regex]::Escape($marker)) {
    Add-Content -Path $config -Value $pinBlock -Encoding ASCII
    Write-Output "Added StrictHostKeyChecking block to $config"
} else {
    Write-Output "ssh/config already has pin block"
}

Write-Output ''
Write-Output 'Verify: ssh -T git@codeberg.org && ssh -T git@github.com'
Write-Output 'A MITM now fails: "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED"'
