#!/usr/bin/env python3
"""Read-only verification of the configured Supabase installation and RLS boundary."""

from __future__ import annotations

import json
import argparse
import os
import urllib.error
import urllib.request
from pathlib import Path

from db_common import load_dotenv, supabase_url


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_SCHEMA_VERSION = "20260815000200"
REQUIRED_TABLES = (
    "users", "weapons", "weapon_types", "weapon_subtypes", "calibers", "brands", "models",
    "warehouses", "storage_locations", "suppliers", "customers", "shipments", "invoices",
    "payment_records", "accessories", "ammunition", "audit_logs", "system_settings",
    "app_notifications", "saved_filters", "user_preferences", "inventory_product_types",
)


def public_key() -> str:
    for name in ("VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    raise RuntimeError("A Supabase publishable/anon key is required")


def request(path: str, *, method: str = "GET", body: bytes | None = None) -> tuple[int, object]:
    key = public_key()
    headers = {"apikey": key, "Accept": "application/json", "Content-Type": "application/json"}
    if key.count(".") == 2:
        headers["Authorization"] = f"Bearer {key}"
    call = urllib.request.Request(f"{supabase_url()}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(call, timeout=45) as response:
            payload = response.read().decode("utf-8")
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        try:
            parsed: object = json.loads(payload) if payload else None
        except json.JSONDecodeError:
            parsed = {"message": "non-JSON error"}
        return error.code, parsed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-initialized", action="store_true")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    status, installation = request("/rest/v1/rpc/armory_installation_info", method="POST", body=b"{}")
    if status != 200 or not isinstance(installation, dict):
        raise RuntimeError(f"Installation metadata RPC failed with HTTP {status}")
    expected = {
        "storeName": str,
        "installationId": str,
        "schemaVersion": str,
        "initialized": bool,
    }
    for field, expected_type in expected.items():
        if not isinstance(installation.get(field), expected_type):
            raise RuntimeError(f"Installation metadata field {field} is invalid")
    if args.require_initialized and not installation["initialized"]:
        raise RuntimeError("Supabase installation exists but setup is incomplete")
    if installation["schemaVersion"] != REQUIRED_SCHEMA_VERSION:
        raise RuntimeError(
            f"Supabase schema {installation['schemaVersion']} is incompatible with {REQUIRED_SCHEMA_VERSION}"
        )

    visible_rows = 0
    for table in REQUIRED_TABLES:
        identity_column = "user_id" if table == "user_preferences" else "id"
        table_status, rows = request(f"/rest/v1/{table}?select={identity_column}&limit=1")
        if table_status in (401, 403):
            continue
        if table_status != 200:
            raise RuntimeError(f"Required table {table} is unavailable (HTTP {table_status})")
        if not isinstance(rows, list):
            raise RuntimeError(f"Required table {table} returned an invalid response")
        visible_rows += len(rows)
    if visible_rows:
        raise RuntimeError("RLS failure: anonymous access returned application rows")

    print(
        "Read-only Supabase verification passed: installation metadata reachable, schema compatible, "
        f"{len(REQUIRED_TABLES)} required tables reachable, anonymous RLS returned no rows, and "
        f"setup-completed={str(installation['initialized']).lower()}."
    )


if __name__ == "__main__":
    main()
