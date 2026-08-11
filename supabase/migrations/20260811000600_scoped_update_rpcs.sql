begin;

create or replace function public.update_weapon_notes(p_weapon_id text, p_notes text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  update public.weapons set notes = coalesce(p_notes, '') where id = p_weapon_id and deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'weapon not found'; end if;
end
$$;

create or replace function public.update_weapon_location(p_weapon_id text, p_storage_location_id text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  if not exists (select 1 from public.storage_locations as sl where sl.id = p_storage_location_id) then
    raise exception using errcode = '23503', message = 'storage location not found';
  end if;
  update public.weapons set storage_location_id = p_storage_location_id where id = p_weapon_id and deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'weapon not found'; end if;
end
$$;

create or replace function public.bind_weapon_to_shipment(p_weapon_id text, p_shipment_id text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare expected_count integer; received_count integer; current_status text;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  select s.total_expected_items, s.status into expected_count, current_status
  from public.shipments as s where s.id = p_shipment_id for update;
  if expected_count is null then raise exception using errcode = 'P0002', message = 'shipment not found'; end if;
  update public.weapons set shipment_id = p_shipment_id where id = p_weapon_id and deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'weapon not found'; end if;
  select count(1) into received_count from public.weapons as w where w.shipment_id = p_shipment_id and w.deleted_at is null;
  update public.shipments set status = case
    when received_count >= expected_count then 'Arrived'
    when received_count > 0 and current_status not in ('Delayed', 'Cancelled') then 'Partial'
    else current_status end
  where id = p_shipment_id;
end
$$;

create or replace function public.set_shipment_status(p_shipment_id text, p_status text, p_notes text default '')
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; actor_name text; previous_status text;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  if p_status not in ('Pending', 'In Transit', 'Delayed', 'Arrived', 'Cancelled', 'Partial') then
    raise exception using errcode = '22023', message = 'invalid shipment status';
  end if;
  select u.id, u.name into actor_id, actor_name from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  select s.status into previous_status from public.shipments as s where s.id = p_shipment_id for update;
  if previous_status is null then raise exception using errcode = 'P0002', message = 'shipment not found'; end if;
  update public.shipments as s set status = p_status,
    actual_arrival_date = case when p_status = 'Arrived' then coalesce(s.actual_arrival_date, current_date) else s.actual_arrival_date end,
    timeline = s.timeline || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'timestamp', now(), 'status', p_status,
      'userId', actor_id, 'userName', actor_name, 'notes', coalesce(nullif(btrim(p_notes), ''), 'Status changed to ' || p_status),
      'eventType', 'StatusChanged'))
  where s.id = p_shipment_id;
end
$$;

create or replace function public.update_shipment_details(p_shipment_id text, p_patch jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; actor_name text;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  select u.id, u.name into actor_id, actor_name from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  update public.shipments as s set
    expected_arrival_date = case when p_patch ? 'expectedArrivalDate' then (p_patch ->> 'expectedArrivalDate')::date else s.expected_arrival_date end,
    purchase_order_number = case when p_patch ? 'purchaseOrderNumber' then nullif(p_patch ->> 'purchaseOrderNumber', '') else s.purchase_order_number end,
    invoice_number = case when p_patch ? 'invoiceNumber' then nullif(p_patch ->> 'invoiceNumber', '') else s.invoice_number end,
    shipping_carrier = case when p_patch ? 'shippingCarrier' then nullif(p_patch ->> 'shippingCarrier', '') else s.shipping_carrier end,
    container_number = case when p_patch ? 'containerNumber' then nullif(p_patch ->> 'containerNumber', '') else s.container_number end,
    notes = case when p_patch ? 'notes' then coalesce(p_patch ->> 'notes', '') else s.notes end,
    arrival_note = case when p_patch ? 'arrivalNote' then nullif(p_patch ->> 'arrivalNote', '') else s.arrival_note end,
    delay_reason = case when p_patch ? 'delayReason' then nullif(p_patch ->> 'delayReason', '') else s.delay_reason end,
    timeline = s.timeline || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'timestamp', now(), 'status', s.status,
      'userId', actor_id, 'userName', actor_name, 'notes', 'Shipment metadata updated',
      'eventType', 'MetadataUpdated'))
  where s.id = p_shipment_id;
  if not found then raise exception using errcode = 'P0002', message = 'shipment not found'; end if;
end
$$;

create or replace function public.add_shipment_document_metadata(p_shipment_id text, p_document jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  if nullif(p_document ->> 'id', '') is null or nullif(p_document ->> 'fileName', '') is null then
    raise exception using errcode = '22023', message = 'document id and file name are required';
  end if;
  update public.shipments as s set documents = s.documents || jsonb_build_array(p_document) where s.id = p_shipment_id;
  if not found then raise exception using errcode = 'P0002', message = 'shipment not found'; end if;
end
$$;

create or replace function public.delete_shipment_document_metadata(p_shipment_id text, p_document_id text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  update public.shipments as s set documents = coalesce((
    select jsonb_agg(document.value) from jsonb_array_elements(s.documents) as document(value)
    where document.value ->> 'id' <> p_document_id
  ), '[]'::jsonb) where s.id = p_shipment_id;
  if not found then raise exception using errcode = 'P0002', message = 'shipment not found'; end if;
end
$$;

create or replace function public.update_invoice_notes(p_invoice_id text, p_notes text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.can_view_financials() and not public.can_sell_inventory() then
    raise exception using errcode = '42501', message = 'financial permission is required';
  end if;
  update public.invoices set notes = coalesce(p_notes, '') where id = p_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'invoice not found'; end if;
end
$$;

create or replace function public.update_inventory_product(p_product_type text, p_product_id text, p_patch jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare currency_code varchar(3); snapshot jsonb; requested_price numeric;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  if p_patch ? 'price' then
    requested_price := (p_patch ->> 'price')::numeric;
    if requested_price < 0 then raise exception using errcode = '22023', message = 'price cannot be negative'; end if;
    select coalesce(upper(nullif(p_patch ->> 'priceCurrency', '')), s.currency_code) into currency_code from public.system_settings as s where s.id = 1;
    snapshot := public.currency_snapshot(currency_code);
  end if;
  if p_product_type = 'accessory' then
    update public.accessories as a set
      name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else a.name end,
      type = case when p_patch ? 'type' then coalesce(p_patch ->> 'type', '') else a.type end,
      safety_threshold = case when p_patch ? 'safetyThreshold' then (p_patch ->> 'safetyThreshold')::integer else a.safety_threshold end,
      price = coalesce(requested_price, a.price),
      price_currency = coalesce(currency_code, a.price_currency),
      price_valuation = case when requested_price is null then a.price_valuation else public.money_valuation(
        requested_price, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric,
        (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource') end,
      warehouse = case when p_patch #>> '{location,warehouse}' is not null then p_patch #>> '{location,warehouse}' else a.warehouse end,
      shelf = case when p_patch #>> '{location,shelf}' is not null then p_patch #>> '{location,shelf}' else a.shelf end,
      bin = case when p_patch #>> '{location,bin}' is not null then p_patch #>> '{location,bin}' else a.bin end
    where a.id = p_product_id;
  elsif p_product_type = 'ammunition' then
    update public.ammunition as a set
      name = case when p_patch ? 'name' then coalesce(p_patch ->> 'name', '') else a.name end,
      caliber = case when p_patch ? 'caliber' then btrim(p_patch ->> 'caliber') else a.caliber end,
      safety_threshold = case when p_patch ? 'safetyThreshold' then (p_patch ->> 'safetyThreshold')::integer else a.safety_threshold end,
      price = coalesce(requested_price, a.price), price_currency = coalesce(currency_code, a.price_currency),
      price_valuation = case when requested_price is null then a.price_valuation else public.money_valuation(
        requested_price, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric,
        (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource') end,
      warehouse = case when p_patch #>> '{location,warehouse}' is not null then p_patch #>> '{location,warehouse}' else a.warehouse end,
      shelf = case when p_patch #>> '{location,shelf}' is not null then p_patch #>> '{location,shelf}' else a.shelf end,
      bin = case when p_patch #>> '{location,bin}' is not null then p_patch #>> '{location,bin}' else a.bin end
    where a.id = p_product_id;
  else raise exception using errcode = '22023', message = 'invalid inventory product type'; end if;
  if not found then raise exception using errcode = 'P0002', message = 'inventory product not found'; end if;
end
$$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'update_weapon_notes(text,text)', 'update_weapon_location(text,text)',
    'bind_weapon_to_shipment(text,text)', 'set_shipment_status(text,text,text)',
    'update_shipment_details(text,jsonb)', 'add_shipment_document_metadata(text,jsonb)',
    'delete_shipment_document_metadata(text,text)', 'update_invoice_notes(text,text)',
    'update_inventory_product(text,text,jsonb)'
  ] loop
    execute 'revoke all on function public.' || signature || ' from public, anon';
    execute 'grant execute on function public.' || signature || ' to authenticated';
  end loop;
end
$$;

commit;
