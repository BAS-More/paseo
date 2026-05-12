# auto-dream.ps1 — Phase 4 T4.5c
#
# Weekly MEMORY.md hygiene: dedupe, decay-archive stale entries, rebuild index.
# Designed to run via Task Scheduler every Sunday 03:00.
#
# Register (one-time, requires admin) — REQUIRES pwsh (PS7+); does NOT work on Windows PowerShell 5.1:
#   $action = New-ScheduledTaskAction -Execute "pwsh.exe" `
#     -Argument "-NoProfile -ExecutionPolicy RemoteSigned -File `"$env:USERPROFILE\.claude\scripts\auto-dream.ps1`""
#   $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
#   $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
#     -LogonType S4U -RunLevel Limited
#   $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
#     -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
#   Register-ScheduledTask -TaskName "Claude-AutoDream-Weekly" `
#     -Action $action -Trigger $trigger -Principal $principal -Settings $settings

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Force UTF-8 for any emoji in MEMORY.md content (per learning_python_windows_emoji)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$projectsRoot = Join-Path $env:USERPROFILE ".claude\projects"
$logsRoot     = Join-Path $env:USERPROFILE ".claude\_logs\auto-dream"
$archiveAge   = 90  # days — entries not touched in N days demoted to _archive/
$today        = Get-Date
$reportPath   = Join-Path $logsRoot ("report-" + $today.ToString("yyyy-MM-dd") + ".json")

New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null

if (-not (Test-Path $projectsRoot)) {
  Write-Output "[auto-dream] no projects/ dir — nothing to do"
  exit 0
}

$report = @{
  ts       = $today.ToString("o")
  projects = @()
  totals   = @{ archived = 0; broken_links = 0; surveyed = 0 }
}

Get-ChildItem $projectsRoot -Directory |
  Where-Object { $_.Name -notmatch '^_' } |
  ForEach-Object {
    $project   = $_.Name
    $memoryDir = Join-Path $_.FullName "memory"
    if (-not (Test-Path $memoryDir)) { return }

    $archiveDir = Join-Path $memoryDir "_archive"
    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null

    $stats = @{ project = $project; archived = @(); broken_links = @(); surveyed = 0 }

    # 1. Archive stale feedback_*.md / learning_*.md (not modified in $archiveAge days)
    Get-ChildItem $memoryDir -File -Filter "*.md" |
      Where-Object { $_.Name -notmatch '^MEMORY\.md$' -and $_.Name -notmatch '^_' } |
      ForEach-Object {
        $stats.surveyed++
        $age = ($today - $_.LastWriteTime).TotalDays
        if ($age -gt $archiveAge) {
          $dest = Join-Path $archiveDir $_.Name
          Move-Item $_.FullName $dest -Force
          $stats.archived += $_.Name
          $report.totals.archived++
        }
      }

    # 2. Sweep MEMORY.md for broken markdown links to local files
    #    Strip HTML comments first so example links in template comments don't false-positive.
    $memoryIndex = Join-Path $memoryDir "MEMORY.md"
    if (Test-Path $memoryIndex) {
      $rawContent = Get-Content $memoryIndex -Raw -Encoding UTF8
      $commentStripped = [regex]::Replace($rawContent, '(?s)<!--.*?-->', '')
      $linkPattern = [regex]::new('\[[^\]]+\]\(([^)]+\.md)\)')
      foreach ($m in $linkPattern.Matches($commentStripped)) {
        $linkTarget = $m.Groups[1].Value
        if ($linkTarget -match '^https?://') { continue }
        # Strip protocol prefixes like file:
        $cleanTarget = $linkTarget -replace '^file:', ''
        $absLink = Join-Path $memoryDir $cleanTarget
        if (-not (Test-Path $absLink)) {
          $stats.broken_links += $linkTarget
          $report.totals.broken_links++
        }
      }
    }

    if ($stats.surveyed -gt 0 -or $stats.archived.Count -gt 0 -or $stats.broken_links.Count -gt 0) {
      $report.projects += $stats
      $report.totals.surveyed += $stats.surveyed
    }
  }

# 3. Emit JSON report
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $reportPath -Encoding UTF8
Write-Output "[auto-dream] complete · surveyed=$($report.totals.surveyed) · archived=$($report.totals.archived) · broken=$($report.totals.broken_links)"
Write-Output "[auto-dream] report: $reportPath"

# 4. Retain only the last 8 weekly reports
$oldReports = @(Get-ChildItem $logsRoot -File -Filter "report-*.json" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 8)
foreach ($r in $oldReports) { Remove-Item $r.FullName -Force -ErrorAction SilentlyContinue }

exit 0
