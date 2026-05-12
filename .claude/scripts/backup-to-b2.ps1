<#
.SYNOPSIS
  Upload the encrypted third-backup bundle to Backblaze B2 with Object Lock.

.DESCRIPTION
  Complements backup-to-third-provider.ps1. That script creates a local
  .tar.enc in D:\ThirdBackup. This one pushes the newest bundle off-machine
  to a B2 bucket where Object Lock prevents deletion for the retention period.

  Ransomware cannot delete immutable objects. Compromised B2 credentials
  cannot delete them either — that's the point of Object Lock.

  Requires:
    - B2 account: https://www.backblaze.com/b2/sign-up.html
    - Bucket configured with Object Lock + default retention (30 days recommended)
    - Application key with WriteFiles capability on that bucket
    - Credentials in vault:
        b2/key-id
        b2/key-value
        b2/bucket-name

  Uses B2 native API (no rclone or b2-cli dependency needed — all HTTPS).

.PARAMETER Archive
  Specific archive to upload. Defaults to most-recent in D:\ThirdBackup.
#>

[CmdletBinding()]
param(
    [string]$Archive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$vault = 'C:\Dev\tools\vault\vault.py'
$logDir = Join-Path $env:USERPROFILE '.claude\_logs'
$log = Join-Path $logDir ("b2-upload-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')
$notify = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'
$healthcheck = Join-Path $env:USERPROFILE '.claude\scripts\healthcheck-ping.ps1'

New-Item -Path $logDir -ItemType Directory -Force | Out-Null

function Log($m) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $m"
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

function Fail($m) {
    Log "FAIL: $m"
    if (Test-Path $notify) { & pwsh -NoProfile -File $notify -Title 'B2 upload failed' -Message $m 2>&1 | Out-Null }
    if (Test-Path $healthcheck) { & pwsh -NoProfile -File $healthcheck -Endpoint fail -Body $m 2>&1 | Out-Null }
    throw $m
}

# 1. Credentials
$keyId  = & python $vault get b2 key-id     2>$null; if ($LASTEXITCODE -ne 0 -or -not $keyId)  { Fail 'b2/key-id missing from vault. See docs/B2-SETUP.md.' }
$keyVal = & python $vault get b2 key-value  2>$null; if ($LASTEXITCODE -ne 0 -or -not $keyVal) { Fail 'b2/key-value missing from vault' }
$bucket = & python $vault get b2 bucket-name 2>$null; if ($LASTEXITCODE -ne 0 -or -not $bucket) { Fail 'b2/bucket-name missing from vault' }
$keyId = $keyId.Trim(); $keyVal = $keyVal.Trim(); $bucket = $bucket.Trim()

# 2. Pick archive
if (-not $Archive) {
    $default = 'D:\ThirdBackup'
    if (-not (Test-Path $default)) { Fail "No local archive — run backup-to-third-provider.ps1 first" }
    $latest = Get-ChildItem $default -Filter 'claude-resilience-*.tar.enc' |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { Fail "No bundle in $default" }
    $Archive = $latest.FullName
}
if (-not (Test-Path $Archive)) { Fail "Missing: $Archive" }
$archName = Split-Path $Archive -Leaf
$archBytes = [System.IO.File]::ReadAllBytes($Archive)
$archSize = $archBytes.Length
$archSha1 = [BitConverter]::ToString((New-Object System.Security.Cryptography.SHA1Managed).ComputeHash($archBytes)).Replace('-', '').ToLower()

Log "Uploading $archName ($([Math]::Round($archSize/1MB, 2)) MB, sha1=$($archSha1.Substring(0,12))...)"

# 3. Auth
$authHeader = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$keyId" + ':' + "$keyVal"))
$authResp = Invoke-RestMethod -Uri 'https://api.backblazeb2.com/b2api/v3/b2_authorize_account' `
    -Headers @{ Authorization = $authHeader } -Method GET -TimeoutSec 30
$apiUrl = $authResp.apiInfo.storageApi.apiUrl
$accountId = $authResp.accountId
$authToken = $authResp.authorizationToken

# 4. Find bucket id
$bucketResp = Invoke-RestMethod -Uri "$apiUrl/b2api/v3/b2_list_buckets" `
    -Headers @{ Authorization = $authToken } -Method GET `
    -Body @{ accountId = $accountId; bucketName = $bucket } -TimeoutSec 30
$bucketId = $bucketResp.buckets[0].bucketId
if (-not $bucketId) { Fail "Bucket '$bucket' not found" }
Log "Bucket: $bucket ($bucketId)"

# 5. Get upload URL
$uploadUrlResp = Invoke-RestMethod -Uri "$apiUrl/b2api/v3/b2_get_upload_url" `
    -Headers @{ Authorization = $authToken } -Method POST `
    -Body (@{ bucketId = $bucketId } | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 30

# 6. Upload
$uploadResp = Invoke-RestMethod -Uri $uploadUrlResp.uploadUrl -Method POST `
    -Headers @{
        Authorization      = $uploadUrlResp.authorizationToken
        'X-Bz-File-Name'   = $archName
        'Content-Type'     = 'application/octet-stream'
        'X-Bz-Content-Sha1' = $archSha1
    } `
    -Body $archBytes -TimeoutSec 600

Log "Uploaded: $($uploadResp.fileName) @ $($uploadResp.uploadTimestamp)"

if (Test-Path $healthcheck) { & pwsh -NoProfile -File $healthcheck -Body "b2 upload $archName ok" 2>&1 | Out-Null }
Log 'Done.'
