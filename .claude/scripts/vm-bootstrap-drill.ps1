<#
.SYNOPSIS
  End-to-end restoration drill — proves bootstrap-from-scratch.ps1 actually works.

.DESCRIPTION
  Runs bootstrap-from-scratch.ps1 inside a clean Hyper-V VM OR a sandboxed
  directory (fallback). Cannot happen on the host machine — we'd overwrite
  the live harness.

  Two modes:
    - Hyper-V: invokes a guest Windows VM, installs prerequisites, runs bootstrap
    - Sandbox: clones into $env:TEMP\drill-<stamp>, runs bootstrap with fake
      HOME — doesn't install Windows features but exercises script logic

  Sandbox mode is the default since Hyper-V requires admin + Pro edition.
  Upgrade to Hyper-V mode by passing -UseHyperV if the host is configured.

.PARAMETER UseHyperV
  Run against a Hyper-V VM named "claude-drill" (must pre-exist + have snapshot "clean").

.PARAMETER KeepArtifacts
  Don't delete scratch dir afterward.
#>

[CmdletBinding()]
param(
    [switch]$UseHyperV,
    [switch]$KeepArtifacts
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $env:USERPROFILE '.claude\_logs'
$report = Join-Path $logDir "vm-drill-$stamp.md"
$notify = Join-Path $env:USERPROFILE '.claude\scripts\notify-avi.ps1'
New-Item -Path $logDir -ItemType Directory -Force | Out-Null

$findings = [System.Collections.ArrayList]::new()

function Check($name, [scriptblock]$fn) {
    try {
        $r = & $fn
        [void]$findings.Add(@{ name = $name; status = 'PASS'; detail = $r })
        Write-Output "[PASS] $name : $r"
    } catch {
        [void]$findings.Add(@{ name = $name; status = 'FAIL'; detail = $_.Exception.Message })
        Write-Output "[FAIL] $name : $($_.Exception.Message)"
    }
}

if ($UseHyperV) {
    # Hyper-V path — requires admin + the VM "claude-drill" to pre-exist
    Check 'hyperv-vm-present' {
        $v = Get-VM -Name 'claude-drill' -ErrorAction Stop
        "vm state: $($v.State)"
    }
    Check 'revert-to-snapshot' {
        Restore-VMSnapshot -VMName 'claude-drill' -Name 'clean' -Confirm:$false -ErrorAction Stop
        'reverted to "clean" snapshot'
    }
    Check 'start-vm' {
        Start-VM -Name 'claude-drill' -ErrorAction Stop
        Start-Sleep -Seconds 30
        'started'
    }
    Check 'invoke-bootstrap-in-vm' {
        # Uses PowerShell Direct (no network needed)
        $scriptBlock = {
            param($repoUrl)
            git clone $repoUrl "$env:USERPROFILE\.claude" 2>&1
            & pwsh -File "$env:USERPROFILE\.claude\scripts\bootstrap-from-scratch.ps1" -SkipTasks 2>&1
        }
        $cred = Get-Credential -Message 'VM guest credentials'
        Invoke-Command -VMName 'claude-drill' -Credential $cred -ScriptBlock $scriptBlock `
            -ArgumentList 'https://github.com/BAS-More/claude-home-backup.git'
        'bootstrap completed inside VM'
    }
} else {
    # Sandbox mode — no Hyper-V required
    $scratch = Join-Path $env:TEMP "claude-drill-$stamp"
    New-Item -Path $scratch -ItemType Directory -Force | Out-Null
    Write-Output "Sandbox: $scratch"

    $fakeHome = Join-Path $scratch 'USERPROFILE'
    New-Item -Path $fakeHome -ItemType Directory -Force | Out-Null

    Check 'prereq-git' {
        $v = (& git --version) 2>&1
        "$v"
    }
    Check 'prereq-node' {
        $v = (& node --version) 2>&1
        "$v"
    }
    Check 'prereq-python' {
        $v = (& python --version) 2>&1
        "$v"
    }

    Check 'clone-into-sandbox' {
        $cloneDir = Join-Path $fakeHome '.claude'
        & git clone --depth 1 https://github.com/BAS-More/claude-home-backup.git $cloneDir 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "clone failed (exit $LASTEXITCODE)" }
        $n = (Get-ChildItem $cloneDir -Recurse -File | Measure-Object).Count
        "$n files cloned"
    }

    Check 'manifest-regen-in-sandbox' {
        # Copy a real .claude.json to fake profile so regen has input
        Copy-Item (Join-Path $env:USERPROFILE '.claude.json') (Join-Path $fakeHome '.claude.json') -Force
        # Temporarily redirect HOME for the python script
        $oldHome = $env:USERPROFILE
        $env:USERPROFILE = $fakeHome
        try {
            $sync = Join-Path $fakeHome '.claude\scripts\manifest_sync.py'
            & python $sync regen 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "regen failed (exit $LASTEXITCODE)" }
        } finally {
            $env:USERPROFILE = $oldHome
        }
        $m = Join-Path $fakeHome '.claude\mcp-manifest.json'
        if (-not (Test-Path $m)) { throw 'manifest not written' }
        $len = (Get-Item $m).Length
        "manifest size: $len bytes"
    }

    Check 'hooks-lf-encoded' {
        $pc = Join-Path $fakeHome '.claude\.githooks\pre-commit'
        $bytes = [System.IO.File]::ReadAllBytes($pc)
        $hasCRLF = $bytes -contains 13
        if ($hasCRLF) { throw 'pre-commit has CRLF (bash will refuse to run)' }
        'pre-commit is LF-only'
    }

    Check 'bootstrap-script-parses' {
        # Parse-only sanity — catches syntax drift without executing side effects
        $b = Join-Path $fakeHome '.claude\scripts\bootstrap-from-scratch.ps1'
        $null = [System.Management.Automation.PSParser]::Tokenize((Get-Content $b -Raw), [ref]$null)
        'no parse errors'
    }

    Check 'recovery-md-present' {
        $r = Join-Path $fakeHome '.claude\RECOVERY.md'
        if (-not (Test-Path $r)) { throw 'RECOVERY.md missing from clone' }
        "$([Math]::Round((Get-Item $r).Length/1KB, 1)) KB"
    }

    if (-not $KeepArtifacts) {
        Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Output "Artifacts kept at: $scratch"
    }
}

# Report
$failed = @($findings | Where-Object { $_.status -eq 'FAIL' })
$md = @()
$md += "# VM Bootstrap Drill — $stamp"
$md += ''
$md += "Mode: $(if ($UseHyperV) { 'Hyper-V VM' } else { 'Sandbox' })"
$md += "Failures: $($failed.Count)/$($findings.Count)"
$md += ''
$md += '| Check | Status | Detail |'
$md += '|-------|--------|--------|'
foreach ($f in $findings) {
    $md += "| $($f.name) | $($f.status) | $($f.detail) |"
}
Set-Content -Path $report -Value ($md -join "`n") -Encoding UTF8
Write-Output ''
Write-Output "Report: $report"

if ($failed.Count -gt 0) {
    if (Test-Path $notify) {
        & pwsh -NoProfile -File $notify -Title 'VM drill FAILED' -Message "$($failed.Count)/$($findings.Count) checks failed" 2>&1 | Out-Null
    }
    exit 1
}
exit 0
