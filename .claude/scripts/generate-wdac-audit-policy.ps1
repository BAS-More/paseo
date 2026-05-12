<#
.SYNOPSIS
  Generate an AUDIT-mode WDAC (Windows Defender Application Control)
  policy that catalogues what runs today, before any enforcement.

.DESCRIPTION
  WDAC is a kernel-enforced application allowlist. Misconfiguring an
  enforce-mode policy can leave you unable to launch your own scripts,
  PowerShell, or even the desktop. This script ONLY produces audit-mode
  policies — they log denials to the CodeIntegrity event log
  (Event IDs 3076/3077) but allow everything to run.

  Workflow:
    1. Run this script as admin -> generates a baseline .xml policy by
       scanning the directories Avi actually uses for tooling.
    2. Convert .xml -> .cip with ConvertFrom-CIPolicy.
    3. Deploy the .cip with CiTool.exe --update-policy (admin).
    4. Use the laptop normally for 1–2 weeks.
    5. Mine event log 3076 entries for legitimate apps that would have
       been blocked. Append Allow rules with Merge-CIPolicy.
    6. Only when audit log is quiet for a full week, flip rule option 3
       OFF (Set-RuleOption -Delete 3) and redeploy as ENFORCE.

  Reverting an enforce-mode policy that broke your boot:
    - Boot into recovery, delete C:\Windows\System32\CodeIntegrity\CiPolicies\Active\<guid>.cip
    - Reboot.

.PARAMETER OutDir
  Where to write the policy XML + CIP. Default: %USERPROFILE%\wdac-policies\

.PARAMETER ScanPath
  Directories to scan. Each contributes Allow rules for its binaries +
  scripts. Default covers Windows, the user's tooling dirs, and ~/.claude.

.PARAMETER PolicyName
  Friendly name baked into the policy. Default: "claude-home-audit".
#>
[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path $env:USERPROFILE 'wdac-policies'),
    [string[]]$ScanPath = @(
        "$env:SystemRoot",
        "$env:ProgramFiles",
        "${env:ProgramFiles(x86)}",
        "$env:LOCALAPPDATA\Programs",
        "$env:USERPROFILE\.claude\scripts",
        "$env:USERPROFILE\.cargo\bin",
        "$env:USERPROFILE\AppData\Roaming\npm",
        'C:\Dev\tools'
    ),
    [string]$PolicyName = 'claude-home-audit'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 1. Admin check
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Must run as Administrator. WDAC scanning needs full filesystem access + driver enumeration.'
}

if (-not (Get-Command New-CIPolicy -ErrorAction SilentlyContinue)) {
    throw 'New-CIPolicy not available. Need Windows 10/11 with the WDAC PowerShell module.'
}

New-Item -Path $OutDir -ItemType Directory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$xml   = Join-Path $OutDir "${PolicyName}-${stamp}.xml"
$cip   = Join-Path $OutDir "${PolicyName}-${stamp}.cip"

# 2. Scan and emit baseline policy
Write-Output 'Scanning directories (this can take 10–20 minutes)...'
foreach ($p in $ScanPath) { Write-Output "  $p" }

# -Level Publisher: trust by signer; tighter than -Level Hash but doesn't
# explode the rule count the way -Level FilePublisher can.
# -Fallback Hash: unsigned binaries get hash rules.
# -UserPEs: include user-mode PEs (we want pwsh, python, etc.)
# -ScanPath: each call appends to the same XML if it exists.
$first = $true
foreach ($path in $ScanPath) {
    if (-not (Test-Path $path)) {
        Write-Output "  skip (missing): $path"
        continue
    }
    if ($first) {
        New-CIPolicy -FilePath $xml -ScanPath $path -Level Publisher -Fallback Hash -UserPEs -NoScript -ErrorAction Continue
        $first = $false
    } else {
        $tmp = Join-Path $env:TEMP "wdac-frag-$(Get-Random).xml"
        try {
            New-CIPolicy -FilePath $tmp -ScanPath $path -Level Publisher -Fallback Hash -UserPEs -NoScript -ErrorAction Continue
            Merge-CIPolicy -OutputFilePath $xml -PolicyPaths $xml, $tmp | Out-Null
        }
        finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    }
}

# 3. Force AUDIT mode + sensible defaults
Write-Output 'Setting rule options...'
# 0  = Enabled:UMCI                     (user-mode code integrity)
# 3  = Enabled:Audit Mode               (logs but does not block — CRITICAL)
# 9  = Enabled:Advanced Boot Options Menu
# 10 = Enabled:Boot Audit on Failure
# 11 = Disabled:Script Enforcement      (set, then we flip to enabled later)
# 12 = Required:Enforce Store Applications
# 16 = Enabled:Update Policy No Reboot
# 18 = Disabled:Runtime FilePath Rule Protection
Set-RuleOption -FilePath $xml -Option 0
Set-RuleOption -FilePath $xml -Option 3   # AUDIT MODE — non-negotiable for first deploy
Set-RuleOption -FilePath $xml -Option 9
Set-RuleOption -FilePath $xml -Option 10
Set-RuleOption -FilePath $xml -Option 16

# Bump version + name
$id = [guid]::NewGuid().Guid
Set-CIPolicyIdInfo -FilePath $xml -PolicyName $PolicyName -PolicyId $id
Set-CIPolicyVersion -FilePath $xml -Version "1.0.0.$([int]((Get-Date) - (Get-Date '1970-01-01')).TotalDays)"

# 4. Convert to binary
Write-Output 'Converting to binary policy (.cip)...'
ConvertFrom-CIPolicy -XmlFilePath $xml -BinaryFilePath $cip | Out-Null

# 5. Audit-log
$audit = Join-Path $env:USERPROFILE '.claude\scripts\audit_chain.py'
if (Test-Path $audit) {
    & python $audit log security wdac_audit_policy_generated -f xml="$xml" -f cip="$cip" -f mode=audit 2>&1 | Out-Null
}

# 6. Print next steps — DO NOT auto-deploy
Write-Output ''
Write-Output '─── Audit-mode policy ready (NOT yet deployed) ───'
Write-Output "  XML: $xml"
Write-Output "  CIP: $cip"
Write-Output ''
Write-Output 'Deploy (admin):'
Write-Output "  CiTool.exe --update-policy `"$cip`""
Write-Output ''
Write-Output 'Verify deployed:'
Write-Output '  CiTool.exe --list-policies | findstr claude-home-audit'
Write-Output ''
Write-Output 'After 1–2 weeks of normal use, harvest audit hits:'
Write-Output "  Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' |"
Write-Output '    Where-Object { $_.Id -in 3076,3077 } | Group-Object -Property {$_.Properties[0].Value}'
Write-Output ''
Write-Output 'When audit log is quiet for a full week, flip to ENFORCE:'
Write-Output "  Set-RuleOption -FilePath `"$xml`" -Option 3 -Delete    # remove audit-mode flag"
Write-Output "  ConvertFrom-CIPolicy -XmlFilePath `"$xml`" -BinaryFilePath `"$cip`""
Write-Output "  CiTool.exe --update-policy `"$cip`""
Write-Output ''
Write-Output 'Recovery (boot broken by enforce-mode policy):'
Write-Output '  Boot into Windows Recovery Environment ->'
Write-Output '  C:\Windows\System32\CodeIntegrity\CiPolicies\Active\<id>.cip -> delete -> reboot'
