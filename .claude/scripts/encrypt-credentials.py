#!/usr/bin/env python3
"""
encrypt-credentials.py — back up ~/.claude/.credentials.json as an AES-GCM
encrypted blob to OneDrive, using the vault's sync passphrase as the key.

Runs idempotently — overwrites target on each call. Called by
backup-claude-to-onedrive.ps1 each hour.

Usage:  python encrypt-credentials.py
Exit 0 on success, 1 on failure (missing file, no passphrase, etc.).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import keyring
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
except ImportError as e:
    print(f"ERROR: missing dependency — {e}", file=sys.stderr)
    sys.exit(1)

# Same envelope format as vault_backup.py for consistency (magic, scrypt, GCM)
MAGIC       = b"VLT1"
SCRYPT_N    = 2 ** 15
SCRYPT_R    = 8
SCRYPT_P    = 1
KEY_LEN     = 32
SALT_LEN    = 16
NONCE_LEN   = 12


def derive_key(passphrase: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=KEY_LEN,
                  n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P).derive(passphrase.encode("utf-8"))


def main() -> int:
    src = Path(os.environ["USERPROFILE"]) / ".claude" / ".credentials.json"
    dst = Path(os.environ["USERPROFILE"]) / "OneDrive - BAS & More" / "ClaudeVault" / "credentials.enc"

    if not src.exists():
        print(f"INFO: {src} missing — nothing to encrypt")
        return 0

    pp = keyring.get_password("claude-vault._meta", "sync_passphrase")
    if not pp:
        print("ERROR: vault sync passphrase not in keyring — skipping", file=sys.stderr)
        return 1

    # Wrap payload with metadata for recovery
    payload = {
        "schema": 1,
        "source_path": str(src),
        "content": src.read_text(encoding="utf-8"),
    }
    plaintext = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    salt = os.urandom(SALT_LEN)
    nonce = os.urandom(NONCE_LEN)
    key = derive_key(pp, salt)
    ct = AESGCM(key).encrypt(nonce, plaintext, None)
    blob = MAGIC + salt + nonce + ct

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(blob)
    print(f"OK: {src.name} -> {dst} ({len(blob)} bytes encrypted)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
