#!/usr/bin/env python3
"""Verify that the configured legacy owner can safely adopt the Supabase store."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

import psycopg

from db_common import connection_kwargs, load_dotenv, supabase_url


ROOT = Path(__file__).resolve().parents[1]


def required(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    raise RuntimeError(f"One of {', '.join(names)} is required")


def main() -> None:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    email = required("RESET_ADMIN_EMAIL", "SUPABASE_BOOTSTRAP_EMAIL").lower()
    password = required("RESET_ADMIN_PASSWORD", "SUPABASE_BOOTSTRAP_PASSWORD")
    key = required("VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY")
    request = urllib.request.Request(
        f"{supabase_url()}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode("utf-8"),
        method="POST",
        headers={"apikey": key, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error.read()
        raise RuntimeError(f"Configured primary administrator sign-in failed with HTTP {error.code}") from error
    auth_user_id = payload.get("user", {}).get("id") if isinstance(payload, dict) else None
    if not isinstance(auth_user_id, str):
        raise RuntimeError("Configured primary administrator sign-in returned no user identifier")

    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("set transaction read only")
            cursor.execute(
                "select auth_user_id::text, coalesce(login_email, email, '') "
                "from public.users where is_primary_admin and is_active"
            )
            owners = cursor.fetchall()
            if len(owners) != 1:
                raise RuntimeError("The store does not contain exactly one active primary administrator")
            if str(owners[0][0]) != auth_user_id or str(owners[0][1]).lower() != email:
                raise RuntimeError("Configured Auth owner does not match the primary application administrator")
            cursor.execute("select to_regprocedure('public.armory_installation_info()') is not null")
            if not cursor.fetchone()[0]:
                raise RuntimeError("The independent installation RPC is missing")
            cursor.execute("select exists(select 1 from pg_extension where extname = 'supabase_vault')")
            if not cursor.fetchone()[0]:
                raise RuntimeError("Supabase Vault is unavailable")
        connection.rollback()

    print(
        "Supabase owner-adoption verification passed: configured Auth credentials match the single "
        "active primary administrator, installation RPC exists, and Vault is available."
    )


if __name__ == "__main__":
    main()
