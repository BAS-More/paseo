#!/usr/bin/env python3
"""claude-web-export.py — back up all claude.ai web chats to disk.

Uses the same internal API the browser uses.
Reads sessionKey cookie from vault (`claude-web/sessionKey`).
Output: .claude/claude-web-chats/<org_uuid>/<conv_uuid>.json

Scheduled run: hourly via Task Scheduler.
On sessionKey expiry (403/401), logs warning and exits 0 (non-fatal).
"""

from __future__ import annotations

import json
import os
import sys
import time
import hashlib
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

import requests

HOME = Path(os.path.expanduser("~"))
OUT_DIR = HOME / ".claude" / "claude-web-chats"
LOG_FILE = HOME / ".claude" / "_logs" / "claude-web-export.log"
STATE_FILE = HOME / ".claude" / "_claude-web-export-state.json"
VAULT = Path(r"C:\Dev\tools\vault\vault.py")

BASE_URL = "https://claude.ai/api"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
TIMEOUT = (10, 60)


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    line = f"[{ts}] {msg}\n"
    sys.stderr.write(line)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def get_session_key() -> str | None:
    """Fetch sessionKey from vault. Returns None if missing."""
    if not VAULT.exists():
        log(f"vault not found: {VAULT}")
        return None
    try:
        result = subprocess.run(
            [sys.executable, str(VAULT), "get", "claude-web", "sessionKey"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            log(f"vault get failed (code {result.returncode}): {result.stderr.strip()}")
            return None
        key = result.stdout.strip()
        if not key or not key.startswith("sk-ant-"):
            log(f"vault key looks invalid (first 10 chars: {key[:10]!r})")
            return None
        return key
    except Exception as e:
        log(f"vault read error: {e}")
        return None


def api_session(session_key: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "anthropic-client-sha": "unknown",
        "anthropic-client-version": "unknown",
    })
    s.cookies.set("sessionKey", session_key, domain=".claude.ai")
    return s


def get_orgs(s: requests.Session) -> list[dict[str, Any]]:
    r = s.get(f"{BASE_URL}/organizations", timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def list_conversations(s: requests.Session, org_uuid: str) -> list[dict[str, Any]]:
    r = s.get(f"{BASE_URL}/organizations/{org_uuid}/chat_conversations", timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def get_conversation(s: requests.Session, org_uuid: str, conv_uuid: str) -> dict[str, Any]:
    r = s.get(
        f"{BASE_URL}/organizations/{org_uuid}/chat_conversations/{conv_uuid}",
        params={"tree": "True", "rendering_mode": "raw"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def load_state() -> dict[str, str]:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(state: dict[str, str]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    key = get_session_key()
    if not key:
        log("No sessionKey in vault. Exiting.")
        log("To set: python C:/Dev/tools/vault/vault.py set claude-web sessionKey <value>")
        log("Grab the value from Chrome DevTools -> Application -> Cookies -> claude.ai -> sessionKey")
        return 0

    s = api_session(key)

    try:
        orgs = get_orgs(s)
    except requests.HTTPError as e:
        code = e.response.status_code if e.response else "?"
        log(f"orgs fetch failed (HTTP {code}). sessionKey may be expired — re-set in vault.")
        return 0
    except Exception as e:
        log(f"orgs fetch error: {e}")
        return 0

    state = load_state()
    total_saved = 0
    total_skipped = 0
    total_errors = 0

    for org in orgs:
        org_uuid = org.get("uuid")
        org_name = org.get("name", "unknown")
        if not org_uuid:
            continue
        org_dir = OUT_DIR / org_uuid
        org_dir.mkdir(parents=True, exist_ok=True)

        try:
            convs = list_conversations(s, org_uuid)
        except Exception as e:
            log(f"list convs failed for org {org_name}: {e}")
            total_errors += 1
            continue

        log(f"org {org_name} ({org_uuid}): {len(convs)} conversations")

        for conv in convs:
            conv_uuid = conv.get("uuid")
            if not conv_uuid:
                continue
            updated = conv.get("updated_at", "")
            cached = state.get(conv_uuid)
            if cached == updated:
                total_skipped += 1
                continue

            try:
                full = get_conversation(s, org_uuid, conv_uuid)
            except Exception as e:
                log(f"fetch {conv_uuid} failed: {e}")
                total_errors += 1
                continue

            out_path = org_dir / f"{conv_uuid}.json"
            out_path.write_text(json.dumps(full, indent=2, ensure_ascii=False), encoding="utf-8")
            state[conv_uuid] = updated
            total_saved += 1
            # polite pause
            time.sleep(0.3)

    save_state(state)
    log(f"done — saved={total_saved} skipped={total_skipped} errors={total_errors}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
