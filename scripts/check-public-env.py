#!/usr/bin/env python3
"""Fail when a secret-looking variable is configured for renderer exposure."""

from __future__ import annotations

import re
import os
import sys
from pathlib import Path

FORBIDDEN = re.compile(r"^VITE_.*(?:SECRET|SERVICE_ROLE|PASSWORD|PRIVATE)", re.IGNORECASE)
ENV_FILES = (Path(".env"), Path(".env.local"), Path(".env.production"), Path(".env.production.local"))


def inspect_environment(
    paths: tuple[Path, ...] = ENV_FILES,
    environment: dict[str, str] | os._Environ[str] = os.environ,
) -> tuple[list[str], list[str]]:
    violations = [f"environment:{key}" for key in environment if FORBIDDEN.match(key)]
    configured = {key for key, value in environment.items() if value.strip()}
    for path in paths:
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = (part.strip() for part in line.split("=", 1))
            if FORBIDDEN.match(key):
                violations.append(f"{path}:{key}")
            if value.strip('"').strip("'"):
                configured.add(key)
    # Generic release builds intentionally contain no project configuration.
    # The optional VITE values remain available only for local development and
    # private legacy builds; production users connect a store at runtime.
    return sorted(set(violations)), []


def main() -> int:
    violations, missing = inspect_environment()
    if violations:
        print("Renderer-secret environment variables are forbidden:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
