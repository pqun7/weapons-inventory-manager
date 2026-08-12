#!/usr/bin/env python3
"""Seed a reset Armory Store database with a compact, coherent demo dataset.

The command creates one confirmed Supabase Auth user, a protected primary Admin
profile, master data, inventory, a supplier shipment, a customer sale, and a
partial payment. It refuses to run when business data already exists.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    import psycopg
except ImportError as error:
    raise SystemExit("Install requirements: python -m pip install -r scripts/requirements-migration.txt") from error

from db_common import connection_kwargs, create_auth_user, delete_auth_user, load_dotenv


EXPECTED_COUNTS = {
    "users": 1,
    "weapon_types": 2,
    "weapon_subtypes": 2,
    "calibers": 2,
    "brands": 2,
    "models": 2,
    "warehouses": 1,
    "storage_locations": 2,
    "suppliers": 1,
    "customers": 2,
    "shipments": 1,
    "weapons": 3,
    "ammunition": 2,
    "accessories": 2,
    "invoices": 1,
    "payment_records": 1,
}


def validate_credentials(email: str, password: str) -> None:
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise RuntimeError("SEED_ADMIN_EMAIL must be a valid email address")
    if len(password) < 8 or not re.search(r"[a-z]", password) or not re.search(r"[A-Z]", password) or not re.search(r"\d", password):
        raise RuntimeError("SEED_ADMIN_PASSWORD must contain 8+ characters, upper-case, lower-case, and a number")


def valuation(amount: float) -> str:
    return json.dumps({
        "originalAmount": amount,
        "originalCurrency": "USD",
        "exchangeRate": 1,
        "accountingAmount": amount,
        "accountingCurrency": "USD",
        "exchangeRateDate": "2026-08-01T00:00:00+00:00",
        "rateSource": "default",
    })


def assert_seedable(cursor: psycopg.Cursor[tuple[object, ...]]) -> tuple[str, str, str, str] | None:
    tables = [table for table in EXPECTED_COUNTS if table != "users"]
    tables.append("app_backups")
    occupied: dict[str, int] = {}
    for table in tables:
        cursor.execute(f'select count(*) from public."{table}"')
        count = int(cursor.fetchone()[0])
        if count:
            occupied[table] = count
    if occupied:
        raise RuntimeError(f"Database is not empty ({occupied}). Run `npm run reset-db -- --confirm` first.")
    cursor.execute("""
        select id, auth_user_id::text, name, coalesce(email, login_email),
               role::text, is_primary_admin, is_active
        from public.users order by created_at, id
    """)
    users = cursor.fetchall()
    if not users:
        return None
    if len(users) != 1 or users[0][4:] != ("Admin", True, True) or not users[0][1]:
        raise RuntimeError("Seed requires either no users or one active primary Admin created by reset-db")
    return str(users[0][0]), str(users[0][1]), str(users[0][2]), str(users[0][3])


def insert_demo_data(
    cursor: psycopg.Cursor[tuple[object, ...]],
    auth_user_id: str,
    admin_id: str,
    name: str,
    email: str,
    *,
    create_profile: bool,
) -> None:
    if create_profile:
        cursor.execute("""
            insert into public.users (
              id, auth_user_id, username, name, role, permissions, password_set,
              is_active, email, login_email, is_primary_admin
            ) values (%s, %s, %s, %s, 'Employee', '{}'::jsonb, true, true, %s, %s, false)
        """, (admin_id, auth_user_id, email, name, email, email))

    cursor.executemany(
        "insert into public.weapon_types (id, label, sort_order) values (%s, %s, %s)",
        (("WT-PISTOL", "Pistol", 10), ("WT-RIFLE", "Rifle", 20)),
    )
    cursor.executemany(
        "insert into public.weapon_subtypes (id, weapon_type_id, label, sort_order) values (%s, %s, %s, %s)",
        (("WST-PISTOL", "WT-PISTOL", "Semi-automatic", 10), ("WST-RIFLE", "WT-RIFLE", "Sporting rifle", 10)),
    )
    cursor.executemany(
        "insert into public.calibers (id, label) values (%s, %s)",
        (("CAL-9MM", "9x19mm"), ("CAL-223", ".223 Rem")),
    )
    cursor.executemany(
        "insert into public.subtype_calibers (subtype_id, caliber_id) values (%s, %s)",
        (("WST-PISTOL", "CAL-9MM"), ("WST-RIFLE", "CAL-223")),
    )
    cursor.executemany(
        "insert into public.brands (id, label) values (%s, %s)",
        (("BR-APEX", "Apex Arms"), ("BR-SENTINEL", "Sentinel Works")),
    )
    cursor.executemany(
        "insert into public.models (id, label, brand_id) values (%s, %s, %s)",
        (("MDL-A9", "A9", "BR-APEX"), ("MDL-S15", "S15", "BR-SENTINEL")),
    )
    cursor.execute("insert into public.warehouses (id, label) values ('WH-MAIN', 'Main Warehouse')")
    cursor.executemany(
        "insert into public.storage_locations (id, warehouse_id, shelf, bin) values (%s, 'WH-MAIN', %s, %s)",
        (("LOC-A1", "A", "01"), ("LOC-B1", "B", "01")),
    )

    cursor.execute("""
        insert into public.suppliers (id, name, contact_person, phone, email, address, date_added)
        values ('SUP-DEMO-001', 'Apex Distribution', 'Jordan Lee', '+1 555 0100',
                'sales@example.com', '100 Industrial Avenue', current_date - 120)
    """)
    cursor.executemany("""
        insert into public.customers
          (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added, notes, custom_fields)
        values (%s, %s, %s, %s, %s, %s, %s, current_date - 30, %s, %s::jsonb)
    """, (
        ("CUS-DEMO-001", "Alex Morgan", "+1 555 0111", "alex@example.com", "12 Market Street", False, 0, "Demo retail customer", '{"License tier":"Standard"}'),
        ("CUS-DEMO-002", "Northstar Outfitters", "+1 555 0122", "buyer@example.com", "8 Commerce Park", True, 12, "Demo wholesale customer", '{"Account manager":"Jordan Lee"}'),
    ))

    cursor.execute("""
        insert into public.shipments (
          id, shipment_number, supplier_id, shipment_date, expected_arrival_date,
          total_expected_items, notes, status, purchase_order_number, currency,
          purchase_date, actual_arrival_date, workflow_status
        ) values (
          'SHP-DEMO-001', 'DEMO-SHIP-001', 'SUP-DEMO-001', current_date - 21,
          current_date - 14, 3, 'Completed demonstration shipment', 'Arrived',
          'DEMO-PO-001', 'USD', current_date - 21, current_date - 13, 'received'
        )
    """)

    weapon_rows = (
        ("WPN-DEMO-001", "DEMO-A9-0001", "WT-PISTOL", "WST-PISTOL", "BR-APEX", "MDL-A9", "CAL-9MM", "LOC-A1", "Sold", 420, 625, 520),
        ("WPN-DEMO-002", "DEMO-A9-0002", "WT-PISTOL", "WST-PISTOL", "BR-APEX", "MDL-A9", "CAL-9MM", "LOC-A1", "Available", 420, 625, 520),
        ("WPN-DEMO-003", "DEMO-S15-0001", "WT-RIFLE", "WST-RIFLE", "BR-SENTINEL", "MDL-S15", "CAL-223", "LOC-B1", "Available", 780, 1120, 940),
    )
    for row in weapon_rows:
        purchase, retail, wholesale = row[9], row[10], row[11]
        cursor.execute("""
            insert into public.weapons (
              id, serial_number, weapon_type_id, weapon_subtype_id, brand_id, model_id,
              caliber_id, storage_location_id, supplier_id, shipment_id, condition, status,
              purchase_price, retail_price, wholesale_price, actual_final_price, date_added,
              notes, purchase_price_valuation, retail_price_valuation, wholesale_price_valuation,
              actual_final_price_valuation
            ) values (
              %s, %s, %s, %s, %s, %s, %s, %s, 'SUP-DEMO-001', 'SHP-DEMO-001',
              'Excellent', %s, %s, %s, %s, %s, current_date - 13,
              'Generated by seed-db', %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb
            )
        """, (*row[:9], purchase, retail, wholesale, retail if row[8] == "Sold" else None,
              valuation(purchase), valuation(retail), valuation(wholesale),
              valuation(retail) if row[8] == "Sold" else None))

    for item_id, name, item_type, quantity, price in (
        ("ACC-DEMO-001", "Universal Cleaning Kit", "Cleaning kit", 24, 29.95),
        ("ACC-DEMO-002", "Protective Pistol Case", "Case", 8, 39.95),
    ):
        cursor.execute("""
            insert into public.accessories (
              id, name, type, quantity, safety_threshold, price, price_currency,
              price_valuation, date_added, warehouse, shelf, bin, retail_price,
              wholesale_price, retail_price_valuation, wholesale_price_valuation
            ) values (%s, %s, %s, %s, 10, %s, 'USD', %s::jsonb, current_date - 10,
                      'Main Warehouse', 'A', '02', %s, %s, %s::jsonb, %s::jsonb)
        """, (item_id, name, item_type, quantity, price, valuation(price), price, round(price * 0.85, 2), valuation(price), valuation(round(price * 0.85, 2))))

    for item_id, name, caliber, packages, price in (
        ("AMM-DEMO-001", "9mm Practice Ammunition", "9x19mm", 40, 18.50),
        ("AMM-DEMO-002", ".223 Sporting Ammunition", ".223 Rem", 20, 27.50),
    ):
        cursor.execute("""
            insert into public.ammunition (
              id, name, caliber, package_type, units_per_package, full_packages,
              loose_rounds, safety_threshold, price, price_currency, price_valuation,
              date_added, warehouse, shelf, bin, retail_price, wholesale_price,
              retail_price_valuation, wholesale_price_valuation
            ) values (%s, %s, %s, 'Box', 50, %s, 0, 200, %s, 'USD', %s::jsonb,
                      current_date - 10, 'Main Warehouse', 'B', '02', %s, %s, %s::jsonb, %s::jsonb)
        """, (item_id, name, caliber, packages, price, valuation(price), price, round(price * 0.9, 2), valuation(price), valuation(round(price * 0.9, 2))))

    cursor.execute("""
        insert into public.invoices (
          id, invoice_number, type, customer_id, customer_name, date, due_date,
          total_original, total_negotiated, total_paid, balance, status, weapon_ids,
          line_items, sale_mode, employee_id, employee_name, notes, tax_amount,
          total_valuation, currency, accounting_currency, exchange_rate,
          exchange_rate_date, rate_source, total_original_accounting,
          total_negotiated_accounting, total_paid_accounting, balance_accounting,
          tax_amount_accounting
        ) values (
          'INV-DEMO-001', 'DEMO-INV-001', 'Sale', 'CUS-DEMO-001', 'Alex Morgan',
          current_date - 5, current_date + 25, 625, 600, 250, 350, 'Pending',
          '["WPN-DEMO-001"]'::jsonb,
          '[{"itemType":"weapon","itemId":"WPN-DEMO-001","name":"Apex Arms A9","quantity":1,"unitPrice":600,"total":600}]'::jsonb,
          'Retail', %s, %s, 'Seeded example sale', 0, %s::jsonb,
          'USD', 'USD', 1, now(), 'default', 625, 600, 250, 350, 0
        )
    """, (admin_id, name, valuation(600)))
    cursor.execute("""
        insert into public.payment_records (
          id, invoice_id, invoice_number, date, amount, currency, accounting_amount,
          accounting_currency, exchange_rate, exchange_rate_date, rate_source,
          method, employee, notes
        ) values (
          'PAY-DEMO-001', 'INV-DEMO-001', 'DEMO-INV-001', current_date - 4,
          250, 'USD', 250, 'USD', 1, now(), 'default', 'card', %s,
          'Seeded partial payment'
        )
    """, (name,))
    cursor.execute("update public.system_settings set show_demo_data = true, company_name = 'Armory Store Demo', updated_at = now() where id = 1")
    cursor.executemany(
        "insert into public.business_id_counters (prefix, last_value) values (%s, %s) on conflict (prefix) do update set last_value = excluded.last_value",
        (("INV", 1), ("PAY", 1), ("SHP", 1), ("WPN", 3), ("CUS", 2), ("SUP", 1)),
    )


def verify_seed(cursor: psycopg.Cursor[tuple[object, ...]], auth_user_id: str) -> None:
    failures: dict[str, tuple[int, int]] = {}
    for table, expected in EXPECTED_COUNTS.items():
        cursor.execute(f'select count(*) from public."{table}"')
        actual = int(cursor.fetchone()[0])
        if actual != expected:
            failures[table] = (expected, actual)
    cursor.execute("""
        select role::text, is_primary_admin, is_active, password_set
        from public.users where auth_user_id = %s
    """, (auth_user_id,))
    profile = cursor.fetchone()
    if profile != ("Admin", True, True, True):
        raise RuntimeError(f"Seeded administrator verification failed: {profile}")
    if failures:
        raise RuntimeError(f"Seed count verification failed: {failures}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--admin-name", default=None)
    parser.add_argument("--admin-email", default=None)
    parser.add_argument("--admin-password", default=None)
    parser.add_argument("--confirm", action="store_true", help="Create the Auth user and demo records")
    args = parser.parse_args()
    load_dotenv(args.env_file)
    name = (args.admin_name or os.environ.get("SEED_ADMIN_NAME") or "Demo Admin").strip()
    email = (args.admin_email or os.environ.get("SEED_ADMIN_EMAIL") or "").strip().lower()
    password = args.admin_password or os.environ.get("SEED_ADMIN_PASSWORD") or ""
    if email or password:
        validate_credentials(email, password)

    print("Demo dataset plan:")
    for table, count in EXPECTED_COUNTS.items():
        print(f"  {table}: {count}")
    print(f"  primary administrator: {name} <{email}>" if email else "  primary administrator: reuse reset-db Admin, or set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD")
    if not args.confirm:
        print("Preview only. Re-run with --confirm to seed this project.")
        return 0

    auth_user_id: str | None = None
    created_auth_user = False
    try:
        with psycopg.connect(**connection_kwargs()) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select pg_advisory_xact_lock(hashtext('armory-store-demo-seed'))")
                existing_admin = assert_seedable(cursor)
                if existing_admin:
                    admin_id, auth_user_id, name, email = existing_admin
                else:
                    if not email or not password:
                        raise RuntimeError("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD when no primary Admin exists")
                    auth_user_id = create_auth_user(email, password, name)
                    created_auth_user = True
                    admin_id = "USR-DEMO-ADMIN"
                insert_demo_data(
                    cursor, auth_user_id, admin_id, name, email,
                    create_profile=existing_admin is None,
                )
                verify_seed(cursor, auth_user_id)
            connection.commit()
    except Exception:
        if created_auth_user and auth_user_id:
            try:
                delete_auth_user(auth_user_id)
            except Exception as cleanup_error:
                print(f"Warning: failed to remove the partially created Auth user: {cleanup_error}", file=sys.stderr)
        raise

    print("Demo seed completed and verified.")
    print(f"Sign in with: {email}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Database seed failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
