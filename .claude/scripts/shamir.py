#!/usr/bin/env python
"""
Shamir's Secret Sharing over GF(2^8), byte-wise.

Splits an arbitrary-length secret into N shares; any K reconstruct it.
Single-file, stdlib-only — no external deps.

Encoding:
    Each share is encoded as "INDEX:BASE64URL(BYTES)" where BYTES is the
    same length as the secret (one GF(2^8) element per byte, all using the
    same x = INDEX). To verify integrity on reconstruction the secret is
    sandwiched between a 16-byte SHA-256-prefix marker (first 16 bytes of
    sha256(secret)) and the secret itself; on `combine`, the marker is
    re-derived and compared, raising on mismatch.

CLI:
    python shamir.py split   --threshold 3 --shares 5 --secret-stdin
    python shamir.py combine SHARE1 SHARE2 SHARE3
    python shamir.py demo    --threshold 3 --shares 5

Threat model:
    - Adversary with FEWER than K shares learns nothing (information-theoretic).
    - Adversary with K shares reconstructs the secret. Pick K >= 3 and store
      shares in geographically/administratively independent locations.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import secrets
import sys
from typing import Iterable

# --- GF(2^8) arithmetic with the AES Rijndael polynomial 0x11B -------------

_EXP = [0] * 256
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x ^= (_x << 1)
    if _x & 0x100:
        _x ^= 0x11B
_EXP[255] = _EXP[0]


def _gmul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[(_LOG[a] + _LOG[b]) % 255]


def _gdiv(a: int, b: int) -> int:
    if a == 0:
        return 0
    if b == 0:
        raise ZeroDivisionError("GF(2^8) divide by zero")
    return _EXP[(_LOG[a] - _LOG[b]) % 255]


# --- Polynomial helpers ----------------------------------------------------

def _eval_poly(coeffs: list[int], x: int) -> int:
    """Horner-eval poly with coeffs[0] = constant term, in GF(2^8)."""
    y = 0
    for c in reversed(coeffs):
        y = _gmul(y, x) ^ c
    return y


def _lagrange_at_zero(points: list[tuple[int, int]]) -> int:
    """Reconstruct secret = poly(0) from k points (x_i, y_i) in GF(2^8)."""
    secret = 0
    for j, (xj, yj) in enumerate(points):
        num, den = 1, 1
        for m, (xm, _) in enumerate(points):
            if m == j:
                continue
            num = _gmul(num, xm)            # 0 - xm == xm  in GF(2^8)
            den = _gmul(den, xj ^ xm)
        secret ^= _gmul(yj, _gdiv(num, den))
    return secret


# --- Splitting / combining -------------------------------------------------

_INTEGRITY_PREFIX = 16  # bytes of sha256(secret) prepended before splitting


def split(secret: bytes, threshold: int, shares: int) -> list[str]:
    if not (2 <= threshold <= shares <= 255):
        raise ValueError("require 2 <= threshold <= shares <= 255")
    if not secret:
        raise ValueError("secret must be non-empty")

    payload = hashlib.sha256(secret).digest()[:_INTEGRITY_PREFIX] + secret

    out: list[bytearray] = [bytearray() for _ in range(shares)]
    rng = secrets.SystemRandom()
    for byte in payload:
        coeffs = [byte] + [rng.randint(0, 255) for _ in range(threshold - 1)]
        for s in range(shares):
            x = s + 1  # x must be non-zero
            out[s].append(_eval_poly(coeffs, x))

    encoded: list[str] = []
    for s in range(shares):
        b64 = base64.urlsafe_b64encode(bytes(out[s])).decode("ascii").rstrip("=")
        encoded.append(f"{s + 1}:{b64}")
    return encoded


def _decode_share(share: str) -> tuple[int, bytes]:
    if ":" not in share:
        raise ValueError(f"share missing INDEX: prefix: {share[:32]}")
    idx_str, b64 = share.split(":", 1)
    idx = int(idx_str)
    if not (1 <= idx <= 255):
        raise ValueError(f"share index out of range: {idx}")
    pad = "=" * (-len(b64) % 4)
    raw = base64.urlsafe_b64decode(b64 + pad)
    return idx, raw


def combine(shares: Iterable[str]) -> bytes:
    decoded = [_decode_share(s.strip()) for s in shares if s.strip()]
    if len(decoded) < 2:
        raise ValueError("need at least 2 shares")
    lengths = {len(b) for _, b in decoded}
    if len(lengths) != 1:
        raise ValueError(f"shares have inconsistent lengths: {sorted(lengths)}")
    indexes = [i for i, _ in decoded]
    if len(set(indexes)) != len(indexes):
        raise ValueError("duplicate share indexes")

    n = lengths.pop()
    payload = bytearray(n)
    for byte_pos in range(n):
        points = [(idx, raw[byte_pos]) for idx, raw in decoded]
        payload[byte_pos] = _lagrange_at_zero(points)

    if n <= _INTEGRITY_PREFIX:
        raise ValueError("payload shorter than integrity prefix")
    prefix, secret = bytes(payload[:_INTEGRITY_PREFIX]), bytes(payload[_INTEGRITY_PREFIX:])
    if hashlib.sha256(secret).digest()[:_INTEGRITY_PREFIX] != prefix:
        raise ValueError(
            "integrity check failed — too few shares, wrong shares, or one is corrupted"
        )
    return secret


# --- CLI -------------------------------------------------------------------

def _read_secret(args: argparse.Namespace) -> bytes:
    if args.secret_stdin:
        data = sys.stdin.read()
        # Strip a single trailing newline only (preserve internal content).
        if data.endswith("\n"):
            data = data[:-1]
        return data.encode("utf-8")
    if args.secret is None:
        raise SystemExit("provide --secret or --secret-stdin")
    return args.secret.encode("utf-8")


def _cmd_split(args: argparse.Namespace) -> int:
    secret = _read_secret(args)
    pieces = split(secret, args.threshold, args.shares)
    print(f"# Shamir {args.threshold}-of-{args.shares} — store each line in a separate trustee:")
    for p in pieces:
        print(p)
    return 0


def _cmd_combine(args: argparse.Namespace) -> int:
    if args.share_stdin:
        shares = [ln for ln in sys.stdin.read().splitlines() if ln.strip() and not ln.startswith("#")]
    else:
        shares = list(args.shares)
    if not shares:
        raise SystemExit("provide shares as args or via --share-stdin")
    secret = combine(shares)
    sys.stdout.buffer.write(secret)
    return 0


def _cmd_demo(args: argparse.Namespace) -> int:
    s = "demo-secret-" + secrets.token_urlsafe(20)
    pieces = split(s.encode(), args.threshold, args.shares)
    print(f"secret:   {s}")
    print(f"shares:   {len(pieces)}, threshold: {args.threshold}")
    for p in pieces:
        print(f"  {p}")
    chosen = pieces[: args.threshold]
    rec = combine(chosen).decode()
    ok = (rec == s)
    print(f"reconstructed (with {args.threshold} shares): {rec}")
    print(f"match: {ok}")
    # Show that K-1 shares fail
    try:
        combine(pieces[: max(2, args.threshold - 1)])
        print("FAILED: K-1 shares should not reconstruct")
        return 1
    except ValueError as e:
        print(f"K-1 attempt blocked: {e}")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_split = sub.add_parser("split", help="Split a secret into N shares")
    p_split.add_argument("--threshold", "-k", type=int, required=True)
    p_split.add_argument("--shares", "-n", type=int, required=True)
    grp = p_split.add_mutually_exclusive_group()
    grp.add_argument("--secret", help="Secret as a CLI arg (visible in `ps`!)")
    grp.add_argument("--secret-stdin", action="store_true", help="Read secret from stdin")
    p_split.set_defaults(func=_cmd_split)

    p_comb = sub.add_parser("combine", help="Reconstruct secret from K shares")
    p_comb.add_argument("shares", nargs="*", help="Share strings (INDEX:base64)")
    p_comb.add_argument("--share-stdin", action="store_true", help="Read shares from stdin (one per line)")
    p_comb.set_defaults(func=_cmd_combine)

    p_demo = sub.add_parser("demo", help="Self-test split + combine")
    p_demo.add_argument("--threshold", "-k", type=int, default=3)
    p_demo.add_argument("--shares", "-n", type=int, default=5)
    p_demo.set_defaults(func=_cmd_demo)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
