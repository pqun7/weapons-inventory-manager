#!/usr/bin/env python3
"""Verify manifest scheduling and inventory receipt in rollback-only savepoints."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import psycopg

from workflow_test_data import ensure_workflow_prerequisites


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
    marker = uuid.uuid4().hex.upper()

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            ensure_workflow_prerequisites(cursor, marker)
            cursor.execute("select auth_user_id from public.users where auth_user_id is not null and is_active order by case when role = 'Admin' then 0 else 1 end, id limit 1")
            actor = cursor.fetchone()
            cursor.execute("select id from public.suppliers order by id limit 1")
            supplier = cursor.fetchone()
            cursor.execute("select currency_code from public.system_settings where id = 1")
            currency = cursor.fetchone()
            cursor.execute("select i.id from public.shipment_imports as i where i.status = 'pending_review' and exists (select 1 from public.shipment_import_items as item where item.import_id = i.id) and not exists (select 1 from public.shipment_import_items as item where item.import_id = i.id and item.status in ('invalid', 'duplicate', 'conflict')) order by i.updated_at desc limit 1")
            manifest = cursor.fetchone()
            if not actor or not supplier or not currency:
                raise RuntimeError("An active user, supplier, and currency are required")

            cursor.execute("set local role authenticated")
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(actor[0]),))
            if not manifest:
                payload = {
                    "id": f"verify-manifest-{marker}",
                    "fileName": "rollback-only-manifest.xlsx",
                    "fileType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "fileSize": 1,
                    "fileHash": uuid.uuid4().hex + uuid.uuid4().hex,
                    "schemaVersion": "1.3",
                    "items": [{
                        "id": f"verify-item-{marker}", "rowIndex": 1,
                        "productType": "accessory", "productName": "Verification accessory",
                        "quantity": 1, "unitPrice": 100, "retailPrice": 150,
                        "wholesalePrice": 125, "retailPriceMode": "manual",
                        "wholesalePriceMode": "manual", "additionalCosts": [],
                        "totalPrice": 100, "serialNumbers": [],
                        "source": {"sheet": "verification", "row": 1}, "rawData": {},
                    }],
                }
                cursor.execute("select public.create_manifest_review(%s::jsonb)", (json.dumps(payload),))
                manifest = (cursor.fetchone()[0],)
            base_confirmation = {
                "importId": manifest[0], "supplierId": supplier[0], "shipmentDate": "2026-08-12",
                "expectedArrivalDate": "2026-08-20", "currency": currency[0], "note": "Rollback-only manifest workflow verification",
            }

            cursor.execute("savepoint verify_manifest_scheduled")
            scheduled = {**base_confirmation, "shipmentNumber": f"VERIFY-MANIFEST-SCHEDULED-{marker}", "arrival": "future"}
            cursor.execute("select public.confirm_manifest_review(%s::jsonb)", (json.dumps(scheduled),))
            scheduled_id = cursor.fetchone()[0]
            cursor.execute("select status, workflow_status, planned_costs from public.shipments as shipment where shipment.id = %s", (scheduled_id,))
            scheduled_state = cursor.fetchone()
            if not scheduled_state or scheduled_state[:2] != ("Pending", "scheduled"):
                raise RuntimeError("Manifest scheduling did not create the expected scheduled shipment")
            cursor.execute("select additional_costs from public.shipment_imports as manifest where manifest.id = %s", (manifest[0],))
            if scheduled_state[2] != cursor.fetchone()[0]:
                raise RuntimeError("Scheduled manifest costs were not copied to the shipment record")
            cursor.execute("select count(*) from public.inventory_transactions as transaction where transaction.shipment_id = %s", (scheduled_id,))
            if cursor.fetchone()[0] != 0:
                raise RuntimeError("Scheduled manifest changed inventory")
            cursor.execute("rollback to savepoint verify_manifest_scheduled")

            cursor.execute("select subtype.weapon_type_id, subtype.id, mapping.caliber_id from public.weapon_subtypes as subtype join public.subtype_calibers as mapping on mapping.subtype_id = subtype.id order by subtype.id limit 1")
            classification = cursor.fetchone()
            cursor.execute("select brand_id, id from public.models order by brand_id, id limit 1")
            model = cursor.fetchone()
            cursor.execute("select id from public.storage_locations order by id limit 1")
            location = cursor.fetchone()
            if not classification or not model or not location:
                raise RuntimeError("Receipt verification requires complete master data")
            cursor.execute("select jsonb_agg(item.id) from public.shipment_import_items as item where item.import_id = %s", (manifest[0],))
            item_ids = cursor.fetchone()[0]
            patch = {
                "unitPrice": 100, "retailPrice": 150, "wholesalePrice": 125,
                "retailPriceMode": "manual", "wholesalePriceMode": "manual", "currency": currency[0],
                "weaponTypeId": classification[0], "weaponSubtypeId": classification[1], "caliberId": classification[2],
                "brandId": model[0], "modelId": model[1], "storageLocationId": location[0],
            }
            cursor.execute("select public.update_manifest_items(%s, %s::jsonb, %s::jsonb)", (manifest[0], json.dumps(item_ids), json.dumps(patch)))
            cursor.execute("select validation_summary from public.shipment_imports as i where i.id = %s", (manifest[0],))
            summary = cursor.fetchone()[0]
            if sum(int(summary.get(key, 0)) for key in ("invalid", "duplicate", "conflict")):
                raise RuntimeError(f"Manifest could not be prepared for receipt: {summary}")
            cursor.execute(
                "select coalesce(sum(jsonb_array_length(item.serial_numbers_json)) filter (where item.product_type = 'weapon'), 0), count(*) "
                "from public.shipment_import_items as item where item.import_id = %s",
                (manifest[0],),
            )
            expected_weapon_count, expected_line_count = cursor.fetchone()

            received = {**base_confirmation, "shipmentNumber": f"VERIFY-MANIFEST-RECEIVED-{marker}", "expectedArrivalDate": None, "arrival": "arrived_now"}
            cursor.execute("select public.confirm_manifest_review(%s::jsonb)", (json.dumps(received),))
            received_id = cursor.fetchone()[0]
            cursor.execute("select status, workflow_status from public.shipments as shipment where shipment.id = %s", (received_id,))
            if cursor.fetchone() != ("Arrived", "received"):
                raise RuntimeError("Manifest receipt did not create a received shipment")
            cursor.execute("select count(*) from public.inventory_transactions as transaction where transaction.shipment_id = %s", (received_id,))
            transaction_count = cursor.fetchone()[0]
            cursor.execute("select count(*) from public.shipment_items where shipment_id = %s", (received_id,))
            received_line_count = cursor.fetchone()[0]
            if transaction_count == 0 and received_line_count == 0:
                raise RuntimeError("Manifest receipt did not create inventory or shipment lines")
            cursor.execute("select count(*), count(distinct serial_number) from public.weapons where shipment_id = %s", (received_id,))
            weapon_count, distinct_serial_count = cursor.fetchone()
            if weapon_count != expected_weapon_count or distinct_serial_count != expected_weapon_count:
                raise RuntimeError("A serialized manifest quantity was not expanded to one unique inventory weapon per serial")
            cursor.execute("select count(*) from public.shipment_items where shipment_id = %s", (received_id,))
            if cursor.fetchone()[0] != expected_line_count:
                raise RuntimeError("Manifest product rows did not remain one shipment line per source row")

        connection.rollback()
    print("Manifest workflow verification passed: future scheduling and arrived inventory receipt both succeeded; transaction rolled back.")


if __name__ == "__main__":
    main()
