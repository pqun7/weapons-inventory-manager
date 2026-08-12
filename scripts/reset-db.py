#!/usr/bin/env python3
"""Reset every Armory Store record and Auth identity to a first-run baseline.

The command is preview-only by default. Pass --confirm to execute the reset.
Schema migrations are preserved. Four system currencies and one default settings
row are recreated because the application requires them during first startup.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

try:
    import psycopg
    from psycopg import sql
except ImportError as error:
    raise SystemExit("Install requirements: python -m pip install -r scripts/requirements-migration.txt") from error

from db_common import connection_kwargs, create_auth_user, delete_auth_user, load_dotenv


BASELINE_TABLE_COUNTS = {"currencies": 4, "system_settings": 1}
BASELINE_CURRENCIES = (
    ("USD", "US Dollar", "$", 2, 1),
    ("SAR", "Saudi Riyal", "SAR", 2, 3.75),
    ("SDG", "Sudanese Pound", "SDG", 2, 1),
    ("EGP", "Egyptian Pound", "EGP", 2, 1),
)


def application_tables(cursor: psycopg.Cursor[tuple[object, ...]]) -> list[str]:
    """Return public base tables, excluding tables owned by PostgreSQL extensions."""
    cursor.execute("""
        select c.relname
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and not exists (
            select 1 from pg_catalog.pg_depend d
            where d.classid = 'pg_class'::regclass
              and d.objid = c.oid
              and d.deptype = 'e'
          )
        order by c.relname
    """)
    return [str(row[0]) for row in cursor.fetchall()]


def table_counts(cursor: psycopg.Cursor[tuple[object, ...]], tables: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in tables:
        cursor.execute(sql.SQL("select count(*) from public.{}").format(sql.Identifier(table)))
        row = cursor.fetchone()
        counts[table] = int(row[0]) if row else 0
    return counts


def print_counts(title: str, counts: dict[str, int]) -> None:
    print(title)
    for table, count in counts.items():
        if count:
            print(f"  {table}: {count}")
    if not any(counts.values()):
        print("  (empty)")


def verify_first_user_trigger(cursor: psycopg.Cursor[tuple[object, ...]]) -> None:
    cursor.execute("""
        select exists (
          select 1 from pg_catalog.pg_trigger
          where tgrelid = 'public.users'::regclass
            and tgname = 'users_assign_first_primary_admin'
            and not tgisinternal
        )
    """)
    row = cursor.fetchone()
    if not row or row[0] is not True:
        raise RuntimeError(
            "First-admin protection is not installed. Run `npm run supabase:schema:apply` before resetting."
        )


def insert_baseline(cursor: psycopg.Cursor[tuple[object, ...]]) -> None:
    cursor.executemany(
        """
        insert into public.currencies
          (iso_code, name, symbol, decimal_precision, is_active, last_known_rate, last_rate_updated_at)
        values (%s, %s, %s, %s, true, %s, now())
        """,
        BASELINE_CURRENCIES,
    )
    cursor.execute("""
        insert into public.system_settings (
          id, currency_symbol, currency_code, accounting_currency_code,
          rate_base_currency_code, supported_currencies, show_demo_data
        ) values (1, '$', 'USD', 'USD', 'USD', '["USD", "SAR", "SDG", "EGP"]'::jsonb, false)
    """)
    # Baseline creation is maintenance, not business activity.
    cursor.execute("delete from public.audit_logs")


def reset_database(cursor: psycopg.Cursor[tuple[object, ...]], tables: list[str]) -> None:
    if not tables:
        raise RuntimeError("No Armory Store tables were found in the public schema")
    statement = sql.SQL("truncate table {} restart identity").format(
        sql.SQL(", ").join(sql.Identifier("public", table) for table in tables)
    )
    cursor.execute(statement)
    cursor.execute("delete from auth.users")
    insert_baseline(cursor)


def verify_reset(cursor: psycopg.Cursor[tuple[object, ...]], tables: list[str]) -> dict[str, int]:
    counts = table_counts(cursor, tables)
    unexpected = {
        table: count
        for table, count in counts.items()
        if count != BASELINE_TABLE_COUNTS.get(table, 0)
    }
    cursor.execute("select count(*) from auth.users")
    auth_row = cursor.fetchone()
    auth_count = int(auth_row[0]) if auth_row else -1
    if unexpected or auth_count != 0:
        raise RuntimeError(f"Reset verification failed: unexpected={unexpected}, auth_users={auth_count}")
    return counts


def validate_admin_credentials(email: str, password: str) -> None:
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise RuntimeError("RESET_ADMIN_EMAIL must be a valid email address")
    if len(password) < 8 or not re.search(r"[a-z]", password) or not re.search(r"[A-Z]", password) or not re.search(r"\d", password):
        raise RuntimeError("RESET_ADMIN_PASSWORD must contain 8+ characters, upper-case, lower-case, and a number")


def create_primary_admin(name: str, email: str, password: str) -> None:
    auth_user_id = create_auth_user(email, password, name)
    try:
        with psycopg.connect(**connection_kwargs()) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select pg_advisory_xact_lock(hashtext('armory-store-first-primary-admin'))")
                cursor.execute("""
                    insert into public.users (
                      id, auth_user_id, username, name, role, permissions, password_set,
                      is_active, email, login_email, is_primary_admin
                    ) values (
                      'USR-PRIMARY-ADMIN', %s, %s, %s, 'Employee', '{}'::jsonb,
                      true, true, %s, %s, false
                    )
                """, (auth_user_id, email, name, email, email))
                cursor.execute("""
                    select role::text, is_primary_admin, is_active
                    from public.users where auth_user_id = %s
                """, (auth_user_id,))
                if cursor.fetchone() != ("Admin", True, True):
                    raise RuntimeError("The first-user trigger did not create a primary Admin")
            connection.commit()
    except Exception:
        try:
            delete_auth_user(auth_user_id)
        except Exception as cleanup_error:
            print(f"Warning: failed to remove the partially created Auth user: {cleanup_error}", file=sys.stderr)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--admin-name", default=None, help="Optional first administrator display name")
    parser.add_argument("--admin-email", default=None, help="Optional first administrator email")
    parser.add_argument("--admin-password", default=None, help="Optional first administrator password")
    parser.add_argument("--confirm", action="store_true", help="Execute and commit the destructive reset")
    args = parser.parse_args()
    load_dotenv(args.env_file)
    admin_name = (args.admin_name or os.environ.get("RESET_ADMIN_NAME") or "Primary Admin").strip()
    admin_email = (args.admin_email or os.environ.get("RESET_ADMIN_EMAIL") or "").strip().lower()
    admin_password = args.admin_password or os.environ.get("RESET_ADMIN_PASSWORD") or ""
    if admin_email or admin_password:
        validate_admin_credentials(admin_email, admin_password)

    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select pg_advisory_xact_lock(hashtext('armory-store-full-reset'))")
            verify_first_user_trigger(cursor)
            tables = application_tables(cursor)
            before = table_counts(cursor, tables)
            cursor.execute("select count(*) from auth.users")
            auth_before = int(cursor.fetchone()[0])
            print_counts("Application rows scheduled for deletion:", before)
            print(f"Auth identities scheduled for deletion: {auth_before}")
            print(f"First administrator after reset: {admin_name} <{admin_email}>" if admin_email else "First administrator after reset: not created (the first later user will be promoted)")
            if not args.confirm:
                connection.rollback()
                print("Preview only. Re-run with --confirm to reset this project.")
                return 0

            reset_database(cursor, tables)
            after = verify_reset(cursor, tables)
        connection.commit()

    if admin_email:
        create_primary_admin(admin_name, admin_email, admin_password)
        after["users"] = 1

    print_counts("Reset complete. First-run baseline:", after)
    print(f"Auth identities: {1 if admin_email else 0}")
    if admin_email:
        print(f"Primary administrator created and verified: {admin_email}")
    else:
        print("The next application user inserted will automatically become the primary Admin.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Database reset failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
