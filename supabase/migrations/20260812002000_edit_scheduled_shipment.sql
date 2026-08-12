begin;

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
  select s.* into shipment_row from public.shipments as s where s.id = p_shipment_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'shipment not found'; end if;
  if shipment_row.workflow_status <> 'scheduled' or shipment_row.status in ('Arrived', 'Cancelled') then
    raise exception using errcode = '23514', message = 'only scheduled shipments can be edited';
  end if;

  next_number := case when p_patch ? 'shipmentNumber' then btrim(p_patch ->> 'shipmentNumber') else shipment_row.shipment_number end;
  next_lines := case when p_patch ? 'lineItems' then p_patch -> 'lineItems' else shipment_row.line_items end;
  if nullif(next_number, '') is null then raise exception using errcode = '22023', message = 'shipment number is required'; end if;
  if exists (select 1 from public.shipments as s where s.shipment_number = next_number and s.id <> p_shipment_id) then
    raise exception using errcode = '23505', message = 'shipment number already exists';
  end if;
  if jsonb_typeof(next_lines) <> 'array' or jsonb_array_length(next_lines) = 0 then
    raise exception using errcode = '22023', message = 'at least one shipment line item is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(next_lines) as line(value)
    where line.value ->> 'productType' not in ('weapon', 'accessory', 'ammunition')
      or coalesce((line.value ->> 'quantity')::integer, 0) <= 0
      or coalesce((line.value ->> 'purchasePrice')::numeric, 0) < 0
      or (line.value ->> 'productType' = 'weapon' and (
        nullif(line.value ->> 'weaponTypeId', '') is null
        or nullif(line.value ->> 'weaponSubtypeId', '') is null
        or nullif(line.value ->> 'brandId', '') is null
        or nullif(line.value ->> 'modelId', '') is null
        or nullif(line.value ->> 'caliberId', '') is null
        or jsonb_array_length(coalesce(line.value -> 'serialNumbers', '[]'::jsonb)) <> (line.value ->> 'quantity')::integer
      ))
  ) then raise exception using errcode = '22023', message = 'shipment contains incomplete line items'; end if;
  select coalesce(sum((line.value ->> 'quantity')::integer), 0) into next_total
  from jsonb_array_elements(next_lines) as line(value);
  perform public.currency_snapshot(coalesce(upper(nullif(p_patch ->> 'currency', '')), shipment_row.currency));
  select u.id, u.name into actor_id, actor_name from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;

  update public.shipments as s set
    shipment_number = next_number,
    supplier_id = case when p_patch ? 'supplierId' then p_patch ->> 'supplierId' else s.supplier_id end,
    shipment_date = case when p_patch ? 'shipmentDate' then (p_patch ->> 'shipmentDate')::date else s.shipment_date end,
    expected_arrival_date = case when p_patch ? 'expectedArrivalDate' then (p_patch ->> 'expectedArrivalDate')::date else s.expected_arrival_date end,
    purchase_order_number = case when p_patch ? 'purchaseOrderNumber' then nullif(p_patch ->> 'purchaseOrderNumber', '') else s.purchase_order_number end,
    invoice_number = case when p_patch ? 'invoiceNumber' then nullif(p_patch ->> 'invoiceNumber', '') else s.invoice_number end,
    shipping_carrier = case when p_patch ? 'shippingCarrier' then nullif(p_patch ->> 'shippingCarrier', '') else s.shipping_carrier end,
    container_number = case when p_patch ? 'containerNumber' then nullif(p_patch ->> 'containerNumber', '') else s.container_number end,
    currency = case when p_patch ? 'currency' then upper(p_patch ->> 'currency') else s.currency end,
    purchase_date = case when p_patch ? 'purchaseDate' then nullif(p_patch ->> 'purchaseDate', '')::date else s.purchase_date end,
    notes = case when p_patch ? 'notes' then coalesce(p_patch ->> 'notes', '') else s.notes end,
    line_items = next_lines,
    planned_costs = case when p_patch ? 'additionalCosts' then p_patch -> 'additionalCosts' else s.planned_costs end,
    total_expected_items = next_total,
    timeline = s.timeline || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'timestamp', now(), 'status', s.status,
      'userId', actor_id, 'userName', actor_name, 'notes', 'Shipment information and contents updated',
      'eventType', 'ContentsUpdated'
    ))
  where s.id = p_shipment_id;

  if shipment_row.import_id is not null then
    update public.shipment_imports as i set
      shipment_number = next_number,
      supplier_id = case when p_patch ? 'supplierId' then p_patch ->> 'supplierId' else i.supplier_id end,
      shipment_date = case when p_patch ? 'shipmentDate' then (p_patch ->> 'shipmentDate')::date else i.shipment_date end,
      expected_arrival_date = case when p_patch ? 'expectedArrivalDate' then (p_patch ->> 'expectedArrivalDate')::date else i.expected_arrival_date end,
      currency = case when p_patch ? 'currency' then upper(p_patch ->> 'currency') else i.currency end,
      updated_at = now()
    where i.id = shipment_row.import_id;
  end if;
end
$$;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.receive_scheduled_shipment(text)'::regprocedure) into definition;
  patched := replace(
    definition,
    'if scheduled_row.import_id is not null then' || chr(10) || '    return public.confirm_manifest_arrival(scheduled_row.import_id);' || chr(10) || '  end if;',
    ''
  );
  patched := replace(
    patched,
    'update public.shipments as s set timeline = scheduled_row.timeline || s.timeline, documents = scheduled_row.documents where s.id = received_shipment_id;',
    'update public.shipments as s set timeline = scheduled_row.timeline || s.timeline, documents = scheduled_row.documents, import_id = scheduled_row.import_id where s.id = received_shipment_id; if scheduled_row.import_id is not null then update public.shipment_imports as i set status = ''received'', shipment_id = received_shipment_id, updated_at = now() where i.id = scheduled_row.import_id; end if;'
  );
  if patched = definition then
    raise exception 'receive_scheduled_shipment editable contents patch did not match the installed function';
  end if;
  execute patched;
end
$$;

revoke all on function public.update_scheduled_shipment(text, jsonb) from public, anon;
revoke all on function public.receive_scheduled_shipment(text) from public, anon;
grant execute on function public.update_scheduled_shipment(text, jsonb) to authenticated;
grant execute on function public.receive_scheduled_shipment(text) to authenticated;

commit;
