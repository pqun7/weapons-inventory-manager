#!/usr/bin/env python3
"""Remove operational/demo data while preserving production inventory and authentication.

The command is preview-only unless --confirm is supplied. It never writes to the
auth schema. Registered weapons, ammunition, currencies, application users,
settings, and the master-data rows required by preserved inventory are retained.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import psycopg
except ImportError as error:
    raise SystemExit("Install requirements: python -m pip install -r scripts/requirements-migration.txt") from error


PRESERVED_TABLES = (
    "currencies", "exchange_rate_history", "exchange_rate_overrides", "exchange_rate_audit_log",
    "users", "user_preferences", "system_settings", "weapon_types", "weapon_subtypes",
    "calibers", "subtype_calibers", "brands", "models", "warehouses", "storage_locations",
    "weapons", "ammunition", "ammunition_weapon_compatibility",
)

RESET_TABLES = (
    "payment_records", "invoices", "customers", "accessory_weapon_compatibility", "accessories",
    "shipment_validation_issues", "shipment_item_changes", "shipment_status_history",
    "shipment_documents", "shipment_cost_scope_items", "shipment_cost_allocations", "shipment_costs",
    "shipment_import_items", "shipment_items", "shipment_imports", "shipments", "suppliers",
    "inventory_transactions", "financial_data_issues", "audit_logs", "app_notifications",
    "saved_filters", "migration_runs",
)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def connection_kwargs() -> dict[str, object]:
    database_url = os.environ.get("SUPABASE_DB_URL")
    if database_url:
        return {"conninfo": database_url}
    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    password = os.environ.get("DATABASE_PASSWORD") or os.environ.get("SUPABASE_DB_PASSWORD")
    if not supabase_url or not password:
        raise RuntimeError("Set SUPABASE_DB_URL, or SUPABASE_URL and DATABASE_PASSWORD")
    hostname = urlparse(supabase_url).hostname
    if not hostname or not hostname.endswith(".supabase.co"):
        raise RuntimeError("SUPABASE_URL is invalid")
    project_ref = hostname.removesuffix(".supabase.co")
    return {
        "host": f"db.{project_ref}.supabase.co", "port": 5432, "dbname": "postgres",
        "user": "postgres", "password": password, "sslmode": "require",
    }


def table_counts(cursor: psycopg.Cursor[tuple[object, ...]], tables: tuple[str, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in tables:
        cursor.execute(f'SELECT count(*) FROM public."{table}"')
        row = cursor.fetchone()
        counts[table] = int(row[0]) if row else 0
    return counts


def print_counts(title: str, counts: dict[str, int]) -> None:
    print(title)
    for table, count in counts.items():
        print(f"  {table}: {count}")


def reset(cursor: psycopg.Cursor[tuple[object, ...]]) -> None:
    # Break optional links from preserved inventory before removing shipment demo data.
    cursor.execute("UPDATE public.weapons SET shipment_id = NULL, supplier_id = NULL WHERE shipment_id IS NOT NULL OR supplier_id IS NOT NULL")
    cursor.execute("UPDATE public.inventory_cost_snapshots SET shipment_id = NULL, shipment_item_id = NULL WHERE product_type IN ('weapon', 'ammunition')")
    cursor.execute("UPDATE public.shipments SET import_id = NULL WHERE import_id IS NOT NULL")

    # Financial and customer demo history.
    cursor.execute("DELETE FROM public.payment_records")
    cursor.execute("DELETE FROM public.invoices")
    cursor.execute("DELETE FROM public.customers")

    # Accessories are intentionally not part of the retained production baseline.
    cursor.execute("DELETE FROM public.accessory_weapon_compatibility")
    cursor.execute("DELETE FROM public.product_costs WHERE product_type = 'accessory'")
    cursor.execute("DELETE FROM public.inventory_cost_snapshots WHERE product_type = 'accessory'")
    cursor.execute("DELETE FROM public.accessories")

    # Shipment/import data, in foreign-key-safe order.
    cursor.execute("DELETE FROM public.shipment_validation_issues")
    cursor.execute("DELETE FROM public.shipment_item_changes")
    cursor.execute("DELETE FROM public.shipment_status_history")
    cursor.execute("DELETE FROM public.shipment_documents")
    cursor.execute("DELETE FROM public.shipment_cost_scope_items")
    cursor.execute("DELETE FROM public.shipment_cost_allocations")
    cursor.execute("DELETE FROM public.shipment_costs")
    cursor.execute("DELETE FROM public.shipment_import_items")
    cursor.execute("DELETE FROM public.shipment_items")
    cursor.execute("DELETE FROM public.shipment_imports")
    cursor.execute("DELETE FROM public.shipments")
    cursor.execute("DELETE FROM public.suppliers")

    # Ephemeral/demo activity. Users and auth identities remain untouched.
    cursor.execute("DELETE FROM public.inventory_transactions")
    cursor.execute("DELETE FROM public.financial_data_issues")
    cursor.execute("DELETE FROM public.audit_logs")
    cursor.execute("DELETE FROM public.app_notifications")
    cursor.execute("DELETE FROM public.saved_filters")
    cursor.execute("DELETE FROM public.migration_runs")
    cursor.execute("UPDATE public.system_settings SET show_demo_data = FALSE, updated_at = now() WHERE id = 1")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--confirm", action="store_true", help="Commit the reset. Without this flag only counts are shown.")
    args = parser.parse_args()
    load_dotenv(args.env_file)

    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext('armory-store-production-reset'))")
            before_reset = table_counts(cursor, RESET_TABLES)
            preserved_before = table_counts(cursor, PRESERVED_TABLES)
            print_counts("Rows scheduled for deletion:", before_reset)
            print_counts("Rows preserved:", preserved_before)
            if not args.confirm:
                connection.rollback()
                print("Preview only. Re-run with --confirm to perform the reset.")
                return 0
            reset(cursor)
            after_reset = table_counts(cursor, RESET_TABLES)
            preserved_after = table_counts(cursor, PRESERVED_TABLES)
            if any(after_reset.values()):
                raise RuntimeError(f"Reset verification failed; non-empty reset tables: {after_reset}")
            if preserved_after != preserved_before:
                raise RuntimeError("Preserved-table counts changed; transaction has been rolled back")
        connection.commit()
    print_counts("Reset complete; preserved rows:", preserved_after)
    print("Authentication data was not modified.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Production reset failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
