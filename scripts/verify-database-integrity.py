#!/usr/bin/env python3
"""Read-only production database integrity and migration verification."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
from psycopg import sql


ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path) -> None:
    for raw in path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []:
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def scalar(cursor: psycopg.Cursor, statement: str, parameters: tuple[object, ...] = ()) -> int:
    cursor.execute(statement, parameters)
    row = cursor.fetchone()
    return int(row[0]) if row else 0


def main() -> int:
    load_env(ROOT / ".env")
    load_env(ROOT / ".env.local")
    database_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is required")

    failures: list[str] = []
    warnings: list[str] = []
    checks = 0

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("set transaction read only")

            local_versions = {
                path.name.split("_", 1)[0]
                for path in (ROOT / "supabase" / "migrations").glob("*.sql")
            }
            cursor.execute("select version::text from supabase_migrations.schema_migrations")
            applied_versions = {str(row[0]) for row in cursor.fetchall()}
            missing = sorted(local_versions - applied_versions)
            unknown = sorted(applied_versions - local_versions)
            checks += 1
            if missing:
                failures.append(f"unapplied local migrations: {', '.join(missing)}")
            if unknown:
                warnings.append(f"database has migrations absent locally: {', '.join(unknown)}")

            cursor.execute("""
                select c.relname
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r', 'p')
                  and not exists (
                    select 1 from pg_constraint k
                    where k.conrelid = c.oid and k.contype = 'p'
                  )
                order by c.relname
            """)
            missing_primary_keys = [str(row[0]) for row in cursor.fetchall()]
            checks += 1
            if missing_primary_keys:
                failures.append(f"tables without primary keys: {', '.join(missing_primary_keys)}")

            cursor.execute("""
                select c.relname
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r', 'p')
                  and not c.relrowsecurity
                order by c.relname
            """)
            rls_disabled = [str(row[0]) for row in cursor.fetchall()]
            checks += 1
            if rls_disabled:
                failures.append(f"public tables without RLS: {', '.join(rls_disabled)}")

            cursor.execute("""
                select n.nspname, c.relname, k.conname,
                       rn.nspname, rc.relname,
                       array_agg(a.attname order by keys.ordinality),
                       array_agg(ra.attname order by keys.ordinality)
                from pg_constraint k
                join pg_class c on c.oid = k.conrelid
                join pg_namespace n on n.oid = c.relnamespace
                join pg_class rc on rc.oid = k.confrelid
                join pg_namespace rn on rn.oid = rc.relnamespace
                cross join lateral unnest(k.conkey, k.confkey)
                  with ordinality as keys(child_num, parent_num, ordinality)
                join pg_attribute a on a.attrelid = c.oid and a.attnum = keys.child_num
                join pg_attribute ra on ra.attrelid = rc.oid and ra.attnum = keys.parent_num
                where k.contype = 'f' and n.nspname = 'public'
                group by n.nspname, c.relname, k.conname, rn.nspname, rc.relname
                order by c.relname, k.conname
            """)
            foreign_keys = cursor.fetchall()
            for child_schema, child_table, constraint, parent_schema, parent_table, child_columns, parent_columns in foreign_keys:
                joins = [
                    sql.SQL("child.{} = parent.{}").format(sql.Identifier(child), sql.Identifier(parent))
                    for child, parent in zip(child_columns, parent_columns, strict=True)
                ]
                populated = [
                    sql.SQL("child.{} is not null").format(sql.Identifier(child))
                    for child in child_columns
                ]
                statement = sql.SQL("""
                    select count(*)
                    from {}.{} child
                    left join {}.{} parent on {}
                    where {} and parent.{} is null
                """).format(
                    sql.Identifier(child_schema), sql.Identifier(child_table),
                    sql.Identifier(parent_schema), sql.Identifier(parent_table),
                    sql.SQL(" and ").join(joins),
                    sql.SQL(" and ").join(populated),
                    sql.Identifier(parent_columns[0]),
                )
                cursor.execute(statement)
                orphan_count = int(cursor.fetchone()[0])
                checks += 1
                if orphan_count:
                    failures.append(f"{constraint} has {orphan_count} orphan rows")

            cursor.execute("""
                select n.nspname || '.' || c.relname || '.' || k.conname
                from pg_constraint k
                join pg_class c on c.oid = k.conrelid
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and not k.convalidated
                order by 1
            """)
            invalid_constraints = [str(row[0]) for row in cursor.fetchall()]
            checks += 1
            if invalid_constraints:
                failures.append(f"unvalidated constraints: {', '.join(invalid_constraints)}")

            cursor.execute("""
                select n.nspname || '.' || c.relname
                from pg_index i
                join pg_class c on c.oid = i.indexrelid
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and (not i.indisvalid or not i.indisready)
                order by 1
            """)
            invalid_indexes = [str(row[0]) for row in cursor.fetchall()]
            checks += 1
            if invalid_indexes:
                failures.append(f"invalid indexes: {', '.join(invalid_indexes)}")

            cursor.execute("""
                select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosecdef
                  and not exists (
                    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
                    where setting like 'search_path=%'
                  )
                order by 1
            """)
            unsafe_functions = [str(row[0]) for row in cursor.fetchall()]
            checks += 1
            if unsafe_functions:
                failures.append(f"SECURITY DEFINER functions without fixed search_path: {', '.join(unsafe_functions)}")

            duplicate_queries = {
                "weapon serial numbers": """
                    select count(*) from (
                      select upper(regexp_replace(trim(serial_number), '\\s+', '', 'g'))
                      from public.weapons where nullif(trim(serial_number), '') is not null
                      group by 1 having count(*) > 1
                    ) duplicate_groups
                """,
                "shipment numbers": """
                    select count(*) from (
                      select lower(trim(shipment_number)) from public.shipments
                      where nullif(trim(shipment_number), '') is not null
                      group by 1 having count(*) > 1
                    ) duplicate_groups
                """,
                "invoice numbers": """
                    select count(*) from (
                      select lower(trim(invoice_number)) from public.invoices
                      where nullif(trim(invoice_number), '') is not null
                      group by 1 having count(*) > 1
                    ) duplicate_groups
                """,
            }
            for label, statement in duplicate_queries.items():
                duplicate_count = scalar(cursor, statement)
                checks += 1
                if duplicate_count:
                    failures.append(f"duplicate {label}: {duplicate_count} groups")

            master_counts = {
                table: scalar(cursor, sql.SQL("select count(*) from public.{}").format(sql.Identifier(table)).as_string(connection))
                for table in ("currencies", "suppliers", "customers", "weapon_types", "models", "storage_locations")
            }
            checks += len(master_counts)
            empty_master = [table for table, count in master_counts.items() if count == 0]
            if empty_master:
                warnings.append(f"empty workflow prerequisites: {', '.join(empty_master)}")

            cursor.execute("""
                select count(*) from public.currencies
                where is_active and (last_known_rate is null or last_known_rate <= 0)
            """)
            invalid_currency_rates = int(cursor.fetchone()[0])
            checks += 1
            if invalid_currency_rates:
                failures.append(f"active currencies with invalid rates: {invalid_currency_rates}")

        connection.rollback()

    print(f"Database integrity checks completed: {checks}")
    print(f"Local migrations: {len(local_versions)}; applied migrations: {len(applied_versions)}")
    print(f"Foreign keys checked for orphan rows: {len(foreign_keys)}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    for failure in failures:
        print(f"FAIL: {failure}")
    if failures:
        return 1
    print("PASS: schema, migration, RLS, constraint, index, and relationship integrity checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
