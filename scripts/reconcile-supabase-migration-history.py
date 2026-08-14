#!/usr/bin/env python3
"""Record verified legacy baseline migrations without replaying obsolete SQL.

This command is deliberately limited to migrations that are known to have been
installed before the repository started recording checksums.  It refuses to
record a version unless required schema objects and a later applied migration
prove that the database has progressed beyond that baseline.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import psycopg

from db_common import connection_kwargs, load_dotenv


INITIAL_BASELINE_VERSIONS = tuple(f"2026081100{number:02d}00" for number in range(1, 16))
SUPERSEDED_BASELINE_VERSIONS = INITIAL_BASELINE_VERSIONS + ("20260812002200",)

SUCCESSOR_BY_VERSION = {
    **{version: "20260812000100" for version in INITIAL_BASELINE_VERSIONS},
    "20260812002200": "20260812002300",
}

REQUIRED_RELATIONS = (
    "public.users",
    "public.customers",
    "public.shipments",
    "public.weapons",
    "public.invoices",
    "public.shipment_imports",
    "public.shipment_import_items",
    "public.business_id_counters",
)

REQUIRED_ROUTINES = (
    "public.current_app_user_id()",
    "public.bulk_intake_weapons(jsonb)",
    "public.create_shipment(jsonb)",
    "public.validate_manifest_import(text)",
    "public.update_scheduled_shipment(text,jsonb)",
    "public.update_manifest_items(text,jsonb,jsonb)",
    "public.update_manifest_details(text,jsonb)",
)


def migration_record(path: Path) -> tuple[str, str]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return path.stem.split("_", 1)[0], f"{path.name}:{digest}"


def verify_schema(cursor: psycopg.Cursor[tuple[object, ...]]) -> None:
    missing: list[str] = []
    for relation in REQUIRED_RELATIONS:
        cursor.execute("select to_regclass(%s)", (relation,))
        if cursor.fetchone()[0] is None:
            missing.append(relation)
    for routine in REQUIRED_ROUTINES:
        cursor.execute("select to_regprocedure(%s)", (routine,))
        if cursor.fetchone()[0] is None:
            missing.append(routine)
    if missing:
        raise RuntimeError("Cannot reconcile an incomplete schema: " + ", ".join(missing))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--migrations", type=Path, default=Path("supabase/migrations"))
    parser.add_argument("--confirm", action="store_true", help="Commit verified baseline records")
    args = parser.parse_args()
    load_dotenv(args.env_file)

    local_files = {path.stem.split("_", 1)[0]: path for path in args.migrations.glob("*.sql")}
    missing_files = [version for version in SUPERSEDED_BASELINE_VERSIONS if version not in local_files]
    if missing_files:
        raise RuntimeError("Missing local baseline migrations: " + ", ".join(missing_files))

    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select pg_advisory_xact_lock(hashtext('armory-store-migration-reconciliation'))")
            cursor.execute("select to_regclass('supabase_migrations.schema_migrations')")
            if cursor.fetchone()[0] is None:
                raise RuntimeError("Supabase migration history table does not exist")

            verify_schema(cursor)
            cursor.execute("select version from supabase_migrations.schema_migrations")
            applied = {str(row[0]) for row in cursor.fetchall()}
            pending = [version for version in SUPERSEDED_BASELINE_VERSIONS if version not in applied]
            for version in pending:
                successor = SUCCESSOR_BY_VERSION[version]
                if successor not in applied:
                    raise RuntimeError(
                        f"Cannot baseline {version}: required successor {successor} is not applied"
                    )

            print(f"Verified schema objects: {len(REQUIRED_RELATIONS) + len(REQUIRED_ROUTINES)}")
            print(f"Legacy baseline records pending: {len(pending)}")
            for version in pending:
                print(f"  {version} (superseded by {SUCCESSOR_BY_VERSION[version]})")

            if not args.confirm:
                connection.rollback()
                print("Preview only. Re-run with --confirm to record these baseline versions.")
                return 0

            for version in pending:
                path = local_files[version]
                record_version, name = migration_record(path)
                cursor.execute(
                    "insert into supabase_migrations.schema_migrations (version, statements, name) "
                    "values (%s, %s, %s)",
                    (
                        record_version,
                        [f"baseline-reconciled; superseded-by={SUCCESSOR_BY_VERSION[version]}"],
                        name,
                    ),
                )
        connection.commit()

    print(f"Recorded {len(pending)} verified legacy baseline migrations.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Migration reconciliation failed: {exc}")
        raise SystemExit(1)
