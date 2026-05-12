#!/usr/bin/env python3
"""
portability-codemod — replace hardcoded user-home paths with portable forms.

Goal: same ~/.claude repo clones cleanly to a Windows PC with any username.
Eliminates the 51 hardcoded "C:/Users/Avi Bendetsky/..." paths across tracked
files. Drives Phase 1 of docs/resilience-and-sync.md.

Single source of truth used by:
  - manual: `python scripts/portability-codemod.py --apply`
  - SessionStart drift guard: `python scripts/portability-codemod.py --check`
  - pre-push gate: `python scripts/portability-codemod.py --check`
  - watchdog tier 2 (every 5 min): `--check` with auto-notify on drift

CLI:
    python portability-codemod.py                  # dry-run, exit 0 if clean,
                                                   # 1 if changes pending
    python portability-codemod.py --apply          # write changes
    python portability-codemod.py --check          # exit 1 on any drift
                                                   # (for hooks/watchdog)
    python portability-codemod.py --target FILE    # one file only
    python portability-codemod.py --report json    # machine-readable summary

Exit codes:
    0 — clean (or --apply succeeded)
    1 — changes pending (dry-run/check) or write failure
    2 — input error (config malformed, target outside repo, etc.)

Replacement model (locked in docs/resilience-and-sync.md §9.4):
    - settings.json hook command strings:
        "C:/Users/Avi Bendetsky/.claude/X" -> "$HOME/.claude/X"
    - .mcp.json paths:
        "C:/Users/Avi Bendetsky/.claude/X" -> "${HOME}/.claude/X"
    - PowerShell .ps1 scripts:
        "C:\\Users\\Avi Bendetsky\\.claude\\X" -> "$env:USERPROFILE\\.claude\\X"
    - Bash .sh scripts:
        "/c/Users/Avi Bendetsky/.claude/X" -> "$HOME/.claude/X"
    - Plain JS/CJS hooks (already use os.homedir() best-effort) — flagged for
      manual review only; codemod does NOT auto-rewrite JS path computations
      because it can't tell a string literal from a logged path.

Safety:
    - Idempotent: rerunning is a no-op once converted.
    - Dry-run by default. Apply requires explicit --apply.
    - Backs up modified files to scripts/.codemod-backup/<timestamp>/ on apply.
    - Never modifies gitignored files (asserted via `git check-ignore`).
    - Refuses to run with uncommitted changes to target files unless
      --allow-dirty is passed.
    - Skips _logs/*.jsonl (immutable audit history) and MEMORY.md (user notes).
    - Skips .git/* (per-PC config, handled by onboard-machine.ps1 instead).

Single-file mode:
    --target accepts a path relative to repo root or absolute. Useful for
    one-off conversion of a new file before adding it to config.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Iterable

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "scripts" / "portability-codemod.config.json"
BACKUP_ROOT = REPO_ROOT / "scripts" / ".codemod-backup"

# The literal username we are eliminating. Single source of truth.
HARDCODED_USER = "Avi Bendetsky"

# ---------------------------------------------------------------------------
# Replacement rules per file category
# ---------------------------------------------------------------------------

# settings.json + settings.local.json — JSON. Hook command strings run under
# bash by default, so $HOME expansion is the portable form. Order: more-
# specific rules first.
#
# JSON has two backslash forms in our settings:
#   single-escape: "C:\\Users\\X\\.claude\\..." (file-text: \\)
#   double-escape: "node \"C:\\\\Users\\\\X\\\\.claude\\\\..\""  (file-text: \\\\)
# The second form occurs when the path is inside an inner escaped quote.
# Both must be handled.
JSON_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    # .claude.json reference (forward-slash)
    (re.compile(r"C:/Users/" + re.escape(HARDCODED_USER) + r"/\.claude\.json"),
     "$HOME/.claude.json"),
    # .claude.json reference (backslash double-escape, file-text \\\\)
    (re.compile(r"C:\\\\\\\\Users\\\\\\\\" + re.escape(HARDCODED_USER) + r"\\\\\\\\\.claude\.json"),
     "$HOME\\\\\\\\.claude.json"),
    # .claude.json reference (backslash single-escape, file-text \\)
    (re.compile(r"C:\\\\Users\\\\" + re.escape(HARDCODED_USER) + r"\\\\\.claude\.json"),
     "$HOME\\\\.claude.json"),
    # .claude/ dir reference (forward slash)
    (re.compile(r"C:/Users/" + re.escape(HARDCODED_USER) + r"/\.claude/"),
     "$HOME/.claude/"),
    # .claude\\ dir reference (backslash double-escape, file-text \\\\)
    (re.compile(r"C:\\\\\\\\Users\\\\\\\\" + re.escape(HARDCODED_USER) + r"\\\\\\\\\.claude\\\\\\\\"),
     "$HOME\\\\\\\\.claude\\\\\\\\"),
    # .claude\ dir reference (backslash single-escape, file-text \\)
    (re.compile(r"C:\\\\Users\\\\" + re.escape(HARDCODED_USER) + r"\\\\\.claude\\\\"),
     "$HOME\\\\.claude\\\\"),
]

# Generic .json files (mcp-registry, plugins/known_marketplaces, etc.) —
# read by Node hooks that don't pass strings through a shell. Use ${HOME}
# token (Claude Code MCP loader expands it; Node consumers can match
# startsWith("${HOME}/") and substitute os.homedir() at read time).
MCP_JSON_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"C:/Users/" + re.escape(HARDCODED_USER) + r"/\.claude\.json"),
     "${HOME}/.claude.json"),
    (re.compile(r"C:\\\\\\\\Users\\\\\\\\" + re.escape(HARDCODED_USER) + r"\\\\\\\\\.claude\.json"),
     "${HOME}\\\\\\\\.claude.json"),
    (re.compile(r"C:\\\\Users\\\\" + re.escape(HARDCODED_USER) + r"\\\\\.claude\.json"),
     "${HOME}\\\\.claude.json"),
    (re.compile(r"C:/Users/" + re.escape(HARDCODED_USER) + r"/\.claude/"),
     "${HOME}/.claude/"),
    (re.compile(r"C:\\\\\\\\Users\\\\\\\\" + re.escape(HARDCODED_USER) + r"\\\\\\\\\.claude\\\\\\\\"),
     "${HOME}\\\\\\\\.claude\\\\\\\\"),
    (re.compile(r"C:\\\\Users\\\\" + re.escape(HARDCODED_USER) + r"\\\\\.claude\\\\"),
     "${HOME}\\\\.claude\\\\"),
]

# .ps1 — PowerShell. $env:USERPROFILE is idiomatic; backslashes preserved.
# Order matters: longer / more-specific patterns first so they win the match.
PS1_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    # .claude.json (the user MCP config dotfile) — must precede the bare
    # .claude rule below or it would consume "C:\Users\X\.claude" leaving
    # an orphan ".json".
    (re.compile(r"C:\\Users\\" + re.escape(HARDCODED_USER) + r"\\\.claude\.json"),
     "$env:USERPROFILE\\.claude.json"),
    (re.compile(r"C:/Users/" + re.escape(HARDCODED_USER) + r"/\.claude\.json"),
     "$env:USERPROFILE/.claude.json"),
    # .claude/ (with trailing separator) — dir-path uses
    (re.compile(r"C:\\Users\\" + re.escape(HARDCODED_USER) + r"\\\.claude\\"),
     "$env:USERPROFILE\\.claude\\"),
    (re.compile(r"C:/Users/" + re.escape(HARDCODED_USER) + r"/\.claude/"),
     "$env:USERPROFILE/.claude/"),
    # Bare .claude (no trailing separator) — typical when path is the
    # repo root or assigned to a variable. Must come AFTER the .json and
    # .claude/ rules to avoid stealing their matches.
    (re.compile(r'C:\\Users\\' + re.escape(HARDCODED_USER) + r'\\\.claude(?=["\s])'),
     "$env:USERPROFILE\\.claude"),
    (re.compile(r'C:/Users/' + re.escape(HARDCODED_USER) + r'/\.claude(?=["\s])'),
     "$env:USERPROFILE/.claude"),
]

# .sh / .bash — bash. $HOME with forward slashes. Git Bash on Windows
# canonicalises USERPROFILE through /c/Users/... — accept that form too.
SH_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"/c/Users/" + re.escape(HARDCODED_USER) + r"/\.claude/"),
     "$HOME/.claude/"),
    (re.compile(r"C:/Users/" + re.escape(HARDCODED_USER) + r"/\.claude/"),
     "$HOME/.claude/"),
]

# .js / .cjs / .mjs — flagged only. Path strings need `path.join(os.homedir(),
# ...)`, which can't be safely auto-rewritten without breaking call sites.
# Accepts any number of consecutive separators between segments to handle
# JS source escapes (`\\` for one literal backslash, etc.).
JS_FLAG_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"C:[/\\]+Users[/\\]+" + re.escape(HARDCODED_USER) + r"[/\\]+\.claude"
    ),
]

CATEGORY_MAP: dict[str, list[tuple[re.Pattern[str], str]]] = {
    "settings.json": JSON_REPLACEMENTS,
    ".mcp.json": MCP_JSON_REPLACEMENTS,
    "json-generic": JSON_REPLACEMENTS,
    "ps1": PS1_REPLACEMENTS,
    "sh": SH_REPLACEMENTS,
}


@dataclass
class FileResult:
    """Outcome for one scanned file."""
    path: pathlib.Path
    category: str
    matches: int = 0
    converted: int = 0
    flagged: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass
class RunSummary:
    """Aggregated outcome of a codemod run."""
    files: list[FileResult]
    apply: bool
    backup_dir: pathlib.Path | None

    @property
    def total_matches(self) -> int:
        return sum(f.matches for f in self.files)

    @property
    def total_converted(self) -> int:
        return sum(f.converted for f in self.files)

    @property
    def total_flagged(self) -> int:
        return sum(len(f.flagged) for f in self.files)

    @property
    def total_warnings(self) -> int:
        return sum(len(f.warnings) for f in self.files)

    @property
    def has_errors(self) -> bool:
        return any(f.error for f in self.files)

    @property
    def needs_action(self) -> bool:
        # Real errors (anything besides "gitignored") block. The gitignored
        # marker is informational — we deliberately skip those files.
        real_errors = any(
            f.error and f.error != "gitignored" for f in self.files
        )
        return (
            self.total_matches > 0
            or self.total_warnings > 0
            or real_errors
        )


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def load_config() -> dict[str, list[str]]:
    """Load file targets from the codemod config.

    Returns dict keyed by category name -> list of repo-relative paths.
    """
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Config not found: {CONFIG_PATH}. Create it with the file list "
            "from docs/resilience-and-sync.md §2.2 (G1)."
        )
    with CONFIG_PATH.open(encoding="utf-8") as fp:
        data = json.load(fp)
    if not isinstance(data, dict):
        raise ValueError(f"Config must be a JSON object, got {type(data).__name__}")
    targets = data.get("targets")
    if not isinstance(targets, dict):
        raise ValueError("Config missing 'targets' object")
    return targets


def is_gitignored(path: pathlib.Path) -> bool:
    """True if `path` is ignored by git. Best-effort; assumes git installed."""
    try:
        result = subprocess.run(
            ["git", "check-ignore", "-q", str(path)],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
        return result.returncode == 0
    except FileNotFoundError:
        # git not installed — fail open (don't skip).
        return False


# ---------------------------------------------------------------------------
# Per-category transforms
# ---------------------------------------------------------------------------

def apply_replacements(
    text: str,
    rules: list[tuple[re.Pattern[str], str]],
) -> tuple[str, int, int]:
    """Apply rules sequentially. Returns (new_text, matches, converted).

    matches: number of literal hardcoded paths found before substitution.
    converted: number actually replaced (idempotency: already-converted = 0).
    """
    matches = 0
    converted = 0
    new_text = text
    for pattern, replacement in rules:
        found = pattern.findall(new_text)
        matches += len(found)
        if found:
            # Lambda form bypasses re.sub's backslash interpretation in the
            # replacement string. Our replacements contain literal "\\" which
            # would otherwise be parsed as escape sequences.
            new_text = pattern.sub(lambda _m, r=replacement: r, new_text)
            converted += len(found)
    return new_text, matches, converted


def transform_file(
    path: pathlib.Path,
    category: str,
) -> tuple[str | None, FileResult]:
    """Transform one file. Returns (new_content_or_None, FileResult).

    new_content is None when the file is unchanged (or category is js-flag).
    """
    result = FileResult(path=path, category=category)
    if not path.exists():
        result.error = "missing"
        return None, result
    try:
        original = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as err:
        result.error = f"decode-error: {err}"
        return None, result

    if category == "js-flag":
        for pat in JS_FLAG_PATTERNS:
            for m in pat.finditer(original):
                line = original.count("\n", 0, m.start()) + 1
                result.flagged.append(f"line {line}: {m.group(0)!r}")
        # Flagged-only: no automatic conversion. Keep matches=0 so summary
        # statistics don't double-count flag and match for the same hit.
        return None, result

    rules = CATEGORY_MAP.get(category)
    if rules is None:
        result.error = f"unknown-category: {category}"
        return None, result

    new_text, matches, converted = apply_replacements(original, rules)
    result.matches = matches
    result.converted = converted

    # Static-analysis warnings — run on the post-transform text. These are
    # patterns the codemod can produce but that won't actually work at runtime.
    # Fix-up is manual; the warning blocks --check.
    if category == "ps1":
        result.warnings.extend(_ps1_warnings(new_text))

    if new_text != original:
        return new_text, result
    return None, result


# Single-quoted PS1 string containing "$env:USERPROFILE": single quotes do
# NOT expand variables in PowerShell, so the literal "$env:USERPROFILE"
# would be passed downstream — broken on every PC.
_PS1_SINGLE_QUOTED_ENV = re.compile(
    r"'[^'\n]*\$env:USERPROFILE[^'\n]*'"
)


def _ps1_warnings(text: str) -> list[str]:
    """Return one warning per problematic line in PS1 text."""
    out: list[str] = []
    for match in _PS1_SINGLE_QUOTED_ENV.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        snippet = match.group(0)
        # Truncate long matches in the warning message.
        if len(snippet) > 120:
            snippet = snippet[:60] + "..." + snippet[-40:]
        out.append(
            f"line {line}: single-quoted string contains $env:USERPROFILE — "
            f"PowerShell does not expand variables in single quotes. "
            f"Use double-quoted outer string with backtick-escaped inner "
            f"quotes. Snippet: {snippet}"
        )
    return out


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def iter_targets(
    targets: dict[str, list[str]],
    only: pathlib.Path | None,
) -> Iterable[tuple[pathlib.Path, str]]:
    """Yield (path, category) for each configured target.

    If `only` is given, yield just that one (auto-categorised by extension).
    """
    if only is not None:
        yield only, _categorise(only)
        return
    for category, paths in targets.items():
        for rel in paths:
            yield REPO_ROOT / rel, category


def _categorise(path: pathlib.Path) -> str:
    """Best-effort category for ad-hoc --target paths."""
    name = path.name
    if name in ("settings.json", "settings.local.json"):
        return "settings.json"
    if name == ".mcp.json":
        return ".mcp.json"
    suffix = path.suffix.lower()
    if suffix == ".ps1":
        return "ps1"
    if suffix in (".sh", ".bash"):
        return "sh"
    if suffix in (".js", ".cjs", ".mjs"):
        return "js-flag"
    if suffix == ".json":
        return "json-generic"
    return "json-generic"  # safe default — replacement rules tolerate misses


def run(
    apply: bool,
    only: pathlib.Path | None,
    allow_dirty: bool,
) -> RunSummary:
    """Top-level orchestration."""
    targets = load_config()

    backup_dir: pathlib.Path | None = None
    if apply:
        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_dir = BACKUP_ROOT / timestamp

    if apply and not allow_dirty:
        _assert_clean_targets(targets)

    files: list[FileResult] = []
    for path, category in iter_targets(targets, only):
        if is_gitignored(path):
            res = FileResult(path=path, category=category, error="gitignored")
            files.append(res)
            continue
        new_content, result = transform_file(path, category)
        files.append(result)
        if new_content is not None and apply:
            _backup_and_write(path, new_content, backup_dir)

    return RunSummary(files=files, apply=apply, backup_dir=backup_dir)


def _backup_and_write(
    path: pathlib.Path,
    new_content: str,
    backup_dir: pathlib.Path | None,
) -> None:
    """Atomic-rename write with backup."""
    if backup_dir is None:
        return
    backup_dir.mkdir(parents=True, exist_ok=True)
    rel = path.relative_to(REPO_ROOT)
    backup_path = backup_dir / rel
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup_path)
    tmp = path.with_suffix(path.suffix + ".codemod-tmp")
    tmp.write_text(new_content, encoding="utf-8")
    os.replace(tmp, path)


def _assert_clean_targets(targets: dict[str, list[str]]) -> None:
    """Refuse to apply if any target file has uncommitted changes."""
    paths = [
        str((REPO_ROOT / rel).relative_to(REPO_ROOT))
        for files in targets.values()
        for rel in files
    ]
    if not paths:
        return
    result = subprocess.run(
        ["git", "status", "--porcelain", "--", *paths],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    dirty = [
        line for line in result.stdout.splitlines() if line.strip()
    ]
    if dirty:
        msg = "Refusing to apply with dirty target files:\n  " + "\n  ".join(dirty)
        raise RuntimeError(msg + "\nCommit or stash first, or pass --allow-dirty.")


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def render_text(summary: RunSummary) -> str:
    lines: list[str] = []
    lines.append(
        f"portability-codemod: {summary.total_matches} matches across "
        f"{sum(1 for f in summary.files if f.matches)} files"
    )
    if summary.apply:
        lines.append(
            f"  applied {summary.total_converted} substitutions "
            f"(backup: {summary.backup_dir})"
        )
    if summary.total_flagged:
        lines.append(f"  flagged for manual review: {summary.total_flagged}")
    if summary.total_warnings:
        lines.append(f"  warnings: {summary.total_warnings}")
    for fr in summary.files:
        if fr.error:
            tag = "SKIP" if fr.error == "gitignored" else "ERROR"
            lines.append(f"  {tag}  {fr.path.relative_to(REPO_ROOT) if fr.path.is_relative_to(REPO_ROOT) else fr.path}  -> {fr.error}")
            continue
        if fr.matches == 0 and not fr.flagged and not fr.warnings:
            continue
        if fr.matches > 0:
            action = "would convert" if not summary.apply else "converted"
            lines.append(f"  {fr.matches:>3}× {action}  {fr.path.relative_to(REPO_ROOT)}")
        for flag in fr.flagged:
            lines.append(f"        flag: {flag}")
        for warn in fr.warnings:
            lines.append(f"        warn: {warn}")
    if not summary.needs_action:
        lines.append("  clean — no drift")
    return "\n".join(lines)


def render_json(summary: RunSummary) -> str:
    payload = {
        "apply": summary.apply,
        "backup_dir": str(summary.backup_dir) if summary.backup_dir else None,
        "total_matches": summary.total_matches,
        "total_converted": summary.total_converted,
        "total_flagged": summary.total_flagged,
        "total_warnings": summary.total_warnings,
        "needs_action": summary.needs_action,
        "files": [
            {
                "path": str(f.path.relative_to(REPO_ROOT))
                        if f.path.is_relative_to(REPO_ROOT) else str(f.path),
                "category": f.category,
                "matches": f.matches,
                "converted": f.converted,
                "flagged": f.flagged,
                "warnings": f.warnings,
                "error": f.error,
            }
            for f in summary.files
        ],
    }
    return json.dumps(payload, indent=2)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true",
                        help="Write changes (default: dry-run)")
    parser.add_argument("--check", action="store_true",
                        help="Dry-run, exit 1 on any drift (for hooks)")
    parser.add_argument("--target", type=pathlib.Path, default=None,
                        help="Single file (relative to repo root or absolute)")
    parser.add_argument("--allow-dirty", action="store_true",
                        help="Apply even if target files have uncommitted changes")
    parser.add_argument("--report", choices=("text", "json"), default="text",
                        help="Output format")
    args = parser.parse_args(argv)

    if args.apply and args.check:
        print("error: --apply and --check are mutually exclusive", file=sys.stderr)
        return 2

    only: pathlib.Path | None = None
    if args.target is not None:
        only = args.target if args.target.is_absolute() else REPO_ROOT / args.target
        only = only.resolve()
        if not str(only).startswith(str(REPO_ROOT)):
            print(f"error: --target outside repo root: {only}", file=sys.stderr)
            return 2

    try:
        summary = run(apply=args.apply, only=only, allow_dirty=args.allow_dirty)
    except (FileNotFoundError, ValueError, RuntimeError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 2

    output = render_json(summary) if args.report == "json" else render_text(summary)
    print(output)

    if args.apply:
        return 1 if summary.has_errors else 0
    if args.check:
        return 1 if summary.needs_action else 0
    # plain dry-run
    return 1 if summary.needs_action else 0


if __name__ == "__main__":
    sys.exit(main())
