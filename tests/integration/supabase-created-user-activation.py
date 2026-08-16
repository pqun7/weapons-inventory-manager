#!/usr/bin/env python3
"""Verify first-login activation for a normally created Supabase user."""

from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from db_common import connection_kwargs, load_dotenv, supabase_url


def required(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    raise RuntimeError(f"One of {', '.join(names)} is required")


def request_json(path: str, headers: dict[str, str], body: dict[str, object]) -> tuple[int, object]:
    request = urllib.request.Request(
        f"{supabase_url()}{path}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
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
            parsed = {"message": payload or str(error.reason)}
        return error.code, parsed


def error_message(payload: object) -> str:
    if isinstance(payload, dict):
        for key in ("message", "msg", "error_description", "hint"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return "unknown provider response"


def primary_auth_user_id(connection: psycopg.Connection[tuple[object, ...]]) -> str:
    with connection.cursor() as cursor:
        cursor.execute(
            "select auth_user_id::text from public.users "
            "where is_primary_admin and is_active and auth_user_id is not null",
        )
        rows = cursor.fetchall()
    connection.rollback()
    if len(rows) != 1:
        raise RuntimeError("Exactly one active primary administrator is required")
    return str(rows[0][0])


def cleanup(profile_id: str) -> None:
    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select auth_user_id::text from public.users where id = %s", (profile_id,))
            row = cursor.fetchone()
            if row and row[0]:
                cursor.execute(
                    "select public.auth_admin_request('DELETE', '/' || %s, '{}'::jsonb)",
                    (str(row[0]),),
                )
            cursor.execute("select set_config('weapon_store.restore_mode', 'on', true)")
            cursor.execute(
                "delete from public.audit_logs where user_id = %s or entity_id = %s or record_id = %s",
                (profile_id, profile_id, profile_id),
            )
            cursor.execute("delete from public.users where id = %s and not is_primary_admin", (profile_id,))
        connection.commit()


def main() -> None:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    public_key = required("VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY")
    headers = {"apikey": public_key}
    marker = uuid.uuid4().hex
    name = f"test-{marker[:10]}"
    password = f"Test-{secrets.token_urlsafe(18)}-Aa1"
    profile_id = ""

    connection = psycopg.connect(**connection_kwargs())
    try:
        actor_auth_user_id = primary_auth_user_id(connection)
        with connection.cursor() as cursor:
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (actor_auth_user_id,))
            cursor.execute(
                "select public.admin_users_action(%s::jsonb)",
                (Jsonb({
                    "action": "create",
                    "user": {"name": name, "email": None, "role": "Employee", "permissions": {}},
                }),),
            )
            created = cursor.fetchone()[0]
        connection.commit()
        if not isinstance(created, dict):
            raise RuntimeError("User administration returned an invalid create response")
        profile_id = created.get("userId") if isinstance(created.get("userId"), str) else ""
        activation_code = created.get("activationCode") if isinstance(created.get("activationCode"), str) else ""
        if not profile_id or not activation_code:
            raise RuntimeError("Created user returned no durable ID or activation code")

        with connection.cursor() as cursor:
            cursor.execute(
                "select auth_user_id::text, login_email from public.users where id = %s",
                (profile_id,),
            )
            created_profile = cursor.fetchone()
        connection.rollback()
        if not created_profile or not created_profile[0] or not created_profile[1]:
            raise RuntimeError("Created profile was not linked to its initial Auth identity")
        auth_user_id, login_email = str(created_profile[0]), str(created_profile[1])

        claim_status, claim_result = request_json(
            "/rest/v1/rpc/claim_account",
            headers,
            {
                "p_identifier": name,
                "p_activation_code": activation_code,
                "p_password": password,
            },
        )
        if claim_status != 200 or not isinstance(claim_result, dict) or claim_result.get("loginEmail") != login_email:
            raise RuntimeError(
                f"Created account claim failed with HTTP {claim_status}: {error_message(claim_result)}"
            )

        sign_in_status, sign_in_result = request_json(
            "/auth/v1/token?grant_type=password",
            headers,
            {"email": login_email, "password": password},
        )
        signed_user = sign_in_result.get("user") if isinstance(sign_in_result, dict) else None
        if sign_in_status != 200 or not isinstance(signed_user, dict) or signed_user.get("id") != auth_user_id:
            raise RuntimeError(
                f"Created account could not sign in after activation: {error_message(sign_in_result)}"
            )

        with connection.cursor() as cursor:
            cursor.execute(
                "select auth_user_id::text, password_set, activation_token_hash, activation_expires_at "
                "from public.users where id = %s",
                (profile_id,),
            )
            activated = cursor.fetchone()
        connection.rollback()
        if activated != (auth_user_id, True, None, None):
            raise RuntimeError("Activated profile state is inconsistent")

        print(
            "Created-user activation passed for a name-only account: Auth PUT update, "
            "password setup, profile state, and sign-in were verified."
        )
    finally:
        connection.close()
        if profile_id:
            cleanup(profile_id)
            print("Disposable created user, Auth identity, and audit rows removed.")


if __name__ == "__main__":
    main()
