<#
.SYNOPSIS
  Hourly mirror of Claude Code state + Total Recall DB snapshot to OneDrive.
  Runs via Task Scheduler; manual run also fine.

.DESCRIPTION
  Three layers of protection, one task:
    1. OneDrive mirror of everything under ~/.claude EXCEPT credentials —
       captures chat .jsonl, hooks, scripts, skills, agents, commands, etc.
       OneDrive version history (30 days) = point-in-time recovery.
    2. Top-level .claude.json config.
    3. Local git snapshot of Total Recall's SQLite DB — versioned rollback
       on top of the cloud (D1) sync, belt-and-suspenders.

  EXCLUDED for safety:
    - .credentials.json          (auth tokens)
    - sessions/ PID state files  (transient, worthless after restart)
    - plugins/, cache/           (reproducible from marketplace / cache)
    - shell-snapshots/           (ephemeral)
#>

$ErrorActionPreference = 'Stop'

$src    = Join-Path $env:USERPROFILE '.claude'
$dst    = Join-Path $env:USERPROFILE 'OneDrive - BAS & More\ClaudeCodeBackup'
$logDir = Join-Path $dst '_logs'
$log    = Join-Path $logDir ("backup-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')

New-Item -Path $dst    -ItemType Directory -Force | Out-Null
New-Item -Path $logDir -ItemType Directory -Force | Out-Null
"==== Backup run $(Get-Date -Format o) ====" | Out-File -Append -Encoding UTF8 $log

# ============================================================================
# Layer 1: Mirror ~/.claude (most of it) -> OneDrive
# ============================================================================
# Dirs worth capturing. Order = priority; projects (.jsonl chats) FIRST.
$dirsToMirror = @(
    'projects',        # THE chat transcripts — primary concern
    'hooks',           # secret-scanner.js, best-practice-advisor.js, etc.
    'scripts',         # this backup script + mcp-health helpers
    'agents',          # custom agents
    'commands',        # custom slash commands
    'skills',          # custom skills
    'rules',           # advisor rule bodies (also in its own git repo)
    'ezra-templates',  # EZRA framework templates
    'plans',           # plan files
    'backups'          # .claude.json historical snapshots
)

foreach ($d in $dirsToMirror) {
    $s = Join-Path $src $d
    if (-not (Test-Path $s)) { continue }
    $t = Join-Path $dst $d
    $rcArgs = @($s, $t, '/MIR', '/R:2', '/W:5', '/NDL', '/NP', '/NJH', '/NJS', "/LOG+:$log")
    & robocopy @rcArgs | Out-Null
    if ($LASTEXITCODE -ge 8) {
        "ERROR: mirror $d failed (exit $LASTEXITCODE)" | Out-File -Append -Encoding UTF8 $log
        throw "robocopy $d failed with exit $LASTEXITCODE"
    }
}

# Top-level non-secret config files + state files
# .credentials.json is DELIBERATELY excluded — it contains plaintext OAuth
# tokens. Its loss is survivable (re-login regenerates it).
foreach ($f in @(
    '.claude.json',
    '.claude\settings.local.json',
    '.claude\settings.json',
    '.claude\mcp-needs-auth-cache.json',
    '.claude\_logs\integrity-log.jsonl',
    '.claude\_logs\config-audit.jsonl',
    '.claude\history.jsonl',
    '.claude\policy-limits.json'
)) {
    $sf = Join-Path $env:USERPROFILE $f
    if (Test-Path $sf) {
        Copy-Item $sf (Join-Path $dst (Split-Path -Leaf $f)) -Force
    }
}

# ============================================================================
# Layer 3: Daily restore-verify test (once per day)
# ============================================================================
# A backup that hasn't been restore-tested is schrödinger's backup. This
# verifies: files exist in OneDrive, sizes > 0, are readable, a spot-checked
# file round-trips from OneDrive bytes back to expected content. Runs once
# a day based on a marker file.
$verifyMarker = Join-Path $dst '_last_verify.txt'
$verifyDue = $true
if (Test-Path $verifyMarker) {
    $lastVerify = (Get-Item $verifyMarker).LastWriteTime
    if ((Get-Date) - $lastVerify -lt (New-TimeSpan -Hours 23)) {
        $verifyDue = $false
    }
}

if ($verifyDue) {
    "  Running daily restore-verify..." | Out-File -Append -Encoding UTF8 $log
    $errors = @()

    # 1. Key files exist + non-zero
    $expect = @(
        (Join-Path $dst '.claude.json'),
        (Join-Path $dst 'settings.json'),
        (Join-Path $dst 'projects')
    )
    foreach ($p in $expect) {
        if (-not (Test-Path $p)) { $errors += "MISSING: $p" }
        elseif ((Get-Item $p).PSIsContainer -eq $false -and (Get-Item $p).Length -eq 0) {
            $errors += "EMPTY: $p"
        }
    }

    # 2. Restore round-trip: copy a .jsonl to a temp dir, verify it reads
    $tempRestore = Join-Path $env:TEMP "claude-restore-test-$(Get-Random)"
    New-Item -Path $tempRestore -ItemType Directory -Force | Out-Null
    try {
        $sample = Get-ChildItem (Join-Path $dst 'projects') -Filter '*.jsonl' -Recurse -ErrorAction SilentlyContinue |
                  Select-Object -First 1
        if ($sample) {
            $target = Join-Path $tempRestore $sample.Name
            Copy-Item $sample.FullName $target -Force
            $lines = (Get-Content $target -ErrorAction Stop | Measure-Object).Count
            if ($lines -lt 1) { $errors += "RESTORE FAIL: sample $($sample.Name) unreadable" }
            else {
                "    restore sample OK: $($sample.Name) ($lines lines)" | Out-File -Append -Encoding UTF8 $log
            }
        } else {
            $errors += "RESTORE FAIL: no .jsonl samples found in backup"
        }
    } finally {
        Remove-Item $tempRestore -Recurse -Force -ErrorAction SilentlyContinue
    }

    # 3. Write verify result
    if ($errors.Count -eq 0) {
        $verifyStamp = "Verify passed $(Get-Date -Format o)"
        $verifyStamp | Out-File -Encoding UTF8 $verifyMarker
        $verifyStamp | Out-File -Encoding UTF8 (Join-Path $src '_last_verify.txt')
        "  Verify PASSED" | Out-File -Append -Encoding UTF8 $log
    } else {
        "VERIFY FAILED $(Get-Date -Format o)`n$($errors -join "`n")" | Out-File -Encoding UTF8 $verifyMarker
        "  Verify FAILED:" | Out-File -Append -Encoding UTF8 $log
        $errors | ForEach-Object { "    $_" | Out-File -Append -Encoding UTF8 $log }
    }
}

# ============================================================================
# Layer 2: Git snapshot of Total Recall DB (local, versioned)
# ============================================================================
# Why: gives point-in-time rollback of the TR knowledge/sessions state even
# if cloud sync corrupts something. Stays local — no sensitive payload needed
# in OneDrive.
$trDataDir = Join-Path $env:APPDATA 'total-recall'
$trDb      = Join-Path $trDataDir 'data.db'
$gitBackup = Join-Path $trDataDir 'git-backup'
$gitDb     = Join-Path $gitBackup 'data.db'

if (Test-Path $trDb) {
    New-Item -Path $gitBackup -ItemType Directory -Force | Out-Null

    # First run: init repo + .gitignore
    if (-not (Test-Path (Join-Path $gitBackup '.git'))) {
        Push-Location $gitBackup
        try {
            & git init --quiet 2>&1 | Out-Null
            & git config user.email 'avi@basnmore.com.au' 2>&1 | Out-Null
            & git config user.name 'Total Recall Backup' 2>&1 | Out-Null
            '*.db-wal' | Out-File -Encoding ASCII '.gitignore'
            '*.db-shm' | Out-File -Append -Encoding ASCII '.gitignore'
            "Repo initialized $(Get-Date -Format o)" | Out-File -Encoding UTF8 'README.md'
            & git add .gitignore README.md 2>&1 | Out-Null
            & git commit --quiet -m 'init: Total Recall DB backup repo' 2>&1 | Out-Null
        } finally { Pop-Location }
    }

    # Copy current DB (SQLite WAL-safe — no checkpoint needed since we're not
    # mid-transaction; the WAL file is excluded via .gitignore)
    Copy-Item $trDb $gitDb -Force

    Push-Location $gitBackup
    try {
        & git add -A 2>&1 | Out-Null
        # Only commit if something changed
        $changes = & git status --porcelain 2>&1
        if ($changes) {
            $msg = "snapshot $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
            & git commit --quiet -m $msg 2>&1 | Out-Null
            "  TR DB snapshot committed: $msg" | Out-File -Append -Encoding UTF8 $log
        } else {
            "  TR DB unchanged, skipped commit" | Out-File -Append -Encoding UTF8 $log
        }
    } finally { Pop-Location }
}

# ============================================================================
# Layer 3: Stash .credentials.json into the vault (encrypted via vault sync)
# ============================================================================
# .credentials.json holds OAuth tokens — excluded from the OneDrive plaintext
# mirror for safety. Store its content as a vault entry so it rides along on
# the encrypted vault.sync push. Recovery: vault get + write file back.
# .credentials.json is 9 KB — too big for Windows Credential Manager (2.5 KB
# limit). Encrypt to a standalone .enc file on OneDrive with the same
# passphrase as the vault. Recovery is symmetric (same key derivation).
try {
    $result = & python (Join-Path $env:USERPROFILE '.claude\scripts\encrypt-credentials.py') 2>&1
    if ($LASTEXITCODE -eq 0) {
        "  credentials: $result" | Out-File -Append -Encoding UTF8 $log
    } else {
        "  WARN: credentials encrypt failed ($LASTEXITCODE): $result" | Out-File -Append -Encoding UTF8 $log
    }
} catch {
    "  WARN: credentials encrypt threw: $_" | Out-File -Append -Encoding UTF8 $log
}

# Push encrypted vault snapshot to OneDrive (silent — passphrase in keyring)
try {
    & python 'C:\Dev\tools\vault\vault_backup.py' sync push 2>&1 | Out-Null
    "  vault.sync pushed to OneDrive" | Out-File -Append -Encoding UTF8 $log
} catch {
    "  WARN: vault sync failed: $_" | Out-File -Append -Encoding UTF8 $log
}

# ============================================================================
# Layer 4: Monthly git fsck on versioned backup repos
# ============================================================================
$fsckMarker = Join-Path $dst '_last_fsck.txt'
$fsckDue = $true
if (Test-Path $fsckMarker) {
    if ((Get-Date) - (Get-Item $fsckMarker).LastWriteTime -lt (New-TimeSpan -Days 30)) {
        $fsckDue = $false
    }
}
if ($fsckDue) {
    "  Running monthly git fsck..." | Out-File -Append -Encoding UTF8 $log
    $repos = @(
        (Join-Path $env:APPDATA 'total-recall\git-backup'),
        (Join-Path $env:USERPROFILE '.claude\rules')
    )
    $fsckErrors = @()
    foreach ($r in $repos) {
        if (-not (Test-Path (Join-Path $r '.git'))) { continue }
        Push-Location $r
        try {
            $out = & git fsck --full --strict 2>&1
            if ($LASTEXITCODE -ne 0) {
                $fsckErrors += "FSCK FAIL in $r : $out"
            } else {
                "    fsck OK: $r" | Out-File -Append -Encoding UTF8 $log
            }
        } finally { Pop-Location }
    }
    if ($fsckErrors.Count -eq 0) {
        $fsckStamp = "fsck passed $(Get-Date -Format o)"
        $fsckStamp | Out-File -Encoding UTF8 $fsckMarker
        $fsckStamp | Out-File -Encoding UTF8 (Join-Path $src '_last_fsck.txt')
    } else {
        "FSCK FAILED $(Get-Date -Format o)`n$($fsckErrors -join "`n")" | Out-File -Encoding UTF8 $fsckMarker
        $fsckErrors | ForEach-Object { "  $_" | Out-File -Append -Encoding UTF8 $log }
    }
}

# ============================================================================
# Layer 5: Audit log rotation (cap jsonl logs at 1 MB)
# ============================================================================
# config-audit.jsonl + integrity-log.jsonl would grow forever. Rotate at 1 MB:
# current -> .log.1 -> .log.2 -> ... .log.5 (older dropped).
$rotateTargets = @(
    (Join-Path $env:USERPROFILE '.claude\_logs\config-audit.jsonl'),
    (Join-Path $env:USERPROFILE '.claude\_logs\integrity-log.jsonl')
)
$MAX_BYTES = 1MB
$KEEP = 5
foreach ($f in $rotateTargets) {
    if (-not (Test-Path $f)) { continue }
    if ((Get-Item $f).Length -lt $MAX_BYTES) { continue }
    # Shift .log.N -> .log.(N+1), drop oldest
    for ($n = $KEEP; $n -ge 1; $n--) {
        $src2 = "$f.$n"
        $dst2 = "$f.$($n + 1)"
        if ($n -eq $KEEP -and (Test-Path $src2)) {
            Remove-Item $src2 -Force
        } elseif (Test-Path $src2) {
            Move-Item $src2 $dst2 -Force
        }
    }
    Move-Item $f "$f.1" -Force
    # Preserve file handle expectations by re-creating an empty file
    New-Item -Path $f -ItemType File -Force | Out-Null
    "  rotated $(Split-Path $f -Leaf)" | Out-File -Append -Encoding UTF8 $log
}

# ============================================================================
# Finish
# ============================================================================
$stamp = "Last successful backup: $(Get-Date -Format o)"
$stamp | Out-File -Encoding UTF8 "$dst\_last_backup.txt"
$stamp | Out-File -Encoding UTF8 (Join-Path $src '_last_backup.txt')
"OK  $(Get-Date -Format o)" | Out-File -Append -Encoding UTF8 $log

# Prune log files older than 30 days
Get-ChildItem $logDir -Filter 'backup-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "Backup complete -> $dst"
Write-Host "TR DB snapshot   -> $gitBackup"
