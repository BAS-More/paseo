<#
.SYNOPSIS
  Guided bootstrap for the 3 Tier-A external services (healthchecks, B2, canary).

.DESCRIPTION
  Walks through each remaining signup step, stores secrets via hidden input,
  registers scheduled tasks where applicable. Safe to re-run — every step
  is idempotent: already-configured services are skipped.

  Cannot automate account signups themselves (email + captcha). Drives
  browser to the right page, waits for you to finish, then takes the
  outputs (PAT / URL / file) via hidden prompts.

.PARAMETER Skip
  Comma-separated subset to skip: healthchecks,b2,canary,bitlocker

.EXAMPLE
  pwsh -File tier-a-bootstrap.ps1                    # guide all
  pwsh -File tier-a-bootstrap.ps1 -Skip b2           # skip B2
#>

[CmdletBinding()]
param(
    [string]$Skip = ''
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

$skipSet = @($Skip -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
$vault = 'C:\Dev\tools\vault\vault.py'

function Read-Secret($prompt) {
    $sec = Read-Host -AsSecureString $prompt
    return [System.Net.NetworkCredential]::new('', $sec).Password
}

function Store-Secret($svc, $key, $value) {
    if (-not $value -or $value.Length -lt 4) { throw "empty/short value for $svc/$key" }
    $env:__TB_VAL = $value
    try {
        $py = @'
import os, subprocess, sys
v = os.environ.pop("__TB_VAL", None)
if not v: sys.exit("no value")
r = subprocess.run(["python", r"C:\Dev\tools\vault\vault.py", "set", sys.argv[1], sys.argv[2], v], check=False)
sys.exit(r.returncode)
'@
        $tmp = Join-Path $env:TEMP "tbvs-$(Get-Random).py"
        Set-Content -Path $tmp -Value $py -Encoding UTF8
        & python $tmp $svc $key
        if ($LASTEXITCODE -ne 0) { throw "vault set $svc/$key failed" }
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
    finally { Remove-Item Env:__TB_VAL -ErrorAction SilentlyContinue }
}

function Has-Vault($svc, $key) {
    $v = & python $vault get $svc $key 2>$null
    return ($LASTEXITCODE -eq 0 -and $v -and $v.Trim())
}

function Open-Url($url) {
    Start-Process $url
}

Write-Output ''
Write-Output '═══ TIER-A BOOTSTRAP ═══'
Write-Output ''
Write-Output 'This guides you through 3 external-service setups + 1 admin task.'
Write-Output 'Each is a one-time thing. Already-configured services are skipped.'
Write-Output ''

# ═══ 1. healthchecks.io ═══
if ('healthchecks' -in $skipSet) {
    Write-Output '[SKIP] healthchecks (--Skip)'
} elseif (Has-Vault 'healthchecks' 'claude-home-url') {
    Write-Output '[SKIP] healthchecks already configured'
} else {
    Write-Output '─── 1/4 healthchecks.io (external dead-man heartbeat) ───'
    Write-Output '  Opens browser. In healthchecks.io:'
    Write-Output '    1. Sign up (email + password)'
    Write-Output '    2. Create check: name "claude-home", period 30m, grace 30m'
    Write-Output '    3. Copy the "ping URL" (https://hc-ping.com/...)'
    Write-Output ''
    $go = Read-Host 'Press Enter to open browser, or "s" to skip'
    if ($go -ne 's') {
        Open-Url 'https://healthchecks.io/signup'
        Write-Output ''
        $url = Read-Host 'Paste the ping URL'
        if ($url -and $url -like 'http*') {
            Store-Secret 'healthchecks' 'claude-home-url' $url
            Write-Output '  Stored in vault'
            & pwsh -NoProfile -File "$env:USERPROFILE\.claude\scripts\register-healthcheck-task.ps1" 2>&1 | Select-Object -Last 2
        } else {
            Write-Output '  Invalid URL, skipped'
        }
    }
}

# ═══ 2. Backblaze B2 ═══
if ('b2' -in $skipSet) {
    Write-Output '[SKIP] b2 (--Skip)'
} elseif ((Has-Vault 'b2' 'key-id') -and (Has-Vault 'b2' 'key-value') -and (Has-Vault 'b2' 'bucket-name')) {
    Write-Output '[SKIP] b2 already configured'
} else {
    Write-Output ''
    Write-Output '─── 2/4 Backblaze B2 (immutable off-machine backup) ───'
    Write-Output '  See docs/B2-SETUP.md for bucket + Object Lock config.'
    Write-Output '  After signup + bucket + app key creation, come back.'
    Write-Output ''
    $go = Read-Host 'Press Enter to open browser, or "s" to skip'
    if ($go -ne 's') {
        Open-Url 'https://www.backblaze.com/b2/sign-up.html'
        Start-Sleep -Seconds 1
        Open-Url "$env:USERPROFILE\.claude\docs\B2-SETUP.md"
        Write-Output ''
        $bucket = Read-Host 'Bucket name'
        $keyId  = Read-Secret 'keyID (hidden)'
        $keyVal = Read-Secret 'applicationKey (hidden)'
        if ($bucket -and $keyId -and $keyVal) {
            Store-Secret 'b2' 'bucket-name' $bucket
            Store-Secret 'b2' 'key-id' $keyId
            Store-Secret 'b2' 'key-value' $keyVal
            Write-Output '  Stored. Testing upload...'
            & pwsh -NoProfile -File "$env:USERPROFILE\.claude\scripts\backup-to-b2.ps1" 2>&1 | Select-Object -Last 3
        } else {
            Write-Output '  Empty input, skipped'
        }
    }
}

# ═══ 3. Canarytokens ═══
if ('canary' -in $skipSet) {
    Write-Output '[SKIP] canary (--Skip)'
} elseif (Has-Vault 'canarytoken' 'claude-home') {
    Write-Output '[SKIP] canary already configured'
} else {
    Write-Output ''
    Write-Output '─── 3/4 Canarytokens (intrusion tripwire) ───'
    Write-Output '  1. Pick token type: "MS Word Document" or "Fast Redirect" work well'
    Write-Output '  2. Enter your email for alerts'
    Write-Output '  3. Memo: "claude-home-backup"'
    Write-Output '  4. Download the generated file; I will save it under .canary/'
    Write-Output '  5. Copy the "manage this token" URL from the "Manage" button'
    Write-Output ''
    $go = Read-Host 'Press Enter to open browser, or "s" to skip'
    if ($go -ne 's') {
        Open-Url 'https://canarytokens.org'
        Write-Output ''
        $mgmtUrl = Read-Host 'Paste the Manage URL (not the token URL)'
        if ($mgmtUrl -and $mgmtUrl -like 'http*') {
            Store-Secret 'canarytoken' 'claude-home' $mgmtUrl
            $canaryDir = Join-Path $env:USERPROFILE '.claude\docs\.canary'
            New-Item -Path $canaryDir -ItemType Directory -Force | Out-Null
            Write-Output "  Token URL stored. Save downloaded canary file to: $canaryDir"
            Write-Output '  Rename it something juicy: "vault-dump.json" or "anthropic-api-keys.txt"'
            & pwsh -NoProfile -File "$env:USERPROFILE\.claude\scripts\canary-token-setup.ps1" 2>&1 | Select-Object -Last 3
        }
    }
}

# ═══ 4. BitLocker admin weekly task ═══
if ('bitlocker' -in $skipSet) {
    Write-Output '[SKIP] bitlocker (--Skip)'
} else {
    $exists = Get-ScheduledTask -TaskName 'ClaudeCode-BitLockerAdminCheck' -ErrorAction SilentlyContinue
    if ($exists) {
        Write-Output ''
        Write-Output '[SKIP] ClaudeCode-BitLockerAdminCheck already registered'
    } else {
        Write-Output ''
        Write-Output '─── 4/4 BitLocker admin weekly check ───'
        Write-Output '  Requires UAC elevation. Registers a weekly task that'
        Write-Output '  writes a cache file the non-admin SessionStart tripwire reads.'
        Write-Output ''
        $go = Read-Host 'Press Enter to UAC-elevate and register, or "s" to skip'
        if ($go -ne 's') {
            $script = "$env:USERPROFILE\.claude\scripts\register-bitlocker-admin-task.ps1"
            Start-Process pwsh -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$script -Wait
            Write-Output '  Run `Start-ScheduledTask -TaskName ClaudeCode-BitLockerAdminCheck` to populate cache now.'
        }
    }
}

Write-Output ''
Write-Output '═══ DONE ═══'
Write-Output ''
Write-Output 'Verify:'
Write-Output '  watchdog check claude-resilience       # local plugin'
Write-Output '  curl http://localhost:3400/api/v1/plugins/claude-resilience/run -X POST   # API'
Write-Output ''
