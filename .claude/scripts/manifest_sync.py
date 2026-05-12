#!/usr/bin/env python3
"""
manifest_sync — shared library for MCP manifest generation + drift detection.

Single source of truth used by:
  - .githooks/pre-commit (regen on commit)
  - .githooks/pre-push   (abort on drift)
  - scripts/mcp-manifest-drift-check.ps1 (weekly + SessionStart)
  - scripts/regenerate-mcp-manifest.ps1  (manual)

CLI:
    python manifest_sync.py regen                # rebuild manifest from .claude.json
    python manifest_sync.py drift                # exit 1 if drift detected, 0 if ok
    python manifest_sync.py diff                 # show diff (for humans)

Exit codes:
    0 — success / no drift
    1 — drift detected or regeneration failed
    2 — input error (missing file, malformed JSON)

Safety:
    - Validates JSON before touching anything; malformed .claude.json → exit 2,
      no partial writes.
    - Atomic write to manifest (write to temp, rename) — no mid-edit corruption.
    - Redacts secrets by name pattern (TOKEN/KEY/SECRET/PASSWORD/PAT/AUTH) —
      never ships real credential values to the manifest.
    - File locking via fcntl/msvcrt to avoid races with concurrent edits.
"""

from __future__ import annotations

import contextlib
import datetime
import json
import os
import pathlib
import sys
import tempfile
import time
from typing import Any

# Cross-platform exclusive file lock to guard against concurrent edits of
# .claude.json while we read it. On Windows we use msvcrt; on POSIX fcntl.
try:
    import msvcrt  # type: ignore[import]
    _HAVE_MSVCRT = True
except ImportError:
    _HAVE_MSVCRT = False
    import fcntl  # type: ignore[import]


@contextlib.contextmanager
def _shared_lock(path: pathlib.Path, timeout: float = 5.0):
    """Open path read-only with an advisory shared lock. Prevents reading a
    file that's mid-write. Retries up to `timeout` seconds before failing."""
    f = open(path, "rb")
    try:
        deadline = time.monotonic() + timeout
        while True:
            try:
                if _HAVE_MSVCRT:
                    msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    fcntl.flock(f.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
                break
            except (OSError, BlockingIOError):
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"could not acquire lock on {path} within {timeout}s")
                time.sleep(0.1)
        try:
            yield f
        finally:
            try:
                if _HAVE_MSVCRT:
                    msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            except Exception:
                pass
    finally:
        f.close()


SECRET_TOKENS = ("TOKEN", "KEY", "SECRET", "PASSWORD", "PAT", "AUTH")


def _home() -> pathlib.Path:
    return pathlib.Path.home()


def _paths() -> tuple[pathlib.Path, pathlib.Path]:
    return (_home() / ".claude.json",
            _home() / ".claude" / "mcp-manifest.json")


def _load_json_safe(p: pathlib.Path) -> dict[str, Any]:
    """Read + parse JSON with a shared advisory lock so we never observe a
    half-written file. Retries on malformed JSON once after 150ms — Claude
    Code's config writer is non-atomic and may briefly show invalid JSON."""
    if not p.exists():
        raise FileNotFoundError(str(p))
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            with _shared_lock(p) as f:
                text = f.read().decode("utf-8")
            return json.loads(text)
        except json.JSONDecodeError as exc:
            last_err = exc
            if attempt == 0:
                time.sleep(0.15)
                continue
            raise ValueError(f"malformed JSON in {p}: {exc}") from exc
    raise ValueError(f"malformed JSON in {p}: {last_err}")


def _redact_env(name: str, env: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in env.items():
        upper = k.upper()
        if isinstance(v, str) and any(tok in upper for tok in SECRET_TOKENS):
            out[k] = f"VAULT:{name}/{k.lower()}"
        else:
            out[k] = v
    return out


def _portabilize(value: Any, user_home: str | None = None, app_data: str | None = None) -> Any:
    """Recursively replace hardcoded user-home / appdata paths with portable
    Windows-cmd-expandable env vars (%USERPROFILE%, %APPDATA%). Idempotent.
    Operates on str, list, dict; returns other types unchanged."""
    if user_home is None:
        user_home = os.environ.get("USERPROFILE") or str(pathlib.Path.home())
    if app_data is None:
        app_data = os.environ.get("APPDATA") or str(pathlib.Path(user_home) / "AppData" / "Roaming")

    if isinstance(value, str):
        out = value
        # Order: APPDATA first (more specific — typically inside USERPROFILE), then USERPROFILE.
        # Match both forward-slash and back-slash forms; case-insensitive on Windows.
        for src, token in ((app_data, "%APPDATA%"), (user_home, "%USERPROFILE%")):
            for variant in (src, src.replace("\\", "/")):
                if variant and variant.lower() in out.lower():
                    # Manual case-insensitive replace preserving the suffix.
                    idx = out.lower().find(variant.lower())
                    while idx != -1:
                        out = out[:idx] + token + out[idx + len(variant):]
                        idx = out.lower().find(variant.lower(), idx + len(token))
        return out
    if isinstance(value, list):
        return [_portabilize(v, user_home, app_data) for v in value]
    if isinstance(value, dict):
        return {k: _portabilize(v, user_home, app_data) for k, v in value.items()}
    return value


def build_manifest(live: dict[str, Any]) -> dict[str, Any]:
    mcp = live.get("mcpServers") or {}
    servers: dict[str, Any] = {}
    for name in sorted(mcp.keys()):
        cfg = dict(mcp[name])
        env = cfg.pop("env", None) or {}
        if env:
            cfg["env"] = _redact_env(name, env)
        # Portabilize all path-bearing fields (command, args, env values).
        cfg = _portabilize(cfg)
        servers[name] = cfg
    return {
        "_comment": "Source of truth for MCP server config. Auto-generated by manifest_sync.py. Secrets resolved via vault at bootstrap.",
        "generated_at": datetime.date.today().isoformat(),
        "mcp_count": len(servers),
        "servers": servers,
    }


def _atomic_write_json(path: pathlib.Path, data: dict[str, Any]) -> None:
    fd, tmp = tempfile.mkstemp(
        prefix=path.name + ".",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with open(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        pathlib.Path(tmp).replace(path)
    except Exception:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


def regen() -> int:
    src, dst = _paths()
    try:
        live = _load_json_safe(src)
    except FileNotFoundError as exc:
        print(f"manifest_sync regen: missing {exc}", file=sys.stderr)
        return 2
    except ValueError as exc:
        print(f"manifest_sync regen: {exc}", file=sys.stderr)
        return 2

    data = build_manifest(live)
    _atomic_write_json(dst, data)
    print(f"manifest_sync: wrote {dst} with {data['mcp_count']} MCPs")
    return 0


def _keys(live: dict[str, Any]) -> set[str]:
    return set((live.get("mcpServers") or {}).keys())


def _manifest_keys(m: dict[str, Any]) -> set[str]:
    return set((m.get("servers") or {}).keys())


def drift() -> int:
    src, dst = _paths()
    try:
        live = _load_json_safe(src)
    except FileNotFoundError as exc:
        print(f"manifest_sync drift: missing {exc}", file=sys.stderr)
        return 2
    except ValueError as exc:
        print(f"manifest_sync drift: {exc}", file=sys.stderr)
        return 2
    if not dst.exists():
        print("manifest_sync drift: manifest missing — run regen")
        return 1
    try:
        manifest = _load_json_safe(dst)
    except ValueError as exc:
        print(f"manifest_sync drift: {exc}", file=sys.stderr)
        return 2

    live_keys = _keys(live)
    man_keys = _manifest_keys(manifest)

    if live_keys == man_keys:
        print(f"OK: {len(live_keys)} MCPs in sync")
        return 0

    missing_from_live = man_keys - live_keys
    missing_from_manifest = live_keys - man_keys
    print(
        f"DRIFT: live={len(live_keys)} manifest={len(man_keys)} "
        f"missing_from_live={sorted(missing_from_live) or []} "
        f"missing_from_manifest={sorted(missing_from_manifest) or []}"
    )
    return 1


def diff() -> int:
    src, dst = _paths()
    if not src.exists() or not dst.exists():
        print("manifest_sync diff: one or both inputs missing", file=sys.stderr)
        return 2
    live = _load_json_safe(src)
    manifest = _load_json_safe(dst)
    regenerated = build_manifest(live)

    def _normalized(d: dict[str, Any]) -> str:
        return json.dumps(d.get("servers", {}), indent=2, sort_keys=True)

    import difflib
    a = _normalized(manifest).splitlines()
    b = _normalized(regenerated).splitlines()
    delta = list(difflib.unified_diff(a, b, fromfile="manifest", tofile="live", lineterm=""))
    if not delta:
        print("no diff")
        return 0
    print("\n".join(delta))
    return 1


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: manifest_sync.py [regen|drift|diff]", file=sys.stderr)
        return 2
    cmd = argv[1]
    if cmd == "regen":
        return regen()
    if cmd == "drift":
        return drift()
    if cmd == "diff":
        return diff()
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
