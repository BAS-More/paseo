<#
.SYNOPSIS
  Notify Avi about a tool-health incident via Windows toast + JSONL log.

.DESCRIPTION
  Two channels, in order of preference:
    1. Windows toast (WinRT ToastNotificationManager) - user sees it live
    2. Fallback: message box via WScript.Shell if WinRT unavailable

  Always appends a record to ~/.claude/_logs/tool-health-incidents.jsonl
  regardless of whether the toast succeeded.

.PARAMETER Title
  Short headline (shown in toast title). Required.

.PARAMETER Body
  One-sentence explanation (shown in toast body). Required.

.PARAMETER Severity
  Info | Warning | Critical. Required.

.PARAMETER Details
  Optional path to the full status report (e.g. tool-health-status.md).
  Included in the JSONL record for follow-up.

.PARAMETER Component
  Optional - which tool was affected (e.g. "mcp:avios-context", "pr-health").

.PARAMETER LogPath
  Optional - incident log file path. Defaults to a per-Component file so
  different monitors (tool-health vs pr-health) keep separate dedup state.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Body,
    [Parameter(Mandatory = $true)][ValidateSet('Info','Warning','Critical')][string]$Severity,
    [string]$Details = '',
    [string]$Component = '',
    [string]$LogPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# Choose log path: explicit > per-component > legacy tool-health
if ($LogPath) {
    $logPath = $LogPath
} elseif ($Component -and ($Component -ne 'tool-health')) {
    $logPath = Join-Path $env:USERPROFILE (".claude\_logs\" + $Component + "-incidents.jsonl")
} else {
    $logPath = Join-Path $env:USERPROFILE '.claude\_logs\tool-health-incidents.jsonl'
}

# Escape helper for XML
function ConvertTo-XmlSafe([string]$s) {
    return ($s -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;' -replace '"', '&quot;' -replace "'", '&apos;')
}

$toastFired = $false

try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]

    $titleX = ConvertTo-XmlSafe $Title
    $bodyX  = ConvertTo-XmlSafe ("[" + $Severity.ToUpper() + "] " + $Body)
    $detailX = if ($Details) { ConvertTo-XmlSafe ("Report: " + $Details) } else { '' }

    $template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$titleX</text>
      <text>$bodyX</text>
      <text>$detailX</text>
    </binding>
  </visual>
</toast>
"@

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code - Tool Health').Show($toast)
    $toastFired = $true
} catch {
    try {
        $shell = New-Object -ComObject WScript.Shell
        $icon = switch ($Severity) { 'Critical' { 16 } 'Warning' { 48 } default { 64 } }
        [void]$shell.Popup(("[" + $Severity + "] " + $Title + "`n`n" + $Body + "`n`n" + $Details), 0, 'Claude Code - Tool Health', $icon + 4096)
        $toastFired = $true
    } catch {
        # last resort - cannot notify interactively
    }
}

# Always log
$record = [pscustomobject]@{
    ts           = (Get-Date).ToString('o')
    severity     = $Severity
    component    = $Component
    title        = $Title
    body         = $Body
    details_path = $Details
    toast_fired  = $toastFired
    resolved_at  = $null
}
$line = $record | ConvertTo-Json -Compress
Add-Content -Path $logPath -Value $line -Encoding UTF8

Write-Host ("Incident logged: " + $logPath)
Write-Host ("  [" + $Severity + "] " + $Title)
Write-Host ("  " + $Body)
if (-not $toastFired) {
    Write-Host "  (toast channel failed - log-only)" -ForegroundColor Yellow
    exit 1
}
exit 0
