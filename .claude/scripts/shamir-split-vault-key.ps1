<#
.SYNOPSIS
  Split a vault credential into K-of-N Shamir shares for escrow.

.DESCRIPTION
  Pulls <service>/<key> from the vault, runs scripts/shamir.py, writes
  each share to a SEPARATE file under $OutDir. Then prints a distribution
  matrix telling you where each share should physically live.

  IMPORTANT
    - Anyone with K shares CAN reconstruct the secret. Pick K >= 3 and
      distribute shares across geographically/administratively independent
      locations. Don't store all of them on this machine.
    - This script writes plaintext share files to disk. Move them off this
      box ASAP, then `Remove-Item $OutDir -Recurse -Force`.
    - Stdout never echoes the share values; only file paths.

.PARAMETER Service
  Vault service name. Default: third-backup

.PARAMETER Key
  Vault key. Default: passphrase

.PARAMETER Threshold
  K — shares required to reconstruct. Default: 3

.PARAMETER Total
  N — total shares to produce. Default: 5

.PARAMETER OutDir
  Where to write share files. Default: %USERPROFILE%\shamir-out-<svc>-<key>-<timestamp>

.EXAMPLE
  pwsh -File shamir-split-vault-key.ps1
#>
[CmdletBinding()]
param(
    [string]$Service   = 'third-backup',
    [string]$Key       = 'passphrase',
    [ValidateRange(2, 254)] [int]$Threshold = 3,
    [ValidateRange(2, 255)] [int]$Total     = 5,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Threshold -gt $Total) { throw "Threshold ($Threshold) must be <= Total ($Total)" }

$vault = 'C:\Dev\tools\vault\vault.py'
$shamir = Join-Path $env:USERPROFILE '.claude\scripts\shamir.py'
foreach ($p in @($vault, $shamir)) {
    if (-not (Test-Path $p)) { throw "Missing: $p" }
}

if (-not $OutDir) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutDir = Join-Path $env:USERPROFILE "shamir-out-${Service}-${Key}-$stamp"
}
New-Item -Path $OutDir -ItemType Directory -Force | Out-Null

# Pull the secret. Catch the value into a variable; never echo.
$secret = & python $vault get $Service $Key 2>$null
if ($LASTEXITCODE -ne 0 -or -not $secret) {
    throw "vault get $Service/$Key returned nothing"
}
$secret = $secret.TrimEnd("`r", "`n")
if ($secret.Length -lt 8) {
    throw "secret looks suspiciously short ($($secret.Length) chars) — refusing"
}

# Pipe via stdin so the secret never appears in the process command line.
# python reads --secret-stdin; strip a single trailing newline only.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName  = 'python'
$psi.Arguments = "`"$shamir`" split -k $Threshold -n $Total --secret-stdin"
$psi.RedirectStandardInput  = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError  = $true
$psi.UseShellExecute = $false
$proc = [System.Diagnostics.Process]::Start($psi)
$proc.StandardInput.Write($secret)
$proc.StandardInput.Close()
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
if ($proc.ExitCode -ne 0) {
    throw "shamir split failed (exit $($proc.ExitCode)): $stderr"
}

# Parse share lines and write each to its own file.
$lines = $stdout -split "`n" | ForEach-Object { $_.TrimEnd("`r") }
$shares = @($lines | Where-Object { $_ -match '^\d+:' })
if ($shares.Count -ne $Total) {
    throw "expected $Total shares, got $($shares.Count). raw stdout: $stdout"
}

$written = @()
for ($i = 0; $i -lt $shares.Count; $i++) {
    $idx = ($shares[$i] -split ':', 2)[0]
    $name = "share-$idx-of-$Total.txt"
    $path = Join-Path $OutDir $name
    # Header for human readability
    $body = @(
        "# Shamir share $idx of $Total — threshold $Threshold",
        "# Service: $Service/$Key",
        "# Created: $(Get-Date -Format o) on $env:COMPUTERNAME",
        "# WARNING: Holding $Threshold or more of these shares allows full reconstruction.",
        '',
        $shares[$i]
    ) -join "`n"
    Set-Content -Path $path -Value $body -Encoding UTF8 -NoNewline
    $written += $path
}

# Distribution suggestion
$matrix = @(
    "share-1: this PC's vault as $Service-shamir-share/1 (then delete the file)"
    "share-2: OneDrive\ClaudeVault\shamir\$Service-$Key\share-2.txt"
    "share-3: print + put in safe / safety-deposit box"
    "share-4: trusted person 1 (encrypted email or signal)"
    "share-5: trusted person 2 (different relationship to person 1)"
)

Write-Output ''
Write-Output "Wrote $Total share files to: $OutDir"
foreach ($p in $written) { Write-Output "  $p" }
Write-Output ''
Write-Output "Suggested distribution ($Threshold-of-$Total recovery):"
foreach ($m in $matrix[0..([Math]::Min($matrix.Count, $Total) - 1)]) {
    Write-Output "  $m"
}
Write-Output ''
Write-Output 'Next steps:'
Write-Output "  1. Move every file out of $OutDir to its destination."
Write-Output "  2. Verify reconstruction with any $Threshold shares:"
Write-Output "       cat share-1-of-$Total.txt share-2-of-$Total.txt share-3-of-$Total.txt | "
Write-Output "         python `"$shamir`" combine --share-stdin"
Write-Output "     (output goes to stdout — should match the original passphrase)"
Write-Output "  3. Securely delete $OutDir : Remove-Item `"$OutDir`" -Recurse -Force"
