#!/usr/bin/env python3
"""Verify scheduled and received shipment workflows, then roll everything back."""

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


def call_json(cursor: psycopg.Cursor, function: str, payload: dict) -> object:
    cursor.execute(f"select public.{function}(%s::jsonb)", (json.dumps(payload),))
    return cursor.fetchone()[0]


def main() -> None:
    load_env(Path(".env.local"))
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is required")

    marker = uuid.uuid4().hex.upper()
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            ensure_workflow_prerequisites(cursor, marker)
            cursor.execute("select auth_user_id, id from public.users where auth_user_id is not null and is_active order by case when role = 'Admin' then 0 else 1 end, id limit 1")
            actor = cursor.fetchone()
            cursor.execute("select id from public.suppliers order by id limit 1")
            supplier = cursor.fetchone()
            cursor.execute("select sl.id from public.storage_locations as sl order by sl.id limit 1")
            location = cursor.fetchone()
            cursor.execute("select currency_code from public.system_settings where id = 1")
            currency = cursor.fetchone()
            if not actor or not supplier or not location or not currency:
                raise RuntimeError("Workflow verification requires an active user, supplier, storage location, and currency")

            cursor.execute("set local role authenticated")
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(actor[0]),))

            costs = [{
                "id": f"VERIFY-COST-{marker}", "name": "Verification freight",
                "calculationType": "fixed", "amount": "10", "calculationBase": "original_purchase_cost",
                "currency": currency[0], "scope": "entire_shipment", "allocationMethod": "by_value",
                "selectedShipmentItemIds": [],
            }]
            product_costs = [{
                "id": f"SHARED-DRAFT-COST-{marker}", "name": "Shared product clearance",
                "calculationType": "fixed", "amount": "5", "percentageRate": None,
                "calculationBase": "original_purchase_cost", "currency": currency[0],
            }]
            line = {
                "id": f"VERIFY-LINE-{marker}", "productType": "accessory",
                "weaponTypeId": "", "weaponSubtypeId": "", "caliberId": "", "brandId": "", "modelId": "",
                "storageLocationId": "", "quantity": 2, "purchasePrice": 100,
                "retailPrice": 150, "wholesalePrice": 125, "retailPriceMode": "manual",
                "wholesalePriceMode": "manual", "serialNumbers": [], "currency": currency[0],
                "brandLabel": "Verification", "modelLabel": "Workflow accessory", "additionalCosts": product_costs,
            }
            second_line = {
                **line,
                "id": f"VERIFY-LINE-SECOND-{marker}",
                "modelLabel": "Workflow accessory second",
            }

            scheduled_number = f"VERIFY-SCHEDULED-{marker}"
            scheduled_id = call_json(cursor, "create_shipment", {
                "shipmentNumber": scheduled_number, "supplierId": supplier[0], "shipmentDate": "2026-08-12",
                "expectedArrivalDate": "2026-08-20", "totalExpectedItems": 2, "attachments": [],
                "notes": "Rollback-only scheduled workflow verification", "status": "In Transit",
                "currency": currency[0], "lineItems": [line], "additionalCosts": costs,
            })
            cursor.execute("select status, workflow_status, line_items, planned_costs from public.shipments as s where s.id = %s", (scheduled_id,))
            scheduled = cursor.fetchone()
            if not scheduled or scheduled[0] != "In Transit" or scheduled[1] != "scheduled" or len(scheduled[2]) != 1 or len(scheduled[3]) != 1:
                raise RuntimeError(f"Scheduled shipment was not preserved correctly: {scheduled}")
            cursor.execute("select count(*) from public.inventory_transactions as tx where tx.shipment_id = %s", (scheduled_id,))
            if cursor.fetchone()[0] != 0:
                raise RuntimeError("Scheduled shipment changed inventory")

            cursor.execute("update public.shipments as s set expected_arrival_date = current_date where s.id = %s", (scheduled_id,))
            cursor.execute("select public.flag_overdue_shipments()")
            cursor.execute(
                "select count(*) from public.app_notifications as n "
                "where n.entity_id = %s and n.type = 'ShipmentArrivalDue' and not n.is_read",
                (scheduled_id,),
            )
            if cursor.fetchone()[0] < 1:
                raise RuntimeError("Expected-today shipment did not notify an administrator")

            cursor.execute("update public.shipments as s set expected_arrival_date = current_date - 1 where s.id = %s", (scheduled_id,))
            cursor.execute("select public.flag_overdue_shipments()")
            cursor.execute("select status from public.shipments as s where s.id = %s", (scheduled_id,))
            if cursor.fetchone()[0] != "Delayed":
                raise RuntimeError("Overdue scheduled shipment was not marked delayed")
            cursor.execute(
                "select public.reschedule_shipment(%s, current_date + 7, %s)",
                (scheduled_id, "Rollback-only reschedule verification"),
            )
            cursor.execute("select status, expected_arrival_date > current_date from public.shipments as s where s.id = %s", (scheduled_id,))
            if cursor.fetchone() != ("In Transit", True):
                raise RuntimeError("Rescheduled shipment did not return to in-transit state")

            edited_line = {**line, "quantity": 3, "modelLabel": "Edited workflow accessory"}
            edited_line["id"] = line["id"]
            cursor.execute(
                "select public.update_scheduled_shipment(%s, %s::jsonb)",
                (scheduled_id, json.dumps({
                    "shipmentNumber": scheduled_number,
                    "supplierId": supplier[0],
                    "shipmentDate": "2026-08-12",
                    "expectedArrivalDate": "2026-08-20",
                    "currency": currency[0],
                    "notes": "Edited before receipt",
                    "lineItems": [edited_line],
                    "additionalCosts": costs,
                })),
            )
            cursor.execute("select total_expected_items, line_items -> 0 ->> 'modelLabel' from public.shipments as s where s.id = %s", (scheduled_id,))
            if cursor.fetchone() != (3, "Edited workflow accessory"):
                raise RuntimeError("Scheduled shipment edit was not persisted")

            cursor.execute("select public.receive_scheduled_shipment(%s)", (scheduled_id,))
            received_scheduled_id = cursor.fetchone()[0]
            if received_scheduled_id != scheduled_id:
                raise RuntimeError("Scheduled shipment identity changed during receipt")
            cursor.execute("select status, workflow_status from public.shipments as s where s.id = %s", (received_scheduled_id,))
            if cursor.fetchone() != ("Arrived", "received"):
                raise RuntimeError("Scheduled shipment receipt did not complete")
            cursor.execute("select a.name, a.quantity from public.accessories as a where a.id::text in (select jsonb_array_elements_text(si.product_ids_json) from public.shipment_items as si where si.shipment_id = %s)", (received_scheduled_id,))
            if cursor.fetchone() != ("Verification Edited workflow accessory", 3):
                raise RuntimeError("Edited scheduled shipment contents were not transferred to inventory")

            received_number = f"VERIFY-RECEIVED-{marker}"
            received_id = call_json(cursor, "bulk_create_shipment", {
                "shipment": {
                    "shipmentNumber": received_number, "supplierId": supplier[0], "shipmentDate": "2026-08-12",
                    "expectedArrivalDate": "2026-08-12", "actualArrivalDate": "2026-08-12",
                    "totalExpectedItems": 4, "attachments": [], "notes": "Rollback-only received workflow verification",
                    "currency": currency[0], "lineItems": [line, second_line],
                },
                "lineItems": [line, second_line], "additionalCosts": costs,
            })
            cursor.execute("select status, workflow_status from public.shipments as s where s.id = %s", (received_id,))
            received = cursor.fetchone()
            if received != ("Arrived", "received"):
                raise RuntimeError(f"Received shipment has incorrect state: {received}")
            cursor.execute("select count(*) from public.shipment_items as si where si.shipment_id = %s", (received_id,))
            if cursor.fetchone()[0] != 2:
                raise RuntimeError("Received shipment did not create both shipment items")
            cursor.execute("select count(*) from public.shipment_costs as sc where sc.shipment_id = %s", (received_id,))
            if cursor.fetchone()[0] != 1:
                raise RuntimeError("Received shipment did not persist and allocate its shipment cost")
            cursor.execute(
                "select count(*), count(distinct pc.id) "
                "from public.product_costs as pc "
                "join public.shipment_items as si on si.product_type = pc.product_type "
                "and si.product_ids_json ? pc.product_id "
                "where si.shipment_id = %s",
                (received_id,),
            )
            product_cost_result = cursor.fetchone()
            if product_cost_result != (2, 2):
                raise RuntimeError(f"Shared draft cost identifiers were not replaced by unique database identifiers: {product_cost_result}")

        connection.rollback()
    print("Shipment workflow verification passed: expected-today notification, overdue status, rescheduling, scheduled receipt into inventory, immediate receipt, unique product-cost identifiers and atomic shipment costs all succeeded; transaction rolled back.")


if __name__ == "__main__":
    main()
