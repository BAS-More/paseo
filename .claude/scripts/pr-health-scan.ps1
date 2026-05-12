<#
.SYNOPSIS
  Scan Avi's open PRs across BAS-More and Avi-Bendetsky, classify each,
  write a status JSON + markdown report, and notify on state change.

.DESCRIPTION
  Headless counterpart to the pr-health-guardian subagent.

  Flow:
    1. gh search prs --involves @me --state open --limit 50
    2. for each PR: gh pr view --json statusCheckRollup,mergeable,reviewDecision,labels,isDraft,author,headRefName
    3. classify: GREEN | PENDING | RED | CONFLICT
    4. write ~/.claude/pr-health-status.json + .md
    5. dedup-notify via notify-avi.ps1:
         - toast on new RED or new CONFLICT
         - toast on recovery (was RED, now GREEN/merged)
         - suppress if same fingerprint as last run

  Does NOT auto-fix. Fixing is the guardian agent's job.
#>

[CmdletBinding()]
param([switch]$Quiet)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$claudeDir   = Join-Path $env:USERPROFILE '.claude'
$scriptsDir  = Join-Path $claudeDir 'scripts'
$statusJson  = Join-Path $claudeDir 'pr-health-status.json'
$statusMd    = Join-Path $claudeDir 'pr-health-status.md'
$incidents   = Join-Path $claudeDir '_logs\pr-health-incidents.jsonl'

function Say([string]$msg, [string]$color = 'Gray') {
    if (-not $Quiet) { Write-Host $msg -ForegroundColor $color }
}

# --- Healthchecks.io ping (no-op if URL missing) ---
function Get-HCUrl {
    param([string]$Component)
    $envKey = 'HEALTHCHECKS_' + ($Component.ToUpper() -replace '-','_') + '_URL'
    $envVal = [Environment]::GetEnvironmentVariable($envKey)
    if ($envVal) { return $envVal.Trim() }
    try {
        $vaultUrl = & python 'C:\Dev\tools\vault\vault.py' get healthchecks ("$Component-url") 2>$null
        if ($LASTEXITCODE -eq 0 -and $vaultUrl) { return $vaultUrl.Trim() }
    } catch { }
    return $null
}
function Invoke-HCPing {
    param([string]$Url, [string]$Suffix = '', [string]$Body = '')
    if (-not $Url) { return }
    $target = $Url.TrimEnd('/')
    if ($Suffix) { $target += "/$Suffix" }
    try {
        if ($Body) {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
            Invoke-WebRequest -Uri $target -Method POST -Body $bytes -ContentType 'text/plain; charset=utf-8' -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop | Out-Null
        } else {
            Invoke-WebRequest -Uri $target -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop | Out-Null
        }
    } catch { Say ("  hc ping failed (non-fatal): " + $_.Exception.Message) 'DarkGray' }
}
$hcUrl = Get-HCUrl 'pr-health'
Invoke-HCPing -Url $hcUrl -Suffix 'start'

Say ""
Say "=== PR Health Scan ===" 'Cyan'
Say ("Date: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ""

# Step 1: list open PRs involving Avi
$prsJsonRaw = & gh search prs --involves "@me" --state open --limit 50 --json 'repository,number,title,url,author,createdAt,updatedAt' 2>&1
if ($LASTEXITCODE -ne 0) {
    Say ("gh search failed: " + ($prsJsonRaw | Out-String)) 'Red'
    exit 3
}
$prs = $prsJsonRaw | ConvertFrom-Json
Say ("Found {0} open PR(s)" -f $prs.Count)

$results = @()

# Step 2: enrich each PR with status
foreach ($pr in $prs) {
    $nwo = $pr.repository.nameWithOwner
    $num = $pr.number
    Say ("  probing {0}#{1}" -f $nwo, $num) 'DarkGray'

    try {
        $detail = & gh pr view $num --repo $nwo --json 'statusCheckRollup,mergeable,reviewDecision,labels,isDraft,author,headRefName,baseRefName,url' 2>&1 | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $results += [pscustomobject]@{
            repo = $nwo; number = $num; title = $pr.title; url = $pr.url
            overall = 'UNKNOWN'; reason = ("gh pr view failed: " + $_.Exception.Message)
            failing_checks = @(); author = $pr.author.login; labels = @()
            head_branch = $null; base_branch = $null; mergeable = $null; review_decision = $null; is_draft = $null
        }
        continue
    }

    # Classify status checks
    $checks = @($detail.statusCheckRollup)
    $failing = @()
    $pending = 0
    foreach ($c in $checks) {
        $status = if ($c.PSObject.Properties['status']) { $c.status } else { $null }
        $concl  = if ($c.PSObject.Properties['conclusion']) { $c.conclusion } else { $null }
        $state  = if ($c.PSObject.Properties['state']) { $c.state } else { $null }

        if ($status -eq 'IN_PROGRESS' -or $status -eq 'QUEUED' -or $status -eq 'PENDING' -or $state -eq 'PENDING') {
            $pending++
            continue
        }

        # Failed conclusions/states we care about
        $badConcl = @('FAILURE','TIMED_OUT','ACTION_REQUIRED','CANCELLED','STARTUP_FAILURE','STALE')
        $badState = @('FAILURE','ERROR')

        if (($null -ne $concl -and $badConcl -contains $concl) -or ($null -ne $state -and $badState -contains $state)) {
            $failing += [pscustomobject]@{
                name = if ($c.PSObject.Properties['name']) { $c.name } else { $c.context }
                conclusion = $concl
                state = $state
                details_url = if ($c.PSObject.Properties['detailsUrl']) { $c.detailsUrl } else { $c.targetUrl }
            }
        }
    }

    $overall = 'GREEN'
    if ($detail.mergeable -eq 'CONFLICTING') { $overall = 'CONFLICT' }
    elseif ($failing.Count -gt 0)           { $overall = 'RED' }
    elseif ($pending -gt 0)                 { $overall = 'PENDING' }

    $labels = @()
    if ($detail.PSObject.Properties['labels']) {
        $labels = @($detail.labels | ForEach-Object { $_.name })
    }

    $results += [pscustomobject]@{
        repo            = $nwo
        number          = $num
        title           = $pr.title
        url             = $detail.url
        overall         = $overall
        failing_checks  = $failing
        pending_count   = $pending
        mergeable       = $detail.mergeable
        review_decision = $detail.reviewDecision
        is_draft        = $detail.isDraft
        author          = if ($detail.author.PSObject.Properties['login']) { $detail.author.login } else { 'unknown' }
        head_branch     = $detail.headRefName
        base_branch     = $detail.baseRefName
        labels          = $labels
    }

    $color = switch ($overall) { 'GREEN' { 'Green' } 'RED' { 'Red' } 'CONFLICT' { 'Red' } 'PENDING' { 'Yellow' } default { 'DarkGray' } }
    Say ("    [{0}] {1}#{2} - {3}" -f $overall, $nwo, $num, ($pr.title -replace '[\r\n]',' ').Substring(0, [Math]::Min(60, $pr.title.Length))) $color
}

# Summary
$greenN    = @($results | Where-Object { $_.overall -eq 'GREEN' }).Count
$redN      = @($results | Where-Object { $_.overall -eq 'RED' }).Count
$confN     = @($results | Where-Object { $_.overall -eq 'CONFLICT' }).Count
$pendN     = @($results | Where-Object { $_.overall -eq 'PENDING' }).Count
$unknownN  = @($results | Where-Object { $_.overall -eq 'UNKNOWN' }).Count

Say ""
Say ("--- {0} green, {1} red, {2} conflict, {3} pending, {4} unknown ---" -f $greenN, $redN, $confN, $pendN, $unknownN) 'Cyan'

# Build fingerprint (RED + CONFLICT PRs only - pending is transient)
$trouble = @($results | Where-Object { $_.overall -in @('RED','CONFLICT') } | Sort-Object repo, number)
$fpInput = ($trouble | ForEach-Object { "$($_.repo)#$($_.number)=$($_.overall):" + (($_.failing_checks | ForEach-Object { $_.name }) -join ',') }) -join ' || '
$fingerprint = if ($fpInput) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($fpInput)
    ([System.BitConverter]::ToString($md5.ComputeHash($bytes))).Replace('-','').ToLower()
} else { 'clean' }

# Write JSON
$payload = [pscustomobject]@{
    ts           = (Get-Date).ToString('o')
    fingerprint  = $fingerprint
    summary      = @{ green = $greenN; red = $redN; conflict = $confN; pending = $pendN; unknown = $unknownN; total = $results.Count }
    prs          = $results
}
# BOM-less UTF-8 (Out-File -Encoding utf8 emits BOM under PS 5.1
# which breaks Python json.load in agent consumers like the
# pr-health-auto-remediate cron loop).
$jsonText = $payload | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($statusJson, $jsonText, (New-Object System.Text.UTF8Encoding $false))

# Write markdown
$md = @()
$md += "# PR health - $((Get-Date).ToString('o'))"
$md += ""
$md += ("**Summary:** {0} green | {1} red | {2} conflict | {3} pending | {4} unknown" -f $greenN, $redN, $confN, $pendN, $unknownN)
$md += ""
$md += "| PR | State | Author | Failing | Review | Mergeable |"
$md += "| --- | --- | --- | --- | --- | --- |"
foreach ($r in ($results | Sort-Object @{Expression={if ($_.overall -eq 'RED' -or $_.overall -eq 'CONFLICT'){0}else{1}}}, repo, number)) {
    $fail = if ($r.failing_checks.Count -gt 0) { ($r.failing_checks | ForEach-Object { $_.name }) -join ', ' } else { '-' }
    $title = ($r.title -replace '[\|\r\n]',' ').Substring(0, [Math]::Min(50, $r.title.Length))
    $prLink = "[" + $r.repo + "#" + $r.number + "](" + $r.url + ")"
    $md += ("| {0} {1} | {2} | {3} | {4} | {5} | {6} |" -f $prLink, $title, $r.overall, $r.author, $fail, $r.review_decision, $r.mergeable)
}
$md += ""
$md += ("_Scanned: {0} PRs at {1}_" -f $results.Count, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
$mdText = $md -join "`r`n"
[System.IO.File]::WriteAllText($statusMd, $mdText, (New-Object System.Text.UTF8Encoding $false))

Say ""
Say ("Report: " + $statusMd) 'Cyan'

# Dedup-notify
$lastOpen = $null
if (Test-Path $incidents) {
    $lines = Get-Content $incidents -ErrorAction SilentlyContinue
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        try {
            $rec = $lines[$i] | ConvertFrom-Json
            if ($null -eq $rec.resolved_at -and $rec.component -eq 'pr-health') {
                $lastOpen = @{ index = $i; rec = $rec }
                break
            }
        } catch { continue }
    }
}

function Update-Resolved {
    param([int]$Index, [string]$Ts)
    $lines = Get-Content $incidents
    $rec = $lines[$Index] | ConvertFrom-Json
    $rec | Add-Member -Force -NotePropertyName resolved_at -NotePropertyValue $Ts
    $lines[$Index] = ($rec | ConvertTo-Json -Compress)
    $lines | Set-Content -Path $incidents -Encoding UTF8
}

$shouldToast = $false
$toastTitle = ''
$toastBody = ''
$toastSev = 'Info'

if ($fingerprint -eq 'clean') {
    if ($lastOpen) {
        Update-Resolved -Index $lastOpen.index -Ts (Get-Date).ToString('o')
        $shouldToast = $true
        $toastTitle = 'PR health: RECOVERED'
        $toastBody  = "All $($results.Count) open PR(s) back to green/pending. Previous issue resolved."
        $toastSev   = 'Info'
    }
} else {
    $prevFp = $null
    if ($lastOpen) { $prevFp = ($lastOpen.rec.PSObject.Properties['fingerprint']).Value }

    if (-not $lastOpen) {
        $shouldToast = $true
        $toastTitle = 'PR health: attention needed'
        $toastBody  = "$redN red, $confN conflict - see pr-health-status.md"
        $toastSev   = if ($redN -gt 0 -or $confN -gt 0) { 'Warning' } else { 'Info' }
    } elseif ($prevFp -ne $fingerprint) {
        Update-Resolved -Index $lastOpen.index -Ts (Get-Date).ToString('o')
        $shouldToast = $true
        $toastTitle = 'PR health: state changed'
        $toastBody  = "$redN red, $confN conflict (failure set differs from last run)"
        $toastSev   = 'Warning'
    } else {
        # ConvertFrom-Json auto-parses ISO strings into [DateTime]; handle both
        # raw-string and DateTime shapes robustly via InvariantCulture.
        if ($lastOpen.rec.ts -is [DateTime]) {
            $lastTs = [DateTimeOffset]$lastOpen.rec.ts
        } else {
            $lastTs = [DateTimeOffset]::Parse([string]$lastOpen.rec.ts, [System.Globalization.CultureInfo]::InvariantCulture)
        }
        $hoursSince = ((Get-Date) - $lastTs.LocalDateTime).TotalHours
        if ($hoursSince -ge 24) {
            $shouldToast = $true
            $toastTitle = 'PR health: still stuck'
            $toastBody  = "$redN red, $confN conflict - no change in {0:N0}h" -f $hoursSince
            $toastSev   = 'Warning'
        } else {
            Say ("Same PR failure set as last run ({0:N1}h ago). Suppressing toast." -f $hoursSince) 'DarkGray'
        }
    }
}

if ($shouldToast) {
    $notifyScript = Join-Path $scriptsDir 'notify-avi.ps1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $notifyScript `
        -Title $toastTitle -Body $toastBody -Severity $toastSev `
        -Details $statusMd -Component 'pr-health' | Out-Null
    # Patch fingerprint onto the just-written incident
    if (Test-Path $incidents) {
        try {
            $lines = @(Get-Content $incidents -ErrorAction Stop)
            if ($lines.Count -gt 0) {
                $last = $lines[-1] | ConvertFrom-Json
                $last | Add-Member -Force -NotePropertyName fingerprint -NotePropertyValue $fingerprint
                $lines[-1] = ($last | ConvertTo-Json -Compress)
                $lines | Set-Content -Path $incidents -Encoding UTF8
            }
        } catch { Say ("  fingerprint patch skipped: " + $_.Exception.Message) 'DarkGray' }
    }
}

# Healthchecks body: first 60 lines of status.md
$hcBody = ''
if (Test-Path $statusMd) {
    $hcBody = (Get-Content $statusMd -TotalCount 60 -ErrorAction SilentlyContinue) -join "`n"
}

if ($redN -gt 0 -or $confN -gt 0) {
    Invoke-HCPing -Url $hcUrl -Suffix 'fail' -Body $hcBody
    exit 2
} elseif ($unknownN -gt 0) {
    Invoke-HCPing -Url $hcUrl -Suffix '1' -Body $hcBody
    exit 1
} else {
    Invoke-HCPing -Url $hcUrl -Body $hcBody
    exit 0
}
