#!/usr/bin/env python3
"""Fail when a secret-looking variable is configured for renderer exposure."""

from __future__ import annotations

import re
import sys
from pathlib import Path

FORBIDDEN = re.compile(r"^VITE_.*(?:SECRET|SERVICE_ROLE|PASSWORD|PRIVATE)", re.IGNORECASE)


def main() -> int:
    violations: list[str] = []
    for path in [Path(".env"), Path(".env.local"), Path(".env.production"), Path(".env.production.local")]:
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key = line.split("=", 1)[0].strip()
            if FORBIDDEN.match(key):
                violations.append(f"{path}:{key}")
    if violations:
        print("Renderer-secret environment variables are forbidden:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
