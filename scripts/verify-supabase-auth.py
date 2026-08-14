#!/usr/bin/env python3
"""Verify Supabase Auth and RLS with a disposable administrator identity."""

from __future__ import annotations

import json
import os
import secrets
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import psycopg

from db_common import connection_kwargs, create_auth_user, delete_auth_user, load_dotenv, supabase_url


ROOT = Path(__file__).resolve().parents[1]


def request_json(
    url: str,
    headers: dict[str, str],
    *,
    method: str = "GET",
    body: dict[str, object] | None = None,
) -> tuple[int, object]:
    encoded = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=encoded, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode("utf-8")
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        try:
            parsed: object = json.loads(payload) if payload else None
        except json.JSONDecodeError:
            parsed = {"error": "Non-JSON error response"}
        return error.code, parsed


def require_text(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def create_test_profile(auth_user_id: str, profile_id: str, email: str) -> None:
    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select pg_advisory_xact_lock(hashtext('armory-store-auth-rls-verification'))")
            cursor.execute("select set_config('weapon_store.restore_mode', 'on', true)")
            cursor.execute(
                "insert into public.users "
                "(id, auth_user_id, username, name, role, permissions, password_set, "
                "is_active, email, login_email, is_primary_admin) "
                "values (%s, %s, %s, 'Auth RLS Verification', 'Admin', '{}'::jsonb, true, "
                "true, %s, %s, false)",
                (profile_id, auth_user_id, email, email, email),
            )
        connection.commit()


def remove_test_profile(profile_id: str) -> None:
    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select pg_advisory_xact_lock(hashtext('armory-store-auth-rls-verification'))")
            cursor.execute("select set_config('weapon_store.restore_mode', 'on', true)")
            cursor.execute("delete from public.audit_logs where entity_id = %s", (profile_id,))
            cursor.execute("delete from public.users where id = %s and not is_primary_admin", (profile_id,))
        connection.commit()


def expected_inventory_state() -> tuple[int, int]:
    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select count(*), count(distinct serial_number) from public.weapons")
            row = cursor.fetchone()
            return int(row[0]), int(row[1])


def main() -> None:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    project_url = supabase_url()
    publishable_key = require_text("VITE_SUPABASE_ANON_KEY")
    # create_auth_user validates that the service-role key is configured.
    marker = uuid.uuid4().hex
    email = f"codex-auth-audit-{marker}@example.invalid"
    password = f"Audit-{secrets.token_urlsafe(18)}-A1"
    profile_id = f"USR-AUTH-AUDIT-{marker[:16].upper()}"
    auth_user_id: str | None = None

    public_headers = {"apikey": publishable_key, "Accept": "application/json"}
    anonymous_status, anonymous_rows = request_json(
        f"{project_url}/rest/v1/weapons?select=id&limit=1",
        public_headers,
    )
    anonymous_blocked = anonymous_status in {401, 403} or (
        anonymous_status == 200 and anonymous_rows == []
    )
    if not anonymous_blocked:
        raise RuntimeError("RLS failure: anonymous request could read weapons")

    try:
        auth_user_id = create_auth_user(email, password, "Auth RLS Verification")
        create_test_profile(auth_user_id, profile_id, email)

        login_status, login_payload = request_json(
            f"{project_url}/auth/v1/token?grant_type=password",
            {**public_headers, "Content-Type": "application/json"},
            method="POST",
            body={"email": email, "password": password},
        )
        if login_status != 200 or not isinstance(login_payload, dict):
            raise RuntimeError(f"Disposable Auth sign-in failed with HTTP {login_status}")
        access_token = login_payload.get("access_token")
        if not isinstance(access_token, str):
            raise RuntimeError("Disposable Auth sign-in did not return an access token")

        signed_headers = {**public_headers, "Authorization": f"Bearer {access_token}"}
        profile_status, profile_rows = request_json(
            f"{project_url}/rest/v1/users?select=id,role,is_active&id=eq.{profile_id}",
            signed_headers,
        )
        if profile_status != 200 or profile_rows != [
            {"id": profile_id, "role": "Admin", "is_active": True}
        ]:
            raise RuntimeError("Authenticated disposable Admin profile was not resolved")

        expected_count, expected_unique = expected_inventory_state()
        weapons_status, weapons_rows = request_json(
            f"{project_url}/rest/v1/weapons?select=id,serial_number&order=id.asc",
            signed_headers,
        )
        if weapons_status != 200 or not isinstance(weapons_rows, list):
            raise RuntimeError("Authenticated inventory read failed")
        serials = [row.get("serial_number") for row in weapons_rows if isinstance(row, dict)]
        if len(weapons_rows) != expected_count or len(set(serials)) != expected_unique:
            raise RuntimeError("Authenticated inventory did not match direct database state")

        currencies_status, currency_rows = request_json(
            f"{project_url}/rest/v1/currencies?select=iso_code,is_active&is_active=eq.true",
            signed_headers,
        )
        if currencies_status != 200 or not isinstance(currency_rows, list) or not currency_rows:
            raise RuntimeError("Authenticated currency read failed")

        print(
            "Auth/RLS verification passed: anonymous inventory blocked, disposable Admin "
            f"sign-in succeeded, {len(weapons_rows)} inventory rows matched, and "
            f"{len(currency_rows)} active currencies were readable."
        )
    finally:
        try:
            remove_test_profile(profile_id)
        finally:
            if auth_user_id:
                delete_auth_user(auth_user_id)
        print("Disposable Auth identity and application profile removed.")


if __name__ == "__main__":
    main()
