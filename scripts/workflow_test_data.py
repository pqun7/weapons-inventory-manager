"""Rollback-only workflow prerequisites for live database verification scripts."""

from __future__ import annotations

from typing import Any


def ensure_workflow_prerequisites(cursor: Any, marker: str) -> None:
    """Insert missing master data in the caller's transaction.

    Verification scripts always roll their transaction back, so these rows never
    persist. Existing application rows remain the preferred fixtures.
    """
    suffix = marker[:12]
    cursor.execute(
        "select auth_user_id from public.users "
        "where auth_user_id is not null and is_active "
        "order by case when role = 'Admin' then 0 else 1 end, id limit 1"
    )
    actor = cursor.fetchone()
    if actor is None:
        raise RuntimeError("Rollback-only workflow fixtures require an active application user")
    cursor.execute("set local role authenticated")
    cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(actor[0]),))

    cursor.execute("select id from public.customers order by id limit 1")
    if cursor.fetchone() is None:
        cursor.execute(
            "insert into public.customers "
            "(id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) "
            "values (%s, %s, '', '', '', false, 0, current_date)",
            (f"CUS-VERIFY-{suffix}", "Rollback verification customer"),
        )

    cursor.execute(
        "select subtype.weapon_type_id, subtype.id, mapping.caliber_id "
        "from public.weapon_subtypes subtype "
        "join public.subtype_calibers mapping on mapping.subtype_id = subtype.id limit 1"
    )
    if cursor.fetchone() is None:
        weapon_type = f"WT-VERIFY-{suffix}"
        subtype = f"WST-VERIFY-{suffix}"
        caliber = f"CAL-VERIFY-{suffix}"
        cursor.execute(
            "insert into public.weapon_types (id, label, sort_order) values (%s, %s, 9999)",
            (weapon_type, f"Verification type {suffix}"),
        )
        cursor.execute(
            "insert into public.weapon_subtypes (id, weapon_type_id, label, sort_order) values (%s, %s, %s, 9999)",
            (subtype, weapon_type, f"Verification subtype {suffix}"),
        )
        cursor.execute(
            "insert into public.calibers (id, label) values (%s, %s)",
            (caliber, f"Verification caliber {suffix}"),
        )
        cursor.execute(
            "insert into public.subtype_calibers (subtype_id, caliber_id) values (%s, %s)",
            (subtype, caliber),
        )

    cursor.execute("select id from public.models order by id limit 1")
    if cursor.fetchone() is None:
        brand = f"BR-VERIFY-{suffix}"
        model = f"MDL-VERIFY-{suffix}"
        cursor.execute(
            "insert into public.brands (id, label) values (%s, %s)",
            (brand, f"Verification brand {suffix}"),
        )
        cursor.execute(
            "insert into public.models (id, label, brand_id) values (%s, %s, %s)",
            (model, f"Verification model {suffix}", brand),
        )

    cursor.execute("select id from public.storage_locations order by id limit 1")
    if cursor.fetchone() is None:
        warehouse = f"WH-VERIFY-{suffix}"
        location = f"LOC-VERIFY-{suffix}"
        cursor.execute(
            "insert into public.warehouses (id, label) values (%s, %s)",
            (warehouse, f"Rollback verification warehouse {suffix}"),
        )
        cursor.execute(
            "insert into public.storage_locations (id, warehouse_id, shelf, bin) values (%s, %s, 'VERIFY', '1')",
            (location, warehouse),
        )
