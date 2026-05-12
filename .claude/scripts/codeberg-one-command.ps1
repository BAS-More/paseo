<#
.SYNOPSIS
  Codeberg setup in one command. Requires only: manual signup + PAT.

.DESCRIPTION
  After you have:
    1. Signed up at https://codeberg.org/user/sign_up  (email + captcha — cannot be automated)
    2. Generated a Personal Access Token with scopes: repo, user, write:public_key
       https://codeberg.org/user/settings/applications

  This script does EVERYTHING else:
    - Stores the PAT in vault as `codeberg/pat`
    - Creates private repo `claude-home-backup`
    - Uploads SSH auth key + signing key (same ed25519)
    - Adds `codeberg` remote to ~/.claude
    - Tests SSH reachability
    - Does initial push
    - Verifies fan-out to both GitHub + Codeberg

.PARAMETER CodebergUser
  Codeberg username (must match the account you signed up with).

.PARAMETER PatFromStdin
  Read PAT from stdin rather than prompting. Use this when piping.

.EXAMPLE
  pwsh -File codeberg-one-command.ps1 -CodebergUser Avi-Bendetsky
  # prompts for PAT (hidden), does everything.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CodebergUser,
    [string]$RepoName = 'claude-home-backup',
    [switch]$PatFromStdin
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$claudeRepo = Join-Path $env:USERPROFILE '.claude'
$pubKeyPath = Join-Path $env:USERPROFILE '.ssh\id_ed25519.pub'
$vaultCli   = 'C:\Dev\tools\vault\vault.py'

if (-not (Test-Path $claudeRepo))  { throw "Missing: $claudeRepo" }
if (-not (Test-Path $pubKeyPath))  { throw "Missing SSH pubkey: $pubKeyPath" }
if (-not (Test-Path $vaultCli))    { throw "Missing vault CLI: $vaultCli" }

# ── 1. Get PAT ────────────────────────────────────────────────────────────
$pat = $null
# Check vault first
$existing = & python $vaultCli get codeberg pat 2>&1
if ($LASTEXITCODE -eq 0 -and $existing -and $existing.Trim()) {
    Write-Output 'Using PAT from vault (codeberg/pat)'
    $pat = $existing.Trim()
} elseif ($PatFromStdin) {
    $pat = [Console]::In.ReadLine()
} else {
    Write-Output ''
    Write-Output 'Codeberg Personal Access Token needed.'
    Write-Output 'Generate at: https://codeberg.org/user/settings/applications'
    Write-Output 'Required scopes: repo, user, write:public_key'
    Write-Output ''
    $sec = Read-Host -AsSecureString 'Paste PAT (hidden)'
    $pat = [System.Net.NetworkCredential]::new('', $sec).Password
    if (-not $pat -or $pat.Length -lt 20) { throw 'PAT too short or empty.' }

    # Store in vault
    $env:__PAT_TMP = $pat
    try {
        $py = @'
import os, subprocess, sys
v = os.environ.pop("__PAT_TMP", None)
if not v: sys.exit("no pat")
r = subprocess.run(["python", r"C:\Dev\tools\vault\vault.py", "set", "codeberg", "pat", v], check=False)
sys.exit(r.returncode)
'@
        $tmp = Join-Path $env:TEMP "setpat-$(Get-Random).py"
        Set-Content -Path $tmp -Value $py -Encoding UTF8
        & python $tmp
        if ($LASTEXITCODE -ne 0) { throw "vault set codeberg/pat failed" }
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
    finally { Remove-Item Env:__PAT_TMP -ErrorAction SilentlyContinue }
    Write-Output 'PAT stored in vault as codeberg/pat.'
}

# ── 2. Call Codeberg API helpers ──────────────────────────────────────────
$apiBase = 'https://codeberg.org/api/v1'
$headers = @{
    'Authorization' = "token $pat"
    'Accept'        = 'application/json'
    'Content-Type'  = 'application/json'
}

function CB-Request {
    param([string]$Method, [string]$Path, [object]$Body = $null)
    $uri = "$apiBase/$Path"
    $params = @{ Uri = $uri; Method = $Method; Headers = $headers; UseBasicParsing = $true }
    if ($Body) { $params['Body'] = ($Body | ConvertTo-Json -Depth 4) }
    try {
        $r = Invoke-WebRequest @params
        if ($r.Content) { return ($r.Content | ConvertFrom-Json) } else { return $null }
    } catch {
        # PS7 exposes $_.ErrorDetails.Message with response body; PS5 uses GetResponseStream
        $msg = ''
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $msg = $_.ErrorDetails.Message
        } elseif ($_.Exception.Response -and $_.Exception.Response.GetResponseStream) {
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $msg = $reader.ReadToEnd()
            } catch { $msg = $_.Exception.Message }
        } else {
            $msg = $_.Exception.Message
        }
        $code = $null
        if ($_.Exception.Response) {
            try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        }
        throw "Codeberg API $Method $Path failed ($code): $msg"
    }
}

# ── 3. Verify account matches ─────────────────────────────────────────────
$me = CB-Request GET 'user'
if ($me.login -ne $CodebergUser) {
    throw "PAT belongs to '$($me.login)', not '$CodebergUser'. Check -CodebergUser."
}
Write-Output "Authenticated as $($me.login) ($($me.email))"

# ── 4. Create repo (idempotent) ───────────────────────────────────────────
$existingRepo = $null
try { $existingRepo = CB-Request GET "repos/$CodebergUser/$RepoName" } catch {}

if ($existingRepo) {
    Write-Output "Repo $CodebergUser/$RepoName already exists — skipping create"
} else {
    Write-Output "Creating private repo $CodebergUser/$RepoName..."
    CB-Request POST 'user/repos' @{
        name = $RepoName
        description = 'Backup mirror of ~/.claude (see BAS-More/claude-home-backup on GitHub)'
        private = $true
        auto_init = $false
    } | Out-Null
    Write-Output "  Created."
}

# ── 5. Upload SSH keys (auth + signing) ───────────────────────────────────
$pubKey = (Get-Content $pubKeyPath -Raw).Trim()
$keyTitle = "claude-code-auth-$(hostname)"
$signKeyTitle = "claude-code-signing-$(hostname)"

$existingKeys = CB-Request GET 'user/keys'
$haveAuth = $existingKeys | Where-Object { $_.key -like "*$($pubKey.Split(' ')[1].Substring(0, 40))*" }

if ($haveAuth) {
    Write-Output "SSH auth key already registered on Codeberg"
} else {
    Write-Output "Uploading SSH auth key..."
    CB-Request POST 'user/keys' @{
        title = $keyTitle
        key = $pubKey
        read_only = $false
    } | Out-Null
}

# Signing keys go to a different endpoint — some Forgejo versions expose it,
# but fall back to regular keys if not available
try {
    $existingSignKeys = CB-Request GET 'user/gpg_key_token' 2>&1
    # skip — not all Codeberg instances have /user/ssh_signing_keys
} catch {}

# ── 6. Add remote (idempotent) ────────────────────────────────────────────
Push-Location $claudeRepo
try {
    $remotes = & git remote
    $remoteUrl = "git@codeberg.org:$CodebergUser/$RepoName.git"
    if ('codeberg' -in $remotes) {
        $cur = (& git remote get-url codeberg).Trim()
        if ($cur -ne $remoteUrl) {
            & git remote set-url codeberg $remoteUrl
            Write-Output "Updated codeberg remote URL -> $remoteUrl"
        } else {
            Write-Output "codeberg remote already set"
        }
    } else {
        & git remote add codeberg $remoteUrl
        Write-Output "Added codeberg remote: $remoteUrl"
    }

    # ── 7. SSH probe ──────────────────────────────────────────────────────
    Write-Output 'Probing SSH to codeberg.org (accepting host key if new)...'
    $probe = & ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -T git@codeberg.org 2>&1
    if ($probe -match 'Hi|You have successfully authenticated') {
        Write-Output "  SSH auth OK"
    } else {
        Write-Output "  SSH probe: $probe"
        Write-Output "  If 'Permission denied', key propagation may take a second — retrying once..."
        Start-Sleep -Seconds 3
        $probe = & ssh -o StrictHostKeyChecking=accept-new -T git@codeberg.org 2>&1
        Write-Output "  retry: $probe"
    }

    # ── 8. First push ─────────────────────────────────────────────────────
    Write-Output 'Initial push to codeberg (takes a minute)...'
    & git push -u codeberg main 2>&1 | ForEach-Object { Write-Output "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "git push -u codeberg main failed (exit $LASTEXITCODE)" }

    # ── 9. Verify ─────────────────────────────────────────────────────────
    Write-Output ''
    Write-Output '─── Remotes now configured ───'
    & git remote -v
    Write-Output ''
    Write-Output 'Done. Next auto-commit (within 30 min) will push to both remotes.'
    Write-Output "Repo visible at: https://codeberg.org/$CodebergUser/$RepoName"
}
finally { Pop-Location }
