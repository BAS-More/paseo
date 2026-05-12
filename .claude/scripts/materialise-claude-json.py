#!/usr/bin/env python3
"""
materialise-claude-json — rebuild ~/.claude.json from mcp-manifest.json.

Reads the source-controlled manifest, resolves VAULT:<svc>/<key> sentinels
against the local vault, and writes (or merges into) ~/.claude.json.

Usage:
    python materialise-claude-json.py --manifest PATH --out PATH [--merge]

With --merge (default), preserves top-level keys in the existing target file
(theme, model, projects, etc.) and only replaces the mcpServers block.

Without --merge, writes a minimal file with only mcpServers set.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Default vault location — Avi's canonical layout is C:/Dev/tools/vault/.
# On PCs with a different layout, override via the CLAUDE_VAULT_CLI env var
# (set in scripts/onboard-machine.ps1 during Phase 8 onboarding).
VAULT_CLI = os.environ.get("CLAUDE_VAULT_CLI", r"C:\Dev\tools\vault\vault.py")


def resolve_vault(sentinel: str) -> str:
    """VAULT:<svc>/<key> -> actual value via vault CLI."""
    assert sentinel.startswith("VAULT:"), sentinel
    svc_key = sentinel[len("VAULT:"):]
    svc, _, key = svc_key.partition("/")
    if not svc or not key:
        raise ValueError(f"Bad sentinel: {sentinel}")
    res = subprocess.run(
        ["python", VAULT_CLI, "get", svc, key],
        capture_output=True, text=True, check=False,
    )
    if res.returncode != 0:
        raise RuntimeError(f"vault get {svc}/{key} failed: {res.stderr.strip()}")
    return res.stdout.strip()


def resolve_servers(servers: dict) -> dict:
    out = {}
    for name, cfg in servers.items():
        cfg = dict(cfg)
        env = cfg.get("env") or {}
        if env:
            resolved_env = {}
            for k, v in env.items():
                if isinstance(v, str) and v.startswith("VAULT:"):
                    try:
                        resolved_env[k] = resolve_vault(v)
                    except Exception as exc:
                        print(f"WARN: {name}.{k}: {exc}", file=sys.stderr)
                        resolved_env[k] = ""
                else:
                    resolved_env[k] = v
            cfg["env"] = resolved_env
        out[name] = cfg
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--no-merge", action="store_true",
                    help="Write a minimal file, overwriting any existing target.")
    args = ap.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    servers = resolve_servers(manifest.get("servers", {}))

    if args.no_merge or not args.out.exists():
        target = {"mcpServers": servers}
    else:
        target = json.loads(args.out.read_text(encoding="utf-8"))
        target["mcpServers"] = servers

    # Phase 6a: atomic write via temp file + os.replace. A mid-write crash
    # leaves either the old file (if rename hadn't happened) or the new
    # file (if rename completed). Never half-written.
    tmp = args.out.with_suffix(args.out.suffix + ".codemod-tmp")
    try:
        tmp.write_text(
            json.dumps(target, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(tmp, args.out)
    except Exception:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        raise
    print(f"wrote {args.out} with {len(servers)} MCPs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
