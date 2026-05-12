#!/usr/bin/env python
"""
Upload encrypted backup bundle to Cloudflare R2.

Reads from vault: r2/access-key-id, r2/secret-access-key, r2/endpoint, r2/bucket.
Picks newest claude-resilience-*.tar.enc in D:\\ThirdBackup unless --archive given.
Verifies upload via HeadObject.
Pings healthchecks.io on success/failure.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import os
import pathlib
import subprocess
import sys
from typing import Optional


VAULT_CLI = r"C:\Dev\tools\vault\vault.py"
# Search order for the encrypted bundle: env override, then D:, then C:.
# D: is preferred (separate physical device) but absent on machines without
# a second drive — fall back to C:\ThirdBackup so the upload still runs.
_ARCHIVE_CANDIDATES = [
    pathlib.Path(p) for p in [
        os.environ.get("THIRDBACKUP_DIR"),
        r"D:\ThirdBackup",
        r"C:\ThirdBackup",
    ] if p
]
LOG_DIR = pathlib.Path.home() / ".claude" / "_logs"
HEALTHCHECK_PS1 = pathlib.Path.home() / ".claude" / "scripts" / "healthcheck-ping.ps1"


def _vault(key: str) -> str:
    r = subprocess.run(
        ["python", VAULT_CLI, "get", "r2", key],
        capture_output=True, text=True, check=False,
    )
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError(f"vault r2/{key} missing")
    return r.stdout.strip()


def _log(msg: str, log_path: pathlib.Path) -> None:
    line = f"[{_dt.datetime.now():%H:%M:%S}] {msg}"
    print(line)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def _ping(endpoint: str = "", body: str = "") -> None:
    if not HEALTHCHECK_PS1.exists():
        return
    args = ["pwsh", "-NoProfile", "-File", str(HEALTHCHECK_PS1)]
    if endpoint:
        args += ["-Endpoint", endpoint]
    if body:
        args += ["-Body", body[:9000]]
    subprocess.run(args, capture_output=True, check=False)


def _sha256(path: pathlib.Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for blk in iter(lambda: f.read(chunk), b""):
            h.update(blk)
    return h.hexdigest()


def _pick_archive() -> pathlib.Path:
    for d in _ARCHIVE_CANDIDATES:
        if not d.exists():
            continue
        candidates = sorted(
            d.glob("claude-resilience-*.tar.enc"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if candidates:
            return candidates[0]
    tried = ", ".join(str(p) for p in _ARCHIVE_CANDIDATES)
    raise RuntimeError(f"No claude-resilience-*.tar.enc in any of: {tried} — run backup-to-third-provider.ps1 first")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", help="Specific archive to upload (default: newest in D:\\ThirdBackup)")
    args = parser.parse_args()

    log_path = LOG_DIR / f"r2-upload-{_dt.date.today():%Y-%m-%d}.log"

    try:
        archive = pathlib.Path(args.archive) if args.archive else _pick_archive()
        if not archive.exists():
            raise RuntimeError(f"Missing: {archive}")

        size = archive.stat().st_size
        sha = _sha256(archive)
        _log(f"Uploading {archive.name} ({size/1_048_576:.2f} MB, sha256={sha[:12]}...)", log_path)

        # boto3 import deferred so missing-deps message is clean
        try:
            import boto3
        except ImportError:
            raise RuntimeError("boto3 not installed. Run: pip install boto3")

        s3 = boto3.client(
            "s3",
            aws_access_key_id=_vault("access-key-id"),
            aws_secret_access_key=_vault("secret-access-key"),
            endpoint_url=_vault("endpoint"),
            region_name="auto",
        )
        bucket = _vault("bucket")

        s3.upload_file(
            str(archive),
            bucket,
            archive.name,
            ExtraArgs={
                "Metadata": {"sha256": sha, "uploaded": _dt.datetime.now(_dt.timezone.utc).isoformat()},
                "ContentType": "application/octet-stream",
            },
        )

        head = s3.head_object(Bucket=bucket, Key=archive.name)
        if head["ContentLength"] != size:
            raise RuntimeError(f"Size mismatch: local={size} remote={head['ContentLength']}")

        _log(f"Uploaded: r2://{bucket}/{archive.name} (etag={head['ETag']})", log_path)
        _ping(body=f"r2 upload {archive.name} ok ({size} bytes)")
        return 0

    except Exception as e:
        _log(f"FAIL: {e}", log_path)
        _ping(endpoint="fail", body=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
