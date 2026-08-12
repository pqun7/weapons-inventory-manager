#!/usr/bin/env python3
"""Verify an authenticated weapon intake and roll the transaction back."""

from __future__ import annotations

import json
import os
import uuid
import sys
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
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            if "--print-definition" in sys.argv:
                cursor.execute("SELECT pg_get_functiondef('public.bulk_intake_weapons(jsonb)'::regprocedure)")
                print(cursor.fetchone()[0])
                return
            cursor.execute("SELECT auth_user_id FROM public.users WHERE auth_user_id IS NOT NULL AND is_active ORDER BY CASE WHEN role = 'Admin' THEN 0 ELSE 1 END, id LIMIT 1")
            actor = cursor.fetchone()
            if not actor:
                raise RuntimeError("No active authenticated application user exists")
            cursor.execute("SELECT ws.weapon_type_id, ws.id, sc.caliber_id FROM public.weapon_subtypes AS ws JOIN public.subtype_calibers AS sc ON sc.subtype_id = ws.id ORDER BY ws.id, sc.caliber_id LIMIT 1")
            classification = cursor.fetchone()
            cursor.execute("SELECT brand_id, id FROM public.models ORDER BY brand_id, id LIMIT 1")
            model = cursor.fetchone()
            cursor.execute("SELECT currency_code FROM public.system_settings WHERE id = 1")
            currency = cursor.fetchone()
            if not classification or not model or not currency:
                raise RuntimeError("Required classification, model, or currency data is missing")
            serial = f"VERIFY-{uuid.uuid4().hex.upper()}"
            payload = {
                "weaponTypeId": classification[0], "weaponSubtypeId": classification[1],
                "caliberId": classification[2], "brandId": model[0], "modelId": model[1],
                "storageLocationId": "", "supplierId": "", "shipmentId": None,
                "condition": "Excellent", "purchasePrice": 100, "retailPrice": 150,
                "wholesalePrice": 125, "currency": currency[0], "serialNumbers": [serial],
                "notes": "Rollback-only intake verification", "additionalCosts": [],
            }
            cursor.execute("SET LOCAL ROLE authenticated")
            cursor.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (str(actor[0]),))
            cursor.execute("SELECT public.bulk_intake_weapons(%s::jsonb)", (json.dumps(payload),))
            result = cursor.fetchone()
            if not result or result[0].get("added") != 1 or result[0].get("duplicates") != []:
                raise RuntimeError(f"Unexpected intake result: {result}")
            cursor.execute("SAVEPOINT duplicate_intake_check")
            try:
                cursor.execute("SELECT public.bulk_intake_weapons(%s::jsonb)", (json.dumps(payload),))
                raise RuntimeError("Duplicate intake unexpectedly succeeded")
            except psycopg.errors.UniqueViolation:
                cursor.execute("ROLLBACK TO SAVEPOINT duplicate_intake_check")
            cursor.execute("SELECT count(*) FROM public.weapons WHERE serial_number = %s", (serial,))
            if cursor.fetchone()[0] != 1:
                raise RuntimeError("Duplicate rejection changed the inserted weapon count")
        connection.rollback()
    print("Weapon intake verification passed; test transaction rolled back.")


if __name__ == "__main__":
    main()
