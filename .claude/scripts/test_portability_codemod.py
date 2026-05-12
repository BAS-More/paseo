#!/usr/bin/env python3
"""Smoke tests for portability-codemod.

Run:
    python scripts/test_portability_codemod.py

Stdlib unittest only — no pytest dependency.

Coverage focus: each replacement category and idempotency. Not exhaustive;
treat as a regression net while the codemod evolves.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

# Load codemod module by path (filename has hyphens, not import-friendly).
_HERE = pathlib.Path(__file__).resolve().parent
_SPEC = importlib.util.spec_from_file_location(
    "portability_codemod", _HERE / "portability-codemod.py"
)
assert _SPEC and _SPEC.loader
codemod = importlib.util.module_from_spec(_SPEC)
# Register before exec so dataclasses can resolve `sys.modules[cls.__module__]`.
sys.modules["portability_codemod"] = codemod
_SPEC.loader.exec_module(codemod)


class JsonReplacementTests(unittest.TestCase):
    """JSON_REPLACEMENTS handles forward-slash, single-escape, double-escape."""

    def test_forward_slash_dir(self) -> None:
        text = 'node "C:/Users/Avi Bendetsky/.claude/hooks/foo.js"'
        new, m, c = codemod.apply_replacements(text, codemod.JSON_REPLACEMENTS)
        self.assertEqual(new, 'node "$HOME/.claude/hooks/foo.js"')
        self.assertEqual((m, c), (1, 1))

    def test_single_escape_backslash(self) -> None:
        # File text: C:\\Users\\Avi Bendetsky\\.claude\\scripts\\x.bat
        text = r'"GIT_ASKPASS": "C:\\Users\\Avi Bendetsky\\.claude\\scripts\\x.bat"'
        new, m, c = codemod.apply_replacements(text, codemod.JSON_REPLACEMENTS)
        self.assertEqual(new, r'"GIT_ASKPASS": "$HOME\\.claude\\scripts\\x.bat"')
        self.assertEqual((m, c), (1, 1))

    def test_double_escape_inner_quoted(self) -> None:
        # File text: \\\\Users\\\\Avi Bendetsky\\\\.claude\\\\hooks\\\\x.js
        text = r'"command": "node \"C:\\\\Users\\\\Avi Bendetsky\\\\.claude\\\\hooks\\\\x.js\""'
        new, m, c = codemod.apply_replacements(text, codemod.JSON_REPLACEMENTS)
        self.assertEqual(
            new,
            r'"command": "node \"$HOME\\\\.claude\\\\hooks\\\\x.js\""',
        )
        self.assertEqual((m, c), (1, 1))

    def test_dotfile_form(self) -> None:
        text = '"copyTo": "C:/Users/Avi Bendetsky/.claude.json"'
        new, m, c = codemod.apply_replacements(text, codemod.JSON_REPLACEMENTS)
        self.assertEqual(new, '"copyTo": "$HOME/.claude.json"')
        self.assertEqual((m, c), (1, 1))

    def test_idempotent(self) -> None:
        already = 'node "$HOME/.claude/hooks/foo.js"'
        new, m, c = codemod.apply_replacements(already, codemod.JSON_REPLACEMENTS)
        self.assertEqual(new, already)
        self.assertEqual((m, c), (0, 0))


class PowerShellReplacementTests(unittest.TestCase):
    """PS1_REPLACEMENTS handles dir, dotfile, and bare forms."""

    def test_dir_with_trailing_slash(self) -> None:
        text = r'$repoDir = "C:\Users\Avi Bendetsky\.claude\scripts\"'
        new, m, c = codemod.apply_replacements(text, codemod.PS1_REPLACEMENTS)
        self.assertEqual(new, r'$repoDir = "$env:USERPROFILE\.claude\scripts\"')
        self.assertEqual((m, c), (1, 1))

    def test_bare_dir_at_string_end(self) -> None:
        # Common in: $repoDir = "C:\Users\X\.claude"
        text = r'$repoDir = "C:\Users\Avi Bendetsky\.claude"'
        new, m, c = codemod.apply_replacements(text, codemod.PS1_REPLACEMENTS)
        self.assertEqual(new, r'$repoDir = "$env:USERPROFILE\.claude"')
        self.assertEqual((m, c), (1, 1))

    def test_dotfile_form(self) -> None:
        text = r'Copy-Item "C:\Users\Avi Bendetsky\.claude.json" $dest'
        new, m, c = codemod.apply_replacements(text, codemod.PS1_REPLACEMENTS)
        self.assertEqual(new, r'Copy-Item "$env:USERPROFILE\.claude.json" $dest')
        self.assertEqual((m, c), (1, 1))

    def test_dotfile_does_not_eat_dir_match(self) -> None:
        """Order check: bare-.claude rule must not steal .claude.json text."""
        text = (
            r'A = "C:\Users\Avi Bendetsky\.claude.json"' "\n"
            r'B = "C:\Users\Avi Bendetsky\.claude\hooks\x.js"'
        )
        new, m, c = codemod.apply_replacements(text, codemod.PS1_REPLACEMENTS)
        self.assertIn(r'$env:USERPROFILE\.claude.json', new)
        self.assertIn(r'$env:USERPROFILE\.claude\hooks\x.js', new)
        self.assertNotIn("Avi Bendetsky", new)
        self.assertEqual((m, c), (2, 2))

    def test_idempotent(self) -> None:
        already = r'$repoDir = "$env:USERPROFILE\.claude"'
        new, m, c = codemod.apply_replacements(already, codemod.PS1_REPLACEMENTS)
        self.assertEqual(new, already)
        self.assertEqual((m, c), (0, 0))


class Ps1WarningTests(unittest.TestCase):
    """Static-analysis warnings for PS1 patterns that won't expand at runtime."""

    def test_warns_on_single_quoted_env(self) -> None:
        text = (
            "Some-Cmd -Arg '-NoProfile -File \"$env:USERPROFILE\\.claude\\x.ps1\"'"
        )
        warnings = codemod._ps1_warnings(text)
        self.assertEqual(len(warnings), 1)
        self.assertIn("$env:USERPROFILE", warnings[0])
        self.assertIn("PowerShell does not expand", warnings[0])

    def test_no_warn_on_double_quoted_env(self) -> None:
        text = (
            'Some-Cmd -Arg "-NoProfile -File `"$env:USERPROFILE\\.claude\\x.ps1`""'
        )
        self.assertEqual(codemod._ps1_warnings(text), [])

    def test_no_warn_on_single_quoted_without_env(self) -> None:
        text = "$plain = 'just a literal string'"
        self.assertEqual(codemod._ps1_warnings(text), [])

    def test_warns_only_within_single_quotes(self) -> None:
        # Multiple quote contexts — only the bad one warns.
        text = (
            'Cmd1 "-File `"$env:USERPROFILE\\x`""\n'
            "Cmd2 '-File \"$env:USERPROFILE\\y\"'\n"
            'Cmd3 "$env:USERPROFILE\\z"'
        )
        warnings = codemod._ps1_warnings(text)
        self.assertEqual(len(warnings), 1)
        self.assertIn("line 2", warnings[0])


class JsFlagTests(unittest.TestCase):
    """JS files are flagged for manual review, not auto-rewritten."""

    def test_flag_finds_path(self) -> None:
        for pat in codemod.JS_FLAG_PATTERNS:
            self.assertEqual(
                len(pat.findall(r'const ROOT = "C:\\Users\\Avi Bendetsky\\.claude";')),
                1,
            )

    def test_flag_finds_forward_slash(self) -> None:
        for pat in codemod.JS_FLAG_PATTERNS:
            self.assertEqual(
                len(pat.findall('const ROOT = "C:/Users/Avi Bendetsky/.claude";')),
                1,
            )


class CategoriserTests(unittest.TestCase):
    def test_settings_json(self) -> None:
        self.assertEqual(
            codemod._categorise(pathlib.Path("settings.json")),
            "settings.json",
        )

    def test_settings_local(self) -> None:
        self.assertEqual(
            codemod._categorise(pathlib.Path("settings.local.json")),
            "settings.json",
        )

    def test_ps1(self) -> None:
        self.assertEqual(
            codemod._categorise(pathlib.Path("scripts/foo.ps1")),
            "ps1",
        )

    def test_js_flag(self) -> None:
        self.assertEqual(
            codemod._categorise(pathlib.Path("hooks/foo.js")),
            "js-flag",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
