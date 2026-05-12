# Write-JsonAtomic.ps1
#
# Phase 6a of docs/resilience-and-sync.md. Atomic JSON write helper.
#
# Dot-source from a calling script:
#   . "$env:USERPROFILE\.claude\scripts\lib\Write-JsonAtomic.ps1"
#   Set-JsonAtomic -Path $target -InputObject $payload -Depth 5
#
# Behaviour:
#   1. Render JSON via ConvertTo-Json (depth configurable).
#   2. Write to "<Path>.codemod-tmp" (the .codemod-tmp suffix matches
#      .gitignore in case the rename fails mid-flight).
#   3. Move-Item -Force to final path (atomic on Windows + POSIX).
#   4. Removes the temp file if rename throws.
#
# Why: PowerShell's `Set-Content` + `Out-File` overwrite the file in
# place. A crash mid-write leaves a half-written file with no recovery
# path except git history. With atomic write, either the old file or the
# new file exists at all times.

function Set-JsonAtomic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$InputObject,
        [int]$Depth = 5,
        [string]$Encoding = "UTF8"
    )

    $tmp = "$Path.codemod-tmp"
    try {
        $json = $InputObject | ConvertTo-Json -Depth $Depth
        # Use explicit UTF8 (no BOM) by default; preserve PS5.1 compatibility.
        Set-Content -Path $tmp -Value $json -Encoding $Encoding -NoNewline
        Move-Item -Path $tmp -Destination $Path -Force
    } catch {
        if (Test-Path -LiteralPath $tmp) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
        throw
    }
}
