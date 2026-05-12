<#
.SYNOPSIS
  Upload encrypted backup bundle to Cloudflare R2 (S3-compatible).

.DESCRIPTION
  Wrapper around backup-to-r2.py. Pivot from B2 to R2 — same goal:
  offsite immutable copy of the encrypted .tar.enc bundle produced by
  backup-to-third-provider.ps1.

  Reads creds from vault:
    r2/access-key-id
    r2/secret-access-key
    r2/endpoint
    r2/bucket

  Object Lock note: bucket was created without Object Lock at creation
  time. To make backups truly immutable, enable versioning + Object Lock
  separately (Cloudflare dashboard -> R2 -> bucket -> Settings).

.PARAMETER Archive
  Specific archive path. Defaults to newest in D:\ThirdBackup.
#>

[CmdletBinding()]
param(
    [string]$Archive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$py = Join-Path $env:USERPROFILE '.claude\scripts\backup-to-r2.py'
if (-not (Test-Path $py)) { throw "Missing: $py" }

$pyArgs = @('-File', $py)  # placeholder; pwsh doesn't pass -File to python
$pyArgs = @($py)
if ($Archive) { $pyArgs += @('--archive', $Archive) }

& python @pyArgs
exit $LASTEXITCODE
