begin;

create or replace function public.bulk_intake_weapons(p_input jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  actor_name text;
  serial_value text;
  normalized_serial text;
  duplicates jsonb := '[]'::jsonb;
  added_count integer := 0;
  weapon_id text;
  currency_code varchar(3);
  snapshot jsonb;
  movement jsonb;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  select u.id, u.name into actor_id, actor_name from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  if actor_id is null then raise exception using errcode = '42501', message = 'authenticated application user is required'; end if;
  if jsonb_typeof(p_input -> 'serialNumbers') <> 'array' or jsonb_array_length(p_input -> 'serialNumbers') = 0 then
    raise exception using errcode = '22023', message = 'at least one serial number is required';
  end if;
  if not exists (
    select 1 from public.weapon_subtypes as ws
    where ws.id = p_input ->> 'weaponSubtypeId' and ws.weapon_type_id = p_input ->> 'weaponTypeId'
  ) then raise exception using errcode = '23503', message = 'weapon type and subtype are incompatible'; end if;
  if not exists (
    select 1 from public.subtype_calibers as sc
    where sc.subtype_id = p_input ->> 'weaponSubtypeId' and sc.caliber_id = p_input ->> 'caliberId'
  ) then raise exception using errcode = '23503', message = 'weapon subtype and caliber are incompatible'; end if;
  if not exists (
    select 1 from public.models as m
    where m.id = p_input ->> 'modelId' and m.brand_id = p_input ->> 'brandId'
  ) then raise exception using errcode = '23503', message = 'weapon brand and model are incompatible'; end if;
  if not exists (select 1 from public.storage_locations as sl where sl.id = p_input ->> 'storageLocationId') then
    raise exception using errcode = '23503', message = 'storage location not found';
  end if;
  if not exists (select 1 from public.suppliers as s where s.id = p_input ->> 'supplierId') then
    raise exception using errcode = '23503', message = 'supplier not found';
  end if;
  if nullif(p_input ->> 'shipmentId', '') is not null and not exists (
    select 1 from public.shipments as s where s.id = p_input ->> 'shipmentId'
  ) then raise exception using errcode = '23503', message = 'shipment not found'; end if;
  if (p_input ->> 'purchasePrice')::numeric < 0 or (p_input ->> 'retailPrice')::numeric < 0 or (p_input ->> 'wholesalePrice')::numeric < 0 then
    raise exception using errcode = '22023', message = 'weapon prices cannot be negative';
  end if;

  select coalesce(upper(nullif(btrim(p_input ->> 'currency'), '')), s.currency_code) into currency_code
  from public.system_settings as s where s.id = 1;
  snapshot := public.currency_snapshot(currency_code);

  for serial_value in select value #>> '{}' from jsonb_array_elements(p_input -> 'serialNumbers') loop
    normalized_serial := upper(btrim(serial_value));
    if normalized_serial = '' then raise exception using errcode = '22023', message = 'serial number cannot be empty'; end if;
    if exists (select 1 from public.weapons as w where upper(w.serial_number) = normalized_serial) then
      duplicates := duplicates || jsonb_build_array(normalized_serial);
      continue;
    end if;
    weapon_id := public.next_business_id('W');
    movement := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'timestamp', now(), 'fromStatus', null,
      'toStatus', 'Available', 'userId', actor_id, 'userName', actor_name,
      'reason', 'Initial inventory intake'
    ));
    insert into public.weapons (
      id, serial_number, weapon_type_id, weapon_subtype_id, brand_id, model_id,
      caliber_id, storage_location_id, supplier_id, shipment_id, condition, status,
      purchase_price, retail_price, wholesale_price, actual_final_price, date_added,
      batch_id, notes, images, movement_history, purchase_price_valuation,
      retail_price_valuation, wholesale_price_valuation
    ) values (
      weapon_id, normalized_serial, p_input ->> 'weaponTypeId', p_input ->> 'weaponSubtypeId',
      p_input ->> 'brandId', p_input ->> 'modelId', p_input ->> 'caliberId',
      p_input ->> 'storageLocationId', p_input ->> 'supplierId', nullif(p_input ->> 'shipmentId', ''),
      coalesce(nullif(p_input ->> 'condition', ''), 'Excellent'), 'Available',
      (p_input ->> 'purchasePrice')::numeric, (p_input ->> 'retailPrice')::numeric,
      (p_input ->> 'wholesalePrice')::numeric, null, current_date,
      null, coalesce(p_input ->> 'notes', ''), '[]'::jsonb, movement,
      public.money_valuation((p_input ->> 'purchasePrice')::numeric, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      public.money_valuation((p_input ->> 'retailPrice')::numeric, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      public.money_valuation((p_input ->> 'wholesalePrice')::numeric, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource')
    );
    insert into public.inventory_transactions (
      id, item_type, item_id, transaction_type, quantity_delta, unit_amount,
      currency, valuation, shipment_id, notes, created_by
    ) values (
      public.next_business_id('ITX'), 'weapon', weapon_id, 'receipt', 1,
      (p_input ->> 'purchasePrice')::numeric, currency_code,
      public.money_valuation((p_input ->> 'purchasePrice')::numeric, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      nullif(p_input ->> 'shipmentId', ''), coalesce(p_input ->> 'notes', ''), actor_id
    );
    perform public.replace_product_costs('weapon', weapon_id, coalesce(p_input -> 'additionalCosts', '[]'::jsonb));
    added_count := added_count + 1;
  end loop;

  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (public.next_business_id('LOG'), now(), current_date, actor_id, 'Intake',
    format('%s weapon(s) added to inventory', added_count),
    jsonb_build_object('added', added_count, 'duplicates', duplicates));
  return jsonb_build_object('added', added_count, 'duplicates', duplicates);
end
$$;

create or replace function public.create_shipment(p_input jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  actor_name text;
  shipment_id text;
  currency_code varchar(3);
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  select u.id, u.name into actor_id, actor_name from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  if nullif(btrim(p_input ->> 'shipmentNumber'), '') is null then raise exception using errcode = '22023', message = 'shipment number is required'; end if;
  if exists (select 1 from public.shipments as s where s.shipment_number = btrim(p_input ->> 'shipmentNumber')) then raise exception using errcode = '23505', message = 'shipment number already exists'; end if;
  if not exists (select 1 from public.suppliers as s where s.id = p_input ->> 'supplierId') then raise exception using errcode = '23503', message = 'supplier not found'; end if;
  if (p_input ->> 'totalExpectedItems')::integer < 0 then raise exception using errcode = '22023', message = 'expected item count cannot be negative'; end if;
  select coalesce(upper(nullif(btrim(p_input ->> 'currency'), '')), s.currency_code) into currency_code from public.system_settings as s where s.id = 1;
  perform public.currency_snapshot(currency_code);
  shipment_id := public.next_business_id('SHP');
  insert into public.shipments (
    id, shipment_number, supplier_id, shipment_date, expected_arrival_date,
    total_expected_items, attachments, notes, status, timeline, purchase_order_number,
    invoice_number, shipping_carrier, container_number, currency, purchase_date,
    actual_arrival_date, line_items, documents, workflow_status
  ) values (
    shipment_id, btrim(p_input ->> 'shipmentNumber'), p_input ->> 'supplierId',
    (p_input ->> 'shipmentDate')::date, (p_input ->> 'expectedArrivalDate')::date,
    (p_input ->> 'totalExpectedItems')::integer, coalesce(p_input -> 'attachments', '[]'::jsonb),
    coalesce(p_input ->> 'notes', ''), 'Pending',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'timestamp', now(), 'status', 'Pending', 'userId', actor_id, 'userName', actor_name, 'notes', 'Shipment created', 'eventType', 'ShipmentCreated')),
    nullif(p_input ->> 'purchaseOrderNumber', ''), nullif(p_input ->> 'invoiceNumber', ''),
    nullif(p_input ->> 'shippingCarrier', ''), nullif(p_input ->> 'containerNumber', ''),
    currency_code, nullif(p_input ->> 'purchaseDate', '')::date,
    nullif(p_input ->> 'actualArrivalDate', '')::date, coalesce(p_input -> 'lineItems', '[]'::jsonb),
    '[]'::jsonb, 'draft'
  );
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (public.next_business_id('LOG'), now(), current_date, actor_id, 'Shipment', 'Shipment created - ' || btrim(p_input ->> 'shipmentNumber'), jsonb_build_object('shipmentId', shipment_id));
  return shipment_id;
end
$$;

create or replace function public.adjust_inventory_stock(
  p_item_type text,
  p_item_id text,
  p_quantity integer,
  p_packages integer default 0,
  p_loose_rounds integer default 0,
  p_notes text default ''
)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  added integer;
  package_size integer;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  if p_item_type = 'accessory' then
    if p_quantity <= 0 then raise exception using errcode = '22023', message = 'quantity must be positive'; end if;
    update public.accessories as a set quantity = a.quantity + p_quantity where a.id = p_item_id;
    if not found then raise exception using errcode = 'P0002', message = 'accessory not found'; end if;
    added := p_quantity;
  elsif p_item_type = 'ammunition' then
    if p_packages < 0 or p_loose_rounds < 0 then raise exception using errcode = '22023', message = 'ammunition quantities cannot be negative'; end if;
    select a.units_per_package into package_size from public.ammunition as a where a.id = p_item_id for update;
    if package_size is null then raise exception using errcode = 'P0002', message = 'ammunition not found'; end if;
    added := p_packages * package_size + p_loose_rounds;
    if added <= 0 then raise exception using errcode = '22023', message = 'at least one round must be added'; end if;
    update public.ammunition as a
    set full_packages = (a.full_packages * a.units_per_package + a.loose_rounds + added) / a.units_per_package,
        loose_rounds = (a.full_packages * a.units_per_package + a.loose_rounds + added) % a.units_per_package
    where a.id = p_item_id;
  else
    raise exception using errcode = '22023', message = 'invalid inventory item type';
  end if;
  insert into public.inventory_transactions (id, item_type, item_id, transaction_type, quantity_delta, notes, created_by)
  values (public.next_business_id('ITX'), p_item_type, p_item_id, 'adjustment', added, coalesce(p_notes, ''), actor_id);
end
$$;

create or replace function public.update_ammunition_package(p_item_id text, p_package_type text, p_units_per_package integer)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare total_rounds integer;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  if p_package_type not in ('Carton', 'Box', 'Case', 'Custom') or p_units_per_package <= 0 then raise exception using errcode = '22023', message = 'invalid package configuration'; end if;
  select a.full_packages * a.units_per_package + a.loose_rounds into total_rounds from public.ammunition as a where a.id = p_item_id for update;
  if total_rounds is null then raise exception using errcode = 'P0002', message = 'ammunition not found'; end if;
  update public.ammunition set package_type = p_package_type, units_per_package = p_units_per_package,
    full_packages = total_rounds / p_units_per_package, loose_rounds = total_rounds % p_units_per_package where id = p_item_id;
end
$$;

create or replace function public.extend_invoice_due_date(p_invoice_id text, p_new_due_date date, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare actor_id text; invoice_number_value text; invoice_voided boolean; invoice_balance numeric;
begin
  if not public.has_app_permission('canExtendDueDates') then raise exception using errcode = '42501', message = 'due-date extension permission is required'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception using errcode = '22023', message = 'extension reason is required'; end if;
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  select i.invoice_number, i.voided, i.balance into invoice_number_value, invoice_voided, invoice_balance from public.invoices as i where i.id = p_invoice_id for update;
  if invoice_number_value is null then raise exception using errcode = 'P0002', message = 'invoice not found'; end if;
  if invoice_voided then raise exception using errcode = '23514', message = 'cannot extend a voided invoice'; end if;
  update public.invoices set due_date = p_new_due_date,
    status = case when invoice_balance <= 0.01 then 'Paid' when p_new_due_date < current_date then 'Overdue' else 'Pending' end
  where id = p_invoice_id;
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (public.next_business_id('LOG'), now(), current_date, actor_id, 'DueDateExtension', 'Due date extended for invoice ' || invoice_number_value, jsonb_build_object('invoiceId', p_invoice_id, 'newDueDate', p_new_due_date, 'reason', btrim(p_reason)));
end
$$;

create or replace function public.void_invoice(p_invoice_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare actor_id text; invoice_row record; item jsonb; item_type text; item_id text; item_quantity integer; rounds integer; package_size integer;
begin
  if not public.has_app_permission('canVoidInvoices') then raise exception using errcode = '42501', message = 'invoice void permission is required'; end if;
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  select i.id, i.invoice_number, i.voided, i.total_paid, i.line_items into invoice_row from public.invoices as i where i.id = p_invoice_id for update;
  if invoice_row.id is null then raise exception using errcode = 'P0002', message = 'invoice not found'; end if;
  if invoice_row.voided then raise exception using errcode = '23514', message = 'invoice is already voided'; end if;
  if invoice_row.total_paid > 0.01 then raise exception using errcode = '23514', message = 'a paid invoice requires an explicit refund or reversal workflow'; end if;
  for item in select value from jsonb_array_elements(invoice_row.line_items) loop
    item_type := item ->> 'itemType'; item_id := item ->> 'itemId'; item_quantity := (item ->> 'quantity')::integer;
    if item_type = 'weapon' then
      update public.weapons set status = 'Returned', actual_final_price = null, actual_final_price_valuation = null, sale_price_valuation = null where id = item_id and status = 'Sold';
      if not found then raise exception using errcode = '23514', message = format('cannot safely restore weapon %s', item_id); end if;
    elsif item_type = 'accessory' then
      update public.accessories set quantity = quantity + item_quantity where id = item_id;
      if not found then raise exception using errcode = 'P0002', message = 'accessory not found'; end if;
    elsif item_type = 'ammunition' then
      select a.full_packages * a.units_per_package + a.loose_rounds + item_quantity, a.units_per_package into rounds, package_size from public.ammunition as a where a.id = item_id for update;
      if package_size is null then raise exception using errcode = 'P0002', message = 'ammunition not found'; end if;
      update public.ammunition set full_packages = rounds / package_size, loose_rounds = rounds % package_size where id = item_id;
    else raise exception using errcode = '23514', message = 'invoice contains an invalid line item type'; end if;
    insert into public.inventory_transactions (id, item_type, item_id, transaction_type, quantity_delta, notes, created_by)
    values (public.next_business_id('ITX'), item_type, item_id, 'return', item_quantity, 'Voided invoice ' || invoice_row.invoice_number, actor_id);
  end loop;
  update public.invoices set voided = true, status = 'Void' where id = p_invoice_id;
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (public.next_business_id('LOG'), now(), current_date, actor_id, 'Void', 'Invoice voided - ' || invoice_row.invoice_number, jsonb_build_object('invoiceId', p_invoice_id));
end
$$;

revoke all on function public.bulk_intake_weapons(jsonb) from public, anon;
revoke all on function public.create_shipment(jsonb) from public, anon;
revoke all on function public.adjust_inventory_stock(text, text, integer, integer, integer, text) from public, anon;
revoke all on function public.update_ammunition_package(text, text, integer) from public, anon;
revoke all on function public.extend_invoice_due_date(text, date, text) from public, anon;
revoke all on function public.void_invoice(text) from public, anon;
grant execute on function public.bulk_intake_weapons(jsonb) to authenticated;
grant execute on function public.create_shipment(jsonb) to authenticated;
grant execute on function public.adjust_inventory_stock(text, text, integer, integer, integer, text) to authenticated;
grant execute on function public.update_ammunition_package(text, text, integer) to authenticated;
grant execute on function public.extend_invoice_due_date(text, date, text) to authenticated;
grant execute on function public.void_invoice(text) to authenticated;

commit;
