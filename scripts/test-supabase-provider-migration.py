#!/usr/bin/env python3
"""Exercise the Supabase provider-migration RPCs inside a rolled-back transaction."""

from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from db_common import connection_kwargs, load_dotenv


ROOT = Path(__file__).resolve().parents[1]


def sqlite_like(value: Any) -> Any:
    """Convert PostgreSQL values to the representation produced by SQLite export."""
    if isinstance(value, bool):
        return 1 if value else 0
    if value is None or isinstance(value, (str, int, float)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "\\x" + bytes(value).hex()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def main() -> None:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select auth_user_id::text, id from public.users "
                "where is_primary_admin and is_active"
            )
            owners = cursor.fetchall()
            if len(owners) != 1 or not owners[0][0]:
                raise RuntimeError("Exactly one authenticated primary administrator is required")
            auth_user_id, original_primary_id = str(owners[0][0]), str(owners[0][1])
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (auth_user_id,))
            cursor.execute("select public.provider_migration_tables()")
            tables = list(cursor.fetchone()[0])

            manifest: dict[str, int] = {}
            table_rows: dict[str, list[dict[str, Any]]] = {}
            for table in tables:
                cursor.execute(sql.SQL("select * from public.{} order by 1").format(sql.Identifier(table)))
                columns = [column.name for column in cursor.description]
                rows = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
                portable_rows = [
                    {key: sqlite_like(item) for key, item in row.items()}
                    for row in rows
                ]
                manifest[table] = len(portable_rows)
                table_rows[table] = portable_rows

            migrated_employee_id = "U-PROVIDER-MIGRATION-EMPLOYEE"
            migrated_employee = dict(table_rows["users"][0])
            migrated_employee.update({
                "id": migrated_employee_id,
                "auth_user_id": None,
                "username": "provider.migration.employee",
                "email": None,
                "login_email": None,
                "name": "Provider Migration Employee",
                "role": "Employee",
                "permissions": "{}",
                "password_set": 0,
                "is_active": 1,
                "is_primary_admin": 0,
                "activation_token_hash": None,
                "activation_expires_at": None,
            })
            table_rows["users"].append(migrated_employee)
            manifest["users"] = len(table_rows["users"])

            cursor.execute(
                "select public.begin_provider_migration(%s, %s, %s, %s)",
                ("sqlite", "12", "0" * 64, Jsonb(manifest)),
            )
            migration_id = cursor.fetchone()[0]
            for table, rows in table_rows.items():
                for chunk_index, offset in enumerate(range(0, len(rows), 250)):
                    cursor.execute(
                        "select public.append_provider_migration_chunk(%s, %s, %s, %s)",
                        (migration_id, table, chunk_index, Jsonb(rows[offset:offset + 250])),
                    )

            cursor.execute("select public.apply_provider_migration(%s)", (migration_id,))
            apply_result = cursor.fetchone()[0]
            if not isinstance(apply_result, dict) or not apply_result.get("safetyBackupId"):
                raise RuntimeError("Provider migration apply returned no safety backup")
            if apply_result.get("sourcePrimaryUserId") != original_primary_id:
                raise RuntimeError("Provider migration did not preserve the source primary identity")
            cursor.execute(
                "select auth_user_id, login_email, password_set from public.users where id = %s",
                (migrated_employee_id,),
            )
            migrated_account = cursor.fetchone()
            if (
                migrated_account is None
                or migrated_account[0] is not None
                or not str(migrated_account[1]).endswith("@local.weapon-store.invalid")
                or migrated_account[2]
            ):
                raise RuntimeError("Migrated employee activation state is invalid")

            for table, expected in manifest.items():
                cursor.execute(sql.SQL("select count(*) from public.{}").format(sql.Identifier(table)))
                if cursor.fetchone()[0] != expected + (1 if table == "audit_logs" else 0):
                    raise RuntimeError(f"Provider migration count mismatch for {table}")

            cursor.execute("select public.begin_provider_migration_export()")
            export_start = cursor.fetchone()[0]
            if not isinstance(export_start, dict) or not export_start.get("backupId"):
                raise RuntimeError("Provider export returned invalid metadata")
            export_manifest = export_start.get("manifest")
            if not isinstance(export_manifest, dict) or "users" not in export_manifest:
                raise RuntimeError("Provider export manifest is invalid")
            exported_rows = 0
            for table, expected_value in export_manifest.items():
                expected = int(expected_value)
                received = 0
                while received < expected:
                    cursor.execute(
                        "select public.read_provider_migration_export(%s, %s, %s, %s)",
                        (export_start["backupId"], table, received, min(500, expected - received)),
                    )
                    page = cursor.fetchone()[0]
                    if not isinstance(page, list) or not page:
                        raise RuntimeError(f"Provider export ended early for {table}")
                    received += len(page)
                if received != expected:
                    raise RuntimeError(f"Provider export count mismatch for {table}")
                exported_rows += received

        connection.rollback()

    print(
        "Supabase provider migration contract passed in a rolled-back transaction: "
        f"{len(tables)} tables staged, normalized, backed up, restored, verified, and exported; "
        f"{sum(manifest.values())} imported source rows and {exported_rows} exported rows checked."
    )


if __name__ == "__main__":
    main()
