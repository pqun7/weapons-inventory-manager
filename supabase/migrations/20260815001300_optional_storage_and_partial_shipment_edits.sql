begin;

-- A weapon may intentionally remain unassigned to a physical location.
create or replace function public.update_weapon_location(p_weapon_id text, p_storage_location_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  next_location_id text := nullif(btrim(p_storage_location_id), '');
begin
  if not public.can_change_inventory() then
    raise exception using errcode = '42501', message = 'inventory permission is required';
  end if;
  if next_location_id is not null
    and not exists (select 1 from public.storage_locations as location where location.id = next_location_id) then
    raise exception using errcode = '23503', message = 'storage location not found';
  end if;
  update public.weapons
  set storage_location_id = next_location_id
  where id = p_weapon_id and deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'weapon not found'; end if;
end
$$;

-- Scheduled shipments are drafts. Keep any row values the user has entered,
-- even when the row is not ready for inventory receipt yet.
create or replace function public.update_scheduled_shipment(p_shipment_id text, p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  shipment_row public.shipments%rowtype;
  actor_id text;
  actor_name text;
  next_number text;
  next_lines jsonb;
  next_total integer;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment edit permission is required';
  end if;
  select shipment.* into shipment_row
  from public.shipments as shipment
  where shipment.id = p_shipment_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'shipment not found'; end if;
  if shipment_row.workflow_status <> 'scheduled' or shipment_row.status in ('Arrived', 'Cancelled') then
    raise exception using errcode = '23514', message = 'only scheduled shipments can be edited';
  end if;

  next_number := case when p_patch ? 'shipmentNumber' then btrim(p_patch ->> 'shipmentNumber') else shipment_row.shipment_number end;
  next_lines := case when p_patch ? 'lineItems' then p_patch -> 'lineItems' else shipment_row.line_items end;
  if nullif(next_number, '') is null then raise exception using errcode = '22023', message = 'shipment number is required'; end if;
  if exists (select 1 from public.shipments as shipment where shipment.shipment_number = next_number and shipment.id <> p_shipment_id) then
    raise exception using errcode = '23505', message = 'shipment number already exists';
  end if;
  if jsonb_typeof(next_lines) <> 'array' or jsonb_array_length(next_lines) = 0 then
    raise exception using errcode = '22023', message = 'at least one shipment line item is required';
  end if;
  select coalesce(sum(
    case
      when line.value ->> 'quantity' ~ '^[0-9]+$' then greatest((line.value ->> 'quantity')::integer, 0)
      else 0
    end
  ), 0)::integer
  into next_total
  from jsonb_array_elements(next_lines) as line(value);
  perform public.currency_snapshot(coalesce(upper(nullif(p_patch ->> 'currency', '')), shipment_row.currency));
  select app_user.id, app_user.name into actor_id, actor_name
  from public.users as app_user
  where app_user.auth_user_id = auth.uid() and app_user.is_active
  limit 1;

  update public.shipments as shipment set
    shipment_number = next_number,
    supplier_id = case when p_patch ? 'supplierId' then p_patch ->> 'supplierId' else shipment.supplier_id end,
    shipment_date = case when p_patch ? 'shipmentDate' then (p_patch ->> 'shipmentDate')::date else shipment.shipment_date end,
    expected_arrival_date = case when p_patch ? 'expectedArrivalDate' then (p_patch ->> 'expectedArrivalDate')::date else shipment.expected_arrival_date end,
    purchase_order_number = case when p_patch ? 'purchaseOrderNumber' then nullif(p_patch ->> 'purchaseOrderNumber', '') else shipment.purchase_order_number end,
    invoice_number = case when p_patch ? 'invoiceNumber' then nullif(p_patch ->> 'invoiceNumber', '') else shipment.invoice_number end,
    shipping_carrier = case when p_patch ? 'shippingCarrier' then nullif(p_patch ->> 'shippingCarrier', '') else shipment.shipping_carrier end,
    container_number = case when p_patch ? 'containerNumber' then nullif(p_patch ->> 'containerNumber', '') else shipment.container_number end,
    currency = case when p_patch ? 'currency' then upper(p_patch ->> 'currency') else shipment.currency end,
    purchase_date = case when p_patch ? 'purchaseDate' then nullif(p_patch ->> 'purchaseDate', '')::date else shipment.purchase_date end,
    notes = case when p_patch ? 'notes' then coalesce(p_patch ->> 'notes', '') else shipment.notes end,
    line_items = next_lines,
    planned_costs = case when p_patch ? 'additionalCosts' then p_patch -> 'additionalCosts' else shipment.planned_costs end,
    total_expected_items = next_total,
    timeline = shipment.timeline || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'timestamp', now(), 'status', shipment.status,
      'userId', actor_id, 'userName', actor_name, 'notes', 'Shipment draft and contents updated',
      'eventType', 'ContentsUpdated'
    ))
  where shipment.id = p_shipment_id;

  if shipment_row.import_id is not null then
    update public.shipment_imports as manifest set
      shipment_number = next_number,
      supplier_id = case when p_patch ? 'supplierId' then p_patch ->> 'supplierId' else manifest.supplier_id end,
      shipment_date = case when p_patch ? 'shipmentDate' then (p_patch ->> 'shipmentDate')::date else manifest.shipment_date end,
      expected_arrival_date = case when p_patch ? 'expectedArrivalDate' then (p_patch ->> 'expectedArrivalDate')::date else manifest.expected_arrival_date end,
      currency = case when p_patch ? 'currency' then upper(p_patch ->> 'currency') else manifest.currency end,
      updated_at = now()
    where manifest.id = shipment_row.import_id;
  end if;
end
$$;

-- Remove the obsolete location-only receipt blockers from the installed
-- manifest functions while preserving all later serial/conflict fixes.
do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.validate_manifest_import(text)'::regprocedure) into definition;
  patched := replace(
    definition,
    'if manifest_item.storage_location_id is null then',
    'if false and manifest_item.storage_location_id is null then'
  );
  if patched = definition then raise exception 'validate_manifest_import location patch did not match'; end if;
  execute patched;

  select pg_get_functiondef('public.confirm_manifest_review(jsonb)'::regprocedure) into definition;
  patched := replace(definition, ' or item.storage_location_id is null', '');
  patched := replace(patched, 'complete purchase price, location, and weapon classifications before inventory receipt', 'complete purchase price and weapon classifications before inventory receipt');
  if patched = definition then raise exception 'confirm_manifest_review location patch did not match'; end if;
  execute patched;

  select pg_get_functiondef('public.confirm_manifest_arrival(text)'::regprocedure) into definition;
  patched := replace(definition, ' or item.storage_location_id is null', '');
  patched := replace(patched, 'complete purchase price, location, and weapon classifications before inventory receipt', 'complete purchase price and weapon classifications before inventory receipt');
  if patched = definition then raise exception 'confirm_manifest_arrival location patch did not match'; end if;
  execute patched;
end
$$;

revoke all on function public.update_weapon_location(text, text) from public, anon;
revoke all on function public.update_scheduled_shipment(text, jsonb) from public, anon;
grant execute on function public.update_weapon_location(text, text) to authenticated;
grant execute on function public.update_scheduled_shipment(text, jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
