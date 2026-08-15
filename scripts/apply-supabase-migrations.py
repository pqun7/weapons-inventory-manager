#!/usr/bin/env python3
"""Apply local Supabase SQL migrations through a direct PostgreSQL connection."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import psycopg
except ImportError as error:
    raise SystemExit("Install migration requirements: python -m pip install -r scripts/requirements-migration.txt") from error


REAPPLY_SAFE_MIGRATION_VERSIONS = {"20260813000700", "20260815000200"}


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def migration_body(sql: str) -> str:
    without_begin = re.sub(r"^\s*begin\s*;", "", sql, count=1, flags=re.IGNORECASE)
    return re.sub(r"commit\s*;\s*$", "", without_begin, count=1, flags=re.IGNORECASE)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--migrations", type=Path, default=Path("supabase/migrations"))
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="VERSION_OR_FILENAME",
        help="Apply only the specified migration version or filename. May be repeated.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Execute selected pending migrations in one transaction, then roll everything back.",
    )
    args = parser.parse_args()
    load_dotenv(args.env_file)
    database_url = os.environ.get("SUPABASE_DB_URL")
    if database_url:
        connection_kwargs: dict[str, object] = {"conninfo": database_url}
    else:
        supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
        password = os.environ.get("DATABASE_PASSWORD") or os.environ.get("SUPABASE_DB_PASSWORD")
        if not supabase_url or not password:
            raise RuntimeError("Set SUPABASE_DB_URL, or set SUPABASE_URL and DATABASE_PASSWORD")
        project_ref = urlparse(supabase_url).hostname
        if not project_ref or not project_ref.endswith(".supabase.co"):
            raise RuntimeError("SUPABASE_URL is invalid")
        project_ref = project_ref.removesuffix(".supabase.co")
        connection_kwargs = {
            "host": f"db.{project_ref}.supabase.co", "port": 5432, "dbname": "postgres",
            "user": "postgres", "password": password, "sslmode": "require",
        }

    files = sorted(args.migrations.glob("*.sql"))
    if args.only:
        requested = set(args.only)
        files = [
            path for path in files
            if path.name in requested or path.stem in requested or path.stem.split("_", 1)[0] in requested
        ]
        missing = requested - {
            value
            for path in files
            for value in (path.name, path.stem, path.stem.split("_", 1)[0])
            if value in requested
        }
        if missing:
            raise RuntimeError(f"Requested migrations were not found: {', '.join(sorted(missing))}")
    if not files:
        raise RuntimeError(f"No SQL migrations found in {args.migrations}")
    with psycopg.connect(**connection_kwargs) as connection:
        with connection.cursor() as cursor:
            cursor.execute("CREATE SCHEMA IF NOT EXISTS supabase_migrations")
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations ("
                "version text PRIMARY KEY, statements text[] NOT NULL DEFAULT '{}', name text)"
            )
        if not args.dry_run:
            connection.commit()
        for path in files:
            version = path.stem.split("_", 1)[0]
            sql = path.read_text(encoding="utf-8")
            digest = hashlib.sha256(sql.encode("utf-8")).hexdigest()
            with connection.cursor() as cursor:
                cursor.execute("SELECT name FROM supabase_migrations.schema_migrations WHERE version = %s", (version,))
                existing = cursor.fetchone()
                if existing:
                    expected_name = f"{path.name}:{digest}"
                    if existing[0] != expected_name:
                        if version not in REAPPLY_SAFE_MIGRATION_VERSIONS:
                            raise RuntimeError(f"Applied migration checksum changed: {path.name}")
                        cursor.execute(migration_body(sql))
                        cursor.execute(
                            "update supabase_migrations.schema_migrations set name = %s where version = %s",
                            (expected_name, version),
                        )
                        if not args.dry_run:
                            connection.commit()
                        print(f"{'validated repair for' if args.dry_run else 'repaired'} {path.name}")
                        continue
                    print(f"skip {path.name}")
                    continue
                try:
                    cursor.execute(migration_body(sql))
                    cursor.execute(
                        "INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES (%s, %s, %s)",
                        (version, [], f"{path.name}:{digest}"),
                    )
                    if not args.dry_run:
                        connection.commit()
                    print(f"{'validated' if args.dry_run else 'applied'} {path.name}")
                except Exception:
                    connection.rollback()
                    raise
        if args.dry_run:
            connection.rollback()
            print("Dry run complete; all migration changes were rolled back.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Migration apply failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
