<#
.SYNOPSIS
  Guided capture of claude.ai sessionKey cookie into the vault.

.DESCRIPTION
  Opens Chrome DevTools instructions, prompts once for the cookie value
  (typed or pasted securely — never echoed or logged), stores it in the
  vault as `claude-web/sessionKey`.

  Cannot be fully automated because:
    - sessionKey is httpOnly; JS on the page can't read it
    - Claude Code's security guard correctly blocks automated extraction
      of auth cookies to prevent token exfiltration

  So this script makes the manual step 10 seconds instead of 2 minutes.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Write-Output ''
Write-Output '─── CAPTURE claude.ai sessionKey COOKIE ───'
Write-Output ''
Write-Output '1. In Chrome, open https://claude.ai while logged in'
Write-Output '2. Open DevTools (F12)'
Write-Output '3. Application tab → Storage → Cookies → https://claude.ai'
Write-Output '4. Find the row where Name = "sessionKey"'
Write-Output '5. Copy the Value column (long base64-ish string)'
Write-Output ''

$secure = Read-Host -AsSecureString 'Paste sessionKey (hidden input)'
$val = [System.Net.NetworkCredential]::new('', $secure).Password

if (-not $val -or $val.Length -lt 20) {
    Write-Output 'Empty or suspicious input. Aborting.'
    exit 1
}

# Pipe to vault via stdin — avoids appearing in process args
$vault = 'C:\Dev\tools\vault\vault.py'
if (-not (Test-Path $vault)) { throw "vault.py missing at $vault" }

# vault set takes positional value argument. Use environment variable to pass securely.
$env:__SESSIONKEY_TMP = $val
try {
    $py = @'
import os, subprocess, sys
v = os.environ.pop("__SESSIONKEY_TMP", None)
if not v: sys.exit("env var missing")
r = subprocess.run(["python", r"C:\Dev\tools\vault\vault.py", "set", "claude-web", "sessionKey", v], check=False)
sys.exit(r.returncode)
'@
    $tmp = Join-Path $env:TEMP "setkey-$(Get-Random).py"
    Set-Content -Path $tmp -Value $py -Encoding UTF8
    try {
        & python $tmp
        if ($LASTEXITCODE -ne 0) { throw "vault set failed (exit $LASTEXITCODE)" }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
} finally {
    Remove-Item Env:__SESSIONKEY_TMP -ErrorAction SilentlyContinue
}

Write-Output 'Stored in vault as claude-web/sessionKey.'
Write-Output 'Testing web-export...'
& python "$env:USERPROFILE\.claude\scripts\claude-web-export.py" 2>&1 | Select-Object -Last 3
