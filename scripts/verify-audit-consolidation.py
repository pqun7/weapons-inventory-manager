#!/usr/bin/env python3
"""Verify business audit batch consolidation without persisting test data."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    args = parser.parse_args()
    load_dotenv(args.env_file)
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is required")

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select count(*) from information_schema.columns "
                "where table_schema = 'public' and table_name = 'audit_logs' "
                "and column_name in ('event_key', 'details', 'item_count', 'importance', 'is_visible')"
            )
            if cursor.fetchone()[0] != 5:
                raise AssertionError("Business audit columns are incomplete")
            cursor.execute("select pg_get_functiondef('public.bulk_intake_weapons(jsonb)'::regprocedure)")
            if "write_business_audit_event" not in cursor.fetchone()[0]:
                raise AssertionError("bulk_intake_weapons is not using consolidated business audit logging")
            cursor.execute(
                "select count(*) from public.audit_logs where is_visible "
                "and (description ilike '%autosave%' or description = 'Manifest items updated during review')"
            )
            if cursor.fetchone()[0] != 0:
                raise AssertionError("Noisy background events are still visible")

            cursor.execute(
                "select auth_user_id from public.users "
                "where is_active and auth_user_id is not null "
                "order by case when role = 'Admin' then 0 else 1 end limit 1"
            )
            actor_row = cursor.fetchone()
            if not actor_row:
                raise RuntimeError("No active authenticated application user was found")
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(actor_row[0]),))

            call_args = (
                "Intake",
                "codex-test:batch-consolidation",
                "Shipment",
                "TEST-SHIP",
                "Test shipment",
                Jsonb({"messageKey": "audit.business.inventoryIntake"}),
                Jsonb({"items": [{"serialNumber": "T-1"}]}),
                2,
                3,
            )
            for _ in range(2):
                cursor.execute(
                    "select public.write_business_audit_event(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    call_args,
                )
            cursor.execute(
                "select count(*), max(item_count), "
                "jsonb_array_length((max(details::text)::jsonb)->'items') "
                "from public.audit_logs where event_key = %s",
                ("codex-test:batch-consolidation",),
            )
            result = cursor.fetchone()
            expected = (1, 4, 2)
            if result != expected:
                raise AssertionError(f"Expected {expected}, received {result}")
            print(
                "audit schema, noise filter, and batch consolidation verified: "
                f"rows={result[0]}, item_count={result[1]}, detail_items={result[2]}"
            )
        connection.rollback()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
