#!/usr/bin/env python3
"""Verify lazy Supabase Auth creation for a migrated SQLite user, then clean up."""

from __future__ import annotations

import json
import os
import secrets
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import psycopg

from db_common import connection_kwargs, delete_auth_user, load_dotenv, supabase_url


ROOT = Path(__file__).resolve().parents[1]


def required(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    raise RuntimeError(f"One of {', '.join(names)} is required")


def request_json(
    path: str,
    headers: dict[str, str],
    *,
    method: str = "POST",
    body: dict[str, object] | None = None,
) -> tuple[int, object]:
    encoded = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{supabase_url()}{path}",
        data=encoded,
        method=method,
        headers={**headers, "Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = response.read().decode("utf-8")
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        try:
            parsed: object = json.loads(payload) if payload else None
        except json.JSONDecodeError:
            parsed = {"message": "non-JSON error"}
        return error.code, parsed


def remove_profile(profile_id: str) -> str | None:
    auth_user_id: str | None = None
    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select auth_user_id::text from public.users where id = %s", (profile_id,))
            row = cursor.fetchone()
            auth_user_id = str(row[0]) if row and row[0] else None
            cursor.execute("select set_config('weapon_store.restore_mode', 'on', true)")
            cursor.execute(
                "delete from public.audit_logs where user_id = %s or entity_id = %s or record_id = %s",
                (profile_id, profile_id, profile_id),
            )
            cursor.execute("delete from public.users where id = %s and not is_primary_admin", (profile_id,))
        connection.commit()
    return auth_user_id


def main() -> None:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    public_key = required("VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY")
    owner_email = required("RESET_ADMIN_EMAIL", "SUPABASE_BOOTSTRAP_EMAIL").lower()
    owner_password = required("RESET_ADMIN_PASSWORD", "SUPABASE_BOOTSTRAP_PASSWORD")
    public_headers = {"apikey": public_key}

    owner_status, owner_login = request_json(
        "/auth/v1/token?grant_type=password",
        public_headers,
        body={"email": owner_email, "password": owner_password},
    )
    if owner_status != 200 or not isinstance(owner_login, dict) or not isinstance(owner_login.get("access_token"), str):
        raise RuntimeError("Primary administrator sign-in failed")
    owner_headers = {**public_headers, "Authorization": f"Bearer {owner_login['access_token']}"}

    marker = uuid.uuid4().hex
    profile_id = f"U-MIGRATED-ACTIVATION-{marker[:12].upper()}"
    profile_name = f"Migrated Activation {marker[:10]}"
    login_email = f"migrated.{marker}@local.weapon-store.invalid"
    claimed_password = f"Migrated-{secrets.token_urlsafe(16)}-Aa1"
    created_auth_user_id: str | None = None
    try:
        with psycopg.connect(**connection_kwargs()) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select set_config('weapon_store.restore_mode', 'on', true)")
                cursor.execute(
                    "insert into public.users(" 
                    "id, auth_user_id, username, email, login_email, name, role, permissions, "
                    "password_set, activation_token_hash, activation_expires_at, is_active, is_primary_admin"
                    ") values (%s, null, %s, null, %s, %s, 'Employee', '{}'::jsonb, false, null, null, true, false)",
                    (profile_id, profile_name, login_email, profile_name),
                )
            connection.commit()

        reset_status, reset_result = request_json(
            "/rest/v1/rpc/admin_users_action",
            owner_headers,
            body={"p_request": {"action": "reset-activation", "userId": profile_id}},
        )
        if reset_status != 200 or not isinstance(reset_result, dict) or not isinstance(reset_result.get("activationCode"), str):
            raise RuntimeError(f"Migrated account activation reset failed with HTTP {reset_status}")

        claim_status, claim_result = request_json(
            "/rest/v1/rpc/claim_account",
            public_headers,
            body={
                "p_identifier": profile_name,
                "p_activation_code": reset_result["activationCode"],
                "p_password": claimed_password,
            },
        )
        if claim_status != 200 or not isinstance(claim_result, dict) or claim_result.get("loginEmail") != login_email:
            raise RuntimeError(f"Migrated account claim failed with HTTP {claim_status}")

        sign_in_status, sign_in_result = request_json(
            "/auth/v1/token?grant_type=password",
            public_headers,
            body={"email": login_email, "password": claimed_password},
        )
        if sign_in_status != 200 or not isinstance(sign_in_result, dict):
            raise RuntimeError("Migrated account could not sign in after activation")
        signed_user = sign_in_result.get("user")
        if not isinstance(signed_user, dict) or not isinstance(signed_user.get("id"), str):
            raise RuntimeError("Migrated account sign-in returned no Auth identity")
        created_auth_user_id = signed_user["id"]

        with psycopg.connect(**connection_kwargs()) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "select auth_user_id::text, password_set, activation_token_hash from public.users where id = %s",
                    (profile_id,),
                )
                row = cursor.fetchone()
                if row != (created_auth_user_id, True, None):
                    raise RuntimeError("Migrated account profile was not linked to its new Auth identity")
            connection.rollback()

        print(
            "Migrated-user activation passed: a pending SQLite user received a fresh code, "
            "created a Supabase Auth identity on claim, and signed in successfully."
        )
    finally:
        discovered_auth_id = remove_profile(profile_id)
        auth_id = created_auth_user_id or discovered_auth_id
        if auth_id:
            delete_auth_user(auth_id)
        print("Disposable migrated user, audit rows, and Auth identity removed.")


if __name__ == "__main__":
    main()
