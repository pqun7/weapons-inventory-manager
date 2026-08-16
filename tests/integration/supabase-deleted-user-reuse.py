#!/usr/bin/env python3
"""Verify that a deleted Supabase user name/email can be reused, then clean up."""

from __future__ import annotations

import uuid
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from db_common import connection_kwargs, load_dotenv


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


def admin_action(
    connection: psycopg.Connection[tuple[object, ...]],
    actor_auth_user_id: str,
    payload: dict[str, object],
) -> dict[str, object]:
    with connection.cursor() as cursor:
        cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (actor_auth_user_id,))
        cursor.execute("select public.admin_users_action(%s::jsonb)", (Jsonb(payload),))
        result = cursor.fetchone()[0]
    connection.commit()
    if not isinstance(result, dict):
        raise RuntimeError("User administration returned an invalid result")
    return result


def cleanup(profile_ids: list[str]) -> None:
    if not profile_ids:
        return
    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select auth_user_id::text from public.users where id = any(%s) and auth_user_id is not null",
                (profile_ids,),
            )
            auth_ids = [str(row[0]) for row in cursor.fetchall()]
            for auth_user_id in auth_ids:
                cursor.execute(
                    "select public.auth_admin_request('DELETE', '/' || %s, '{}'::jsonb)",
                    (auth_user_id,),
                )
            cursor.execute("select set_config('weapon_store.restore_mode', 'on', true)")
            cursor.execute(
                "delete from public.audit_logs where record_id = any(%s) or entity_id = any(%s)",
                (profile_ids, profile_ids),
            )
            cursor.execute("delete from public.users where id = any(%s) and not is_primary_admin", (profile_ids,))
        connection.commit()


def main() -> None:
    load_dotenv(ROOT / ".env.local")
    connection = psycopg.connect(**connection_kwargs())
    actor_auth_user_id = primary_auth_user_id(connection)

    marker = uuid.uuid4().hex
    name = f"Deleted Reuse {marker[:12]}"
    email = f"deleted-reuse.{marker}@example.test"
    profile_ids: list[str] = []
    try:
        first = admin_action(connection, actor_auth_user_id, {
            "action": "create",
            "user": {"name": name, "email": email, "role": "Employee", "permissions": {}},
        })
        first_id = first.get("userId")
        if not isinstance(first_id, str) or not first_id:
            raise RuntimeError("First disposable account returned no user ID")
        profile_ids.append(first_id)
        admin_action(connection, actor_auth_user_id, {"action": "delete", "userId": first_id})

        second = admin_action(connection, actor_auth_user_id, {
            "action": "create",
            "user": {"name": name, "email": email, "role": "Employee", "permissions": {}},
        })
        second_id = second.get("userId")
        if not isinstance(second_id, str) or not second_id or second_id == first_id:
            raise RuntimeError("Recreated account did not receive a new durable user ID")
        profile_ids.append(second_id)

        with connection.cursor() as cursor:
            cursor.execute(
                "select count(*) from public.users where is_active and lower(btrim(name)) = lower(btrim(%s)) and lower(email) = lower(%s)",
                (name, email),
            )
            if int(cursor.fetchone()[0]) != 1:
                raise RuntimeError("Exactly one active recreated profile was expected")
        connection.rollback()

        admin_action(connection, actor_auth_user_id, {"action": "delete", "userId": second_id})
        print("Deleted-user identity reuse passed for name, email, Auth cleanup, and server-generated IDs.")
    finally:
        connection.close()
        cleanup(profile_ids)


if __name__ == "__main__":
    main()
