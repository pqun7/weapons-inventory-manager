#!/usr/bin/env python3
"""Exercise inventory intake, mixed sale, invoice and payment workflows, then roll back."""

from __future__ import annotations

import json
import os
import uuid
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import psycopg


def load_env(path: Path) -> None:
    for raw in path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []:
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def rpc(cursor: psycopg.Cursor, signature: str, parameters: tuple[object, ...]) -> object:
    placeholders = ",".join(["%s"] * len(parameters))
    cursor.execute(f"select public.{signature}({placeholders})", parameters)
    return cursor.fetchone()[0]


def main() -> None:
    load_env(Path(".env.local"))
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is required")

    marker = uuid.uuid4().hex.upper()
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select u.auth_user_id, u.id from public.users as u "
                "where u.auth_user_id is not null and u.is_active "
                "order by case when u.role = 'Admin' then 0 else 1 end, u.id limit 1"
            )
            actor = cursor.fetchone()
            cursor.execute("select c.id, c.name from public.customers as c order by c.id limit 1")
            customer = cursor.fetchone()
            cursor.execute(
                "select ws.weapon_type_id, ws.id, sc.caliber_id from public.weapon_subtypes as ws "
                "join public.subtype_calibers as sc on sc.subtype_id = ws.id order by ws.id, sc.caliber_id limit 1"
            )
            classification = cursor.fetchone()
            cursor.execute("select m.brand_id, m.id from public.models as m order by m.brand_id, m.id limit 1")
            model = cursor.fetchone()
            cursor.execute(
                "select s.currency_code, s.tax_percent, c.decimal_precision "
                "from public.system_settings as s join public.currencies as c on c.iso_code = s.currency_code where s.id = 1"
            )
            settings = cursor.fetchone()
            if not actor or not customer or not classification or not model or not settings:
                raise RuntimeError("Verification requires an active user, customer, classifications, model and currency settings")

            currency, tax_percent, precision = settings
            cursor.execute("set local role authenticated")
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(actor[0]),))

            ammunition_id = rpc(cursor, "create_inventory_product", (
                "ammunition",
                json.dumps({
                    "name": f"Verification ammunition {marker}", "caliber": "VERIFY",
                    "package_type": "Box", "units_per_package": 10, "full_packages": 2,
                    "loose_rounds": 5, "safety_threshold": 1, "price": 100,
                    "price_currency": currency, "retail_price": 150, "wholesale_price": 125,
                    "retail_price_mode": "manual", "wholesale_price_mode": "manual",
                    "date_added": "2026-08-12", "warehouse": "Verification", "shelf": "A", "bin": "1",
                }), json.dumps([]),
            ))
            accessory_id = rpc(cursor, "create_inventory_product", (
                "accessory",
                json.dumps({
                    "name": f"Verification accessory {marker}", "type": "Verification", "quantity": 4,
                    "safety_threshold": 1, "price": 50, "price_currency": currency,
                    "retail_price": 75, "wholesale_price": 65, "retail_price_mode": "manual",
                    "wholesale_price_mode": "manual", "date_added": "2026-08-12",
                    "warehouse": "Verification", "shelf": "A", "bin": "2",
                }), json.dumps([]),
            ))
            serial = f"VERIFY-SALE-{marker}"
            intake = rpc(cursor, "bulk_intake_weapons", (json.dumps({
                "weaponTypeId": classification[0], "weaponSubtypeId": classification[1],
                "caliberId": classification[2], "brandId": model[0], "modelId": model[1],
                "storageLocationId": "", "supplierId": "", "shipmentId": None,
                "condition": "Excellent", "purchasePrice": 100, "retailPrice": 150,
                "wholesalePrice": 125, "currency": currency, "serialNumbers": [serial],
                "notes": "Rollback-only sale verification", "additionalCosts": [],
            }),))
            if intake.get("added") != 1:
                raise RuntimeError(f"Weapon intake failed: {intake}")
            cursor.execute("select w.id from public.weapons as w where w.serial_number = %s", (serial,))
            weapon_id = cursor.fetchone()[0]

            lines = [
                {"itemType": "ammunition", "itemId": ammunition_id, "name": "Verification ammunition", "quantity": 2, "unitPrice": 150},
                {"itemType": "accessory", "itemId": accessory_id, "name": "Verification accessory", "quantity": 1, "unitPrice": 75},
                {"itemType": "weapon", "itemId": weapon_id, "name": serial, "quantity": 1, "unitPrice": 150},
            ]
            subtotal = Decimal("525")
            tax = (subtotal * Decimal(str(tax_percent)) / Decimal("100")).quantize(
                Decimal(1).scaleb(-int(precision)), rounding=ROUND_HALF_UP
            )
            paid = (subtotal + tax) / Decimal("2")
            invoice_number = f"VERIFY-INV-{marker}"
            sale = rpc(cursor, "complete_sale", (
                customer[0], customer[1], "Retail", invoice_number, json.dumps(lines),
                subtotal, subtotal, tax, "2026-08-20", paid, "cash", currency,
                json.dumps([]), "Rollback-only mixed sale verification", "2026-08-12",
            ))
            invoice_id = sale.get("invoiceId")
            if not invoice_id:
                raise RuntimeError(f"Sale returned an invalid response: {sale}")

            cursor.execute("select w.status from public.weapons as w where w.id = %s", (weapon_id,))
            if cursor.fetchone()[0] != "Sold":
                raise RuntimeError("Weapon was not marked sold")
            cursor.execute("select a.quantity from public.accessories as a where a.id = %s", (accessory_id,))
            if cursor.fetchone()[0] != 3:
                raise RuntimeError("Accessory stock was not decremented")
            cursor.execute(
                "select a.full_packages * a.units_per_package + a.loose_rounds from public.ammunition as a where a.id = %s",
                (ammunition_id,),
            )
            if cursor.fetchone()[0] != 23:
                raise RuntimeError("Ammunition stock was not decremented correctly")
            cursor.execute("select i.balance from public.invoices as i where i.id = %s", (invoice_id,))
            balance = cursor.fetchone()[0]
            if balance <= 0:
                raise RuntimeError("Partial payment did not leave an invoice balance")

            cursor.execute("savepoint duplicate_invoice_check")
            try:
                rpc(cursor, "complete_sale", (
                    customer[0], customer[1], "Retail", invoice_number, json.dumps(lines),
                    subtotal, subtotal, tax, "2026-08-20", 0, "cash", currency,
                    json.dumps([]), "Duplicate invoice verification", "2026-08-12",
                ))
                raise RuntimeError("Duplicate invoice number unexpectedly succeeded")
            except psycopg.errors.UniqueViolation:
                cursor.execute("rollback to savepoint duplicate_invoice_check")

            payment = rpc(cursor, "register_payment", (invoice_id, balance, currency, "bank_transfer", "Final verification payment"))
            if Decimal(str(payment.get("newBalance"))) != Decimal("0"):
                raise RuntimeError(f"Final payment did not settle invoice: {payment}")
            cursor.execute("select i.status, i.balance from public.invoices as i where i.id = %s", (invoice_id,))
            if cursor.fetchone() != ("Paid", Decimal("0.0000")):
                raise RuntimeError("Invoice was not closed after final payment")

        connection.rollback()
    print("Core workflow verification passed: weapon/ammunition/accessory intake, mixed sale, stock deduction, duplicate invoice rejection and final payment all succeeded; transaction rolled back.")


if __name__ == "__main__":
    main()
