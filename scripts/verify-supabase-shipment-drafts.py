#!/usr/bin/env python3
"""Verify the installed optional-location and scheduled-draft Supabase rules."""

from pathlib import Path

import psycopg

from db_common import connection_kwargs, load_dotenv


ROOT = Path(__file__).resolve().parents[1]


def function_definition(cursor: psycopg.Cursor, signature: str) -> str:
    cursor.execute("select pg_get_functiondef(%s::regprocedure)", (signature,))
    row = cursor.fetchone()
    if not row:
        raise RuntimeError(f"Missing function: {signature}")
    return str(row[0])


def main() -> None:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    with psycopg.connect(**connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select 1 from supabase_migrations.schema_migrations where version = %s",
                ("20260815001300",),
            )
            if not cursor.fetchone():
                raise RuntimeError("Migration 20260815001300 is not installed")

            scheduled = function_definition(cursor, "public.update_scheduled_shipment(text,jsonb)")
            validation = function_definition(cursor, "public.validate_manifest_import(text)")
            review = function_definition(cursor, "public.confirm_manifest_review(jsonb)")
            arrival = function_definition(cursor, "public.confirm_manifest_arrival(text)")
            weapon_location = function_definition(cursor, "public.update_weapon_location(text,text)")

            assert "shipment contains incomplete line items" not in scheduled
            assert "if false and manifest_item.storage_location_id is null then" in validation
            assert "or item.storage_location_id is null" not in review
            assert "or item.storage_location_id is null" not in arrival
            assert "next_location_id" in weapon_location

    print("Supabase optional-location and partial-draft functions verified")


if __name__ == "__main__":
    main()
