#!/usr/bin/env python3
"""Verify manifest row deletion and the final schema in a rollback-only transaction."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import psycopg


def load_env(path: Path) -> None:
    for raw in path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []:
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    load_env(Path(".env.local"))
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is required")
    marker = uuid.uuid4().hex

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select count(*) from information_schema.columns "
                "where table_schema = 'public' and table_name = 'shipment_import_items' and column_name = 'confidence_json'"
            )
            if cursor.fetchone()[0] != 0:
                raise RuntimeError("confidence_json still exists")
            cursor.execute(
                "select count(*) from information_schema.routines "
                "where routine_schema = 'public' and routine_name = 'delete_manifest_items'"
            )
            if cursor.fetchone()[0] != 1:
                raise RuntimeError("delete_manifest_items is missing")

            cursor.execute(
                "select auth_user_id from public.users where auth_user_id is not null and is_active "
                "order by case when role = 'Admin' then 0 else 1 end, id limit 1"
            )
            actor = cursor.fetchone()
            if not actor:
                raise RuntimeError("An active application user is required")
            cursor.execute("select id from public.suppliers order by id limit 1")
            supplier = cursor.fetchone()
            cursor.execute("select currency_code from public.system_settings where id = 1")
            currency = cursor.fetchone()
            cursor.execute("select id from public.storage_locations order by id limit 1")
            location = cursor.fetchone()
            if not supplier or not currency or not location:
                raise RuntimeError("A supplier, currency, and storage location are required")
            cursor.execute("set local role authenticated")
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(actor[0]),))

            items = [
                {
                    "id": f"verify-row-{marker}-{index}",
                    "rowIndex": index,
                    "productType": "accessory",
                    "productName": f"Verification item {index}",
                    "quantity": 1,
                    "unitPrice": 10,
                    "retailPrice": 15,
                    "wholesalePrice": 12,
                    "retailPriceMode": "manual",
                    "wholesalePriceMode": "manual",
                    "additionalCosts": [],
                    "totalPrice": 10,
                    "serialNumbers": [],
                    "source": {"sheet": "verification", "row": index},
                    "rawData": {},
                }
                for index in range(1, 5)
            ]
            payload = {
                "id": f"verify-import-{marker}",
                "fileName": "rollback-only-verification.xlsx",
                "fileType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "fileSize": 1,
                "fileHash": uuid.uuid4().hex + uuid.uuid4().hex,
                "schemaVersion": "1.3",
                "items": items,
            }
            cursor.execute("select public.create_manifest_review(%s::jsonb)", (json.dumps(payload),))
            import_id = cursor.fetchone()[0]

            cursor.execute(
                "select retail_price, wholesale_price, retail_price_mode, wholesale_price_mode, additional_costs "
                "from public.shipment_import_items where import_id = %s order by row_index limit 1",
                (import_id,),
            )
            if cursor.fetchone() != (15, 12, "manual", "manual", []):
                raise RuntimeError("Imported line-item prices were not persisted correctly")

            bulk_updates = [
                {
                    "itemId": item["id"],
                    "patch": {
                        "productName": f"Bulk updated item {index}",
                        "unitPrice": 20 + index,
                        "retailPrice": 30 + index,
                        "wholesalePrice": 25 + index,
                        "currency": currency[0],
                        "storageLocationId": location[0],
                    },
                }
                for index, item in enumerate(items, 1)
            ]
            cursor.execute(
                "select public.bulk_update_manifest_items(%s, %s::jsonb)",
                (import_id, json.dumps(bulk_updates)),
            )
            cursor.execute(
                "select count(*), count(distinct product_name), min(unit_price), max(unit_price) "
                "from public.shipment_import_items where import_id = %s",
                (import_id,),
            )
            if cursor.fetchone() != (4, 4, 21, 24):
                raise RuntimeError("Row-specific bulk manifest update failed")

            cursor.execute("savepoint verify_linked_schedule")
            confirmation = {
                "importId": import_id,
                "shipmentNumber": f"VERIFY-EARLY-{marker}",
                "supplierId": supplier[0],
                "shipmentDate": "2026-08-12",
                "expectedArrivalDate": "2026-08-30",
                "currency": currency[0],
                "arrival": "future",
                "note": "Rollback-only linked shipment verification",
            }
            cursor.execute("select public.confirm_manifest_review(%s::jsonb)", (json.dumps(confirmation),))
            shipment_id = cursor.fetchone()[0]
            cursor.execute(
                "select public.update_scheduled_shipment(%s, %s::jsonb)",
                (shipment_id, json.dumps({"expectedArrivalDate": "2026-08-20"})),
            )
            cursor.execute(
                "select shipment.expected_arrival_date, manifest.expected_arrival_date "
                "from public.shipments as shipment join public.shipment_imports as manifest on manifest.id = shipment.import_id "
                "where shipment.id = %s",
                (shipment_id,),
            )
            linked_dates = cursor.fetchone()
            if not linked_dates or tuple(str(value) for value in linked_dates) != ("2026-08-20", "2026-08-20"):
                raise RuntimeError("Editing a linked shipment date did not update both records")
            cursor.execute("select public.receive_scheduled_shipment(%s)", (shipment_id,))
            received_id = cursor.fetchone()[0]
            cursor.execute(
                "select shipment.status, shipment.workflow_status, manifest.status "
                "from public.shipments as shipment join public.shipment_imports as manifest on manifest.id = shipment.import_id "
                "where shipment.id = %s",
                (received_id,),
            )
            if cursor.fetchone() != ("Arrived", "received", "received"):
                raise RuntimeError("Early linked shipment receipt did not complete the legal status transitions")
            cursor.execute("rollback to savepoint verify_linked_schedule")

            cursor.execute(
                "select public.delete_manifest_items(%s, %s::jsonb)",
                (import_id, json.dumps([items[0]["id"], items[0]["id"]])),
            )
            cursor.execute("select count(*) from public.shipment_import_items where import_id = %s", (import_id,))
            if cursor.fetchone()[0] != 3:
                raise RuntimeError("Single-row deletion failed")

            cursor.execute(
                "select public.delete_manifest_items(%s, %s::jsonb)",
                (import_id, json.dumps([items[1]["id"], items[2]["id"]])),
            )
            cursor.execute("select count(*) from public.shipment_import_items where import_id = %s", (import_id,))
            if cursor.fetchone()[0] != 1:
                raise RuntimeError("Multi-row deletion failed")

            cursor.execute("savepoint protect_last_row")
            try:
                cursor.execute(
                    "select public.delete_manifest_items(%s, %s::jsonb)",
                    (import_id, json.dumps([items[3]["id"]])),
                )
                raise RuntimeError("Deleting the final manifest row was not rejected")
            except psycopg.errors.CheckViolation:
                cursor.execute("rollback to savepoint protect_last_row")

        connection.rollback()
    print("Manifest verification passed: bulk row updates, linked date edit, early receipt, deletion, and final-row protection all succeeded; transaction rolled back.")


if __name__ == "__main__":
    main()
