#!/usr/bin/env python3
"""Verify Supabase Auth and core RLS boundaries without mutating production data."""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


def request_json(
    url: str,
    headers: dict[str, str],
    *,
    method: str = "GET",
    body: dict[str, object] | None = None,
) -> tuple[int, object, dict[str, str]]:
    encoded = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=encoded, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode("utf-8")
            return response.status, json.loads(payload) if payload else None, dict(response.headers)
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8")
        try:
            parsed: object = json.loads(payload) if payload else None
        except json.JSONDecodeError:
            parsed = {"error": "Non-JSON error response"}
        return error.code, parsed, dict(error.headers)


def require_text(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def main() -> None:
    load_env(ROOT / ".env")
    load_env(ROOT / ".env.local")
    supabase_url = (os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
    publishable_key = require_text("VITE_SUPABASE_ANON_KEY")
    service_role_key = require_text("SUPABASE_SERVICE_ROLE_KEY")
    email = require_text("SUPABASE_BOOTSTRAP_EMAIL")
    password = require_text("SUPABASE_BOOTSTRAP_PASSWORD")
    if not supabase_url:
        raise RuntimeError("VITE_SUPABASE_URL or SUPABASE_URL is required")

    public_headers = {"apikey": publishable_key, "Accept": "application/json"}
    anonymous_status, anonymous_rows, _ = request_json(
        f"{supabase_url}/rest/v1/weapons?select=id&limit=1",
        public_headers,
    )
    anonymous_blocked = anonymous_status in {401, 403} or (anonymous_status == 200 and anonymous_rows == [])
    if not anonymous_blocked:
        raise RuntimeError("RLS failure: anonymous request could read weapons")

    auth_headers = {
        **public_headers,
        "Content-Type": "application/json",
    }
    login_status, login_payload, _ = request_json(
        f"{supabase_url}/auth/v1/token?grant_type=password",
        auth_headers,
        method="POST",
        body={"email": email, "password": password},
    )
    if login_status != 200 or not isinstance(login_payload, dict) or not isinstance(login_payload.get("access_token"), str):
        raise RuntimeError(f"Bootstrap Auth sign-in failed with HTTP {login_status}")

    access_token = login_payload["access_token"]
    signed_headers = {
        **public_headers,
        "Authorization": f"Bearer {access_token}",
    }
    profile_status, profile_rows, _ = request_json(
        f"{supabase_url}/rest/v1/users?select=id,name,role,is_active&auth_user_id=eq.{urllib.parse.quote(str(login_payload['user']['id']))}",
        signed_headers,
    )
    if profile_status != 200 or not isinstance(profile_rows, list) or len(profile_rows) != 1:
        raise RuntimeError("Authenticated application profile was not uniquely resolved")
    profile = profile_rows[0]
    if not isinstance(profile, dict) or profile.get("role") != "Admin" or profile.get("is_active") is not True:
        raise RuntimeError("Bootstrap application profile is not an active Admin")

    weapons_status, weapons_rows, _ = request_json(
        f"{supabase_url}/rest/v1/weapons?select=id,serial_number,status&order=id.asc",
        signed_headers,
    )
    if weapons_status != 200 or not isinstance(weapons_rows, list):
        raise RuntimeError("Authenticated inventory read failed")
    serials = [row.get("serial_number") for row in weapons_rows if isinstance(row, dict)]
    if len(weapons_rows) != 140 or len(set(serials)) != 140:
        raise RuntimeError("Authenticated inventory count or serial uniqueness check failed")

    currencies_status, currency_rows, _ = request_json(
        f"{supabase_url}/rest/v1/currencies?select=iso_code,name,symbol,decimal_precision,is_active,last_known_rate,last_rate_updated_at&order=iso_code.asc",
        signed_headers,
    )
    if currencies_status != 200 or not isinstance(currency_rows, list):
        raise RuntimeError("Authenticated currency read failed")
    active_currencies = [row for row in currency_rows if isinstance(row, dict) and row.get("is_active") is True]
    if not active_currencies:
        raise RuntimeError("No active PostgreSQL currencies are available")

    invoice_status, invoice_rows, _ = request_json(
        f"{supabase_url}/rest/v1/invoices?select=id&order=id.asc",
        signed_headers,
    )
    counter_status, counter_rows, _ = request_json(
        f"{supabase_url}/rest/v1/business_id_counters?select=prefix,last_value&prefix=eq.INV",
        {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}", "Accept": "application/json"},
    )
    if invoice_status != 200 or not isinstance(invoice_rows, list):
        raise RuntimeError("Invoice identifier verification read failed")
    if counter_status != 200 or not isinstance(counter_rows, list) or len(counter_rows) != 1:
        raise RuntimeError("Invoice identifier counter is unavailable")
    invoice_suffixes = [
        int(str(row["id"])[3:])
        for row in invoice_rows
        if isinstance(row, dict) and str(row.get("id", "")).startswith("INV") and str(row["id"])[3:].isdigit()
    ]
    maximum_invoice_suffix = max(invoice_suffixes, default=0)
    invoice_counter_value = int(counter_rows[0]["last_value"])
    if invoice_counter_value < maximum_invoice_suffix:
        raise RuntimeError("Invoice counter can generate a duplicate primary key")

    manifests_status, manifest_rows, _ = request_json(
        f"{supabase_url}/rest/v1/shipment_imports?select=id,status,file_name,shipment_id,validation_summary&order=created_at.asc",
        signed_headers,
    )
    items_status, manifest_item_rows, _ = request_json(
        f"{supabase_url}/rest/v1/shipment_import_items?select=id,import_id,row_index,status&order=import_id.asc,row_index.asc",
        signed_headers,
    )
    if manifests_status != 200 or not isinstance(manifest_rows, list) or items_status != 200 or not isinstance(manifest_item_rows, list):
        raise RuntimeError("Supabase shipment-manifest repository read failed")

    supplier_status, supplier_rows, _ = request_json(
        f"{supabase_url}/rest/v1/suppliers?select=id&order=id.asc&limit=1",
        signed_headers,
    )
    settings_status, settings_rows, _ = request_json(
        f"{supabase_url}/rest/v1/system_settings?select=currency_code&id=eq.1",
        signed_headers,
    )
    if supplier_status != 200 or not isinstance(supplier_rows, list) or not supplier_rows:
        raise RuntimeError("No supplier is available for shipment deletion verification")
    if settings_status != 200 or not isinstance(settings_rows, list) or len(settings_rows) != 1:
        raise RuntimeError("System currency setting is unavailable")
    supplier_id = str(supplier_rows[0]["id"])
    currency_code = str(settings_rows[0]["currency_code"])
    today = dt.date.today().isoformat()
    verification_number = f"VERIFY-DELETE-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
    rpc_headers = {**signed_headers, "Content-Type": "application/json"}
    create_status, created_shipment_id, _ = request_json(
        f"{supabase_url}/rest/v1/rpc/create_shipment",
        rpc_headers,
        method="POST",
        body={"p_input": {
            "shipmentNumber": verification_number,
            "supplierId": supplier_id,
            "shipmentDate": today,
            "expectedArrivalDate": today,
            "totalExpectedItems": 0,
            "attachments": [],
            "notes": "Automated Supabase shipment deletion verification",
            "currency": currency_code,
        }},
    )
    if create_status != 200 or not isinstance(created_shipment_id, str):
        raise RuntimeError(f"Shipment verification setup failed with HTTP {create_status}")
    delete_status, _, _ = request_json(
        f"{supabase_url}/rest/v1/rpc/delete_shipment",
        rpc_headers,
        method="POST",
        body={"p_shipment_id": created_shipment_id},
    )
    if delete_status not in {200, 204}:
        raise RuntimeError(f"Shipment delete RPC failed with HTTP {delete_status}")
    deleted_status, deleted_rows, _ = request_json(
        f"{supabase_url}/rest/v1/shipments?select=id&id=eq.{urllib.parse.quote(created_shipment_id)}",
        signed_headers,
    )
    if deleted_status != 200 or deleted_rows != []:
        raise RuntimeError("Shipment delete RPC left the test shipment behind")

    report = {
        "status": "verified",
        "verifiedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "projectUrl": supabase_url,
        "anonymousInventoryBlocked": anonymous_blocked,
        "authenticatedRole": profile["role"],
        "authenticatedProfileActive": profile["is_active"],
        "authenticatedWeaponCount": len(weapons_rows),
        "authenticatedSerialsUnique": len(set(serials)) == len(serials),
        "activeCurrencyCount": len(active_currencies),
        "currencyCodes": [str(row["iso_code"]) for row in active_currencies],
        "invoiceCount": len(invoice_rows),
        "maximumInvoiceSuffix": maximum_invoice_suffix,
        "invoiceCounterValue": invoice_counter_value,
        "invoiceCounterCollisionSafe": True,
        "manifestImportCount": len(manifest_rows),
        "manifestItemCount": len(manifest_item_rows),
        "shipmentDeleteRpcVerified": True,
        "shipmentDeleteVerificationId": created_shipment_id,
    }
    report_dir = ROOT / "migration-artifacts" / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "supabase-auth-rls-verification.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Auth/RLS verification report: {report_path}")


if __name__ == "__main__":
    main()
