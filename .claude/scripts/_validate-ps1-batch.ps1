# _validate-ps1-batch.ps1
#
# Batch PowerShell parse validation. Reads file paths (one per line) from
# stdin, tokenizes each, prints failing paths to stdout.
#
# Used by .githooks/pre-push gate 4. Avoids the 22-second cost of one
# powershell.exe invocation per file by tokenizing all in a single process.
#
# Exit 0 if all parsed; exit 1 if any failed.

$ErrorActionPreference = 'Continue'

$failed = 0
while ($null -ne ($line = [Console]::In.ReadLine())) {
    $path = $line.Trim()
    if ([string]::IsNullOrEmpty($path)) { continue }
    if (-not (Test-Path -LiteralPath $path)) { continue }
    try {
        $content = Get-Content -Raw -LiteralPath $path -Encoding UTF8
        $errors = $null
        [void][System.Management.Automation.PSParser]::Tokenize($content, [ref]$errors)
        if ($errors -and $errors.Count -gt 0) {
            Write-Output $path
            $failed++
        }
    } catch {
        Write-Output $path
        $failed++
    }
}
if ($failed -gt 0) { exit 1 } else { exit 0 }
