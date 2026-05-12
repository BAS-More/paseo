#!/usr/bin/env python
"""
Tamper-evident append-only audit log.

Each line is a JSON record with:
    {
        "i":         entry index (0 = genesis),
        "ts":        ISO-8601 UTC timestamp,
        "category":  short string (e.g. "backup", "rotation", "incident"),
        "event":     short string (e.g. "r2_upload_ok"),
        "data":      arbitrary JSON dict,
        "prev_hash": hex sha256 of previous entry's "hash" (or 64-zero genesis),
        "hash":      hex sha256 of (prev_hash + canonical-payload).
    }

A single mutation anywhere in the file breaks all subsequent hashes. `verify`
walks the file and returns the first index that fails to chain back to its
predecessor, or None if the chain is intact.

Library + CLI:
    from audit_chain import append, verify
    append("backup", "r2_upload_ok", bytes=176261696, sha=...)
    ok, broken = verify()

    python audit_chain.py log backup r2_upload_ok bytes=176261696
    python audit_chain.py verify
    python audit_chain.py tail 10

The log lives at ~/.claude/_logs/audit-chain.jsonl by default; override with
the AUDIT_CHAIN_LOG env var.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import pathlib
import sys
from typing import Any

GENESIS_PREV = "0" * 64
DEFAULT_LOG = pathlib.Path.home() / ".claude" / "_logs" / "audit-chain.jsonl"


def _log_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("AUDIT_CHAIN_LOG") or DEFAULT_LOG)


def _canonical(rec: dict[str, Any]) -> bytes:
    """Deterministic serialisation for hashing — sort keys, no whitespace."""
    return json.dumps(rec, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _read_last() -> tuple[int, str]:
    """Return (next_index, last_hash). Empty file -> (0, GENESIS_PREV)."""
    p = _log_path()
    if not p.exists() or p.stat().st_size == 0:
        return 0, GENESIS_PREV
    last_hash = GENESIS_PREV
    last_index = -1
    with p.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                # Don't crash on a corrupted line — verify() will surface it
                continue
            last_index = int(rec.get("i", last_index + 1))
            last_hash = rec.get("hash", last_hash)
    return last_index + 1, last_hash


def append(category: str, event: str, **data: Any) -> dict[str, Any]:
    """Append one record. Returns the written entry (incl. computed hash)."""
    p = _log_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    next_i, prev_hash = _read_last()

    payload = {
        "i":        next_i,
        "ts":       _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "category": category,
        "event":    event,
        "data":     data,
        "prev_hash": prev_hash,
    }
    h = hashlib.sha256(prev_hash.encode("ascii") + _canonical(payload)).hexdigest()
    payload["hash"] = h

    # Atomic-ish append: open for append + flush + fsync.
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n")
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass
    return payload


def verify(path: pathlib.Path | None = None) -> tuple[bool, int | None, str]:
    """
    Walk the log, recomputing each hash. Return (ok, broken_index, message).

    broken_index is the 0-based file-line index of the first failure (None if ok).
    """
    p = path or _log_path()
    if not p.exists() or p.stat().st_size == 0:
        return True, None, "log empty"
    expected_prev = GENESIS_PREV
    expected_i = 0
    with p.open("r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f):
            line = raw.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as e:
                return False, line_no, f"line {line_no}: invalid JSON: {e}"
            if rec.get("i") != expected_i:
                return False, line_no, f"line {line_no}: expected i={expected_i} got {rec.get('i')}"
            if rec.get("prev_hash") != expected_prev:
                return False, line_no, (
                    f"line {line_no}: prev_hash mismatch "
                    f"(expected {expected_prev[:12]}.., got {str(rec.get('prev_hash'))[:12]}..)"
                )
            stored_hash = rec.get("hash")
            payload = {k: v for k, v in rec.items() if k != "hash"}
            recomputed = hashlib.sha256(expected_prev.encode("ascii") + _canonical(payload)).hexdigest()
            if recomputed != stored_hash:
                return False, line_no, (
                    f"line {line_no}: hash mismatch "
                    f"(stored {str(stored_hash)[:12]}.., recomputed {recomputed[:12]}..)"
                )
            expected_prev = stored_hash
            expected_i += 1
    return True, None, f"chain intact ({expected_i} entries)"


def _cmd_log(args: argparse.Namespace) -> int:
    data: dict[str, Any] = {}
    for f in args.field or []:
        if "=" not in f:
            print(f"ignoring malformed field {f!r} (use key=value)", file=sys.stderr)
            continue
        k, v = f.split("=", 1)
        # Try to coerce numbers; fall back to string.
        try:
            data[k] = int(v)
        except ValueError:
            try:
                data[k] = float(v)
            except ValueError:
                data[k] = v
    rec = append(args.category, args.event, **data)
    print(json.dumps({"i": rec["i"], "hash": rec["hash"]}))
    return 0


def _cmd_verify(args: argparse.Namespace) -> int:
    p = pathlib.Path(args.path) if args.path else None
    ok, broken, msg = verify(p)
    print(msg)
    return 0 if ok else 1


def _cmd_tail(args: argparse.Namespace) -> int:
    p = _log_path()
    if not p.exists():
        return 0
    lines = p.read_text(encoding="utf-8").splitlines()
    for line in lines[-args.n:]:
        print(line)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_log = sub.add_parser("log", help="Append an entry")
    p_log.add_argument("category")
    p_log.add_argument("event")
    p_log.add_argument("--field", "-f", action="append", help="key=value (repeatable)")
    p_log.set_defaults(func=_cmd_log)

    p_ver = sub.add_parser("verify", help="Walk the chain, report first break")
    p_ver.add_argument("--path", help="Override log path (default: AUDIT_CHAIN_LOG or ~/.claude/_logs/audit-chain.jsonl)")
    p_ver.set_defaults(func=_cmd_verify)

    p_tail = sub.add_parser("tail", help="Print last N entries")
    p_tail.add_argument("n", type=int, nargs="?", default=10)
    p_tail.set_defaults(func=_cmd_tail)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
