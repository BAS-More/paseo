"""The Docker image and documented development setup must use the same direct pins."""
from pathlib import Path
import re


def read_pins(name: str) -> dict[str, str]:
    lines = Path(__file__).with_name(name).read_text().splitlines()
    pins = {}
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([\w.-]+)(?:\[[\w,.-]+\])?==([^\s;]+)", line.strip())
        assert match is not None, f"Expected an exact dependency pin in {name}: {line}"
        pins[match.group(1).lower().replace("_", "-")] = match.group(2)
    return pins


def test_docker_lock_preserves_every_direct_dependency_pin():
    direct = read_pins("requirements.txt")
    locked = read_pins("requirements.lock")
    assert direct
    assert {name: locked.get(name) for name in direct} == direct
