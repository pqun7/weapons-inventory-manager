begin;

drop function if exists public.adjust_inventory_stock(text, text, integer, integer, integer, text);

create or replace function public.replace_product_costs(p_product_type text, p_product_id text, p_costs jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  original_amount numeric(20, 4);
  original_currency varchar(3);
  original_snapshot jsonb;
  original_base numeric(20, 4);
  cost jsonb;
  cost_snapshot jsonb;
  calculation_type text;
  input_amount numeric(20, 4);
  percentage_rate numeric(12, 6);
  calculated_amount numeric(20, 4);
  base_amount numeric(20, 4);
  costs_base numeric(20, 4) := 0;
begin
  if not public.can_change_inventory() then
    raise exception using errcode = '42501', message = 'inventory permission is required';
  end if;
  if p_product_type not in ('weapon', 'accessory', 'ammunition') then
    raise exception using errcode = '22023', message = 'invalid inventory product type';
  end if;
  if coalesce(jsonb_typeof(p_costs), 'null') <> 'array' then
    raise exception using errcode = '22023', message = 'product costs must be an array';
  end if;
  select u.id into actor_id from public.users as u
  where u.auth_user_id = auth.uid() and u.is_active limit 1;
  if actor_id is null then
    raise exception using errcode = '42501', message = 'authenticated application user is required';
  end if;

  if p_product_type = 'weapon' then
    select w.purchase_price, w.purchase_price_valuation ->> 'originalCurrency'
    into original_amount, original_currency from public.weapons as w where w.id = p_product_id for update;
  elsif p_product_type = 'accessory' then
    select a.price, a.price_currency into original_amount, original_currency
    from public.accessories as a where a.id = p_product_id for update;
  else
    select a.price, a.price_currency into original_amount, original_currency
    from public.ammunition as a where a.id = p_product_id for update;
  end if;
  if original_amount is null then
    raise exception using errcode = 'P0002', message = 'inventory product not found';
  end if;
  original_snapshot := public.currency_snapshot(original_currency);
  original_base := round(original_amount / (original_snapshot ->> 'exchangeRate')::numeric, 4);

  delete from public.product_costs as pc
  where pc.product_type = p_product_type and pc.product_id = p_product_id;

  for cost in select value from jsonb_array_elements(p_costs) loop
    if nullif(btrim(cost ->> 'name'), '') is null then
      raise exception using errcode = '22023', message = 'cost name is required';
    end if;
    calculation_type := cost ->> 'calculationType';
    if calculation_type not in ('fixed', 'percentage') then
      raise exception using errcode = '22023', message = 'invalid cost calculation type';
    end if;
    cost_snapshot := public.currency_snapshot(upper(cost ->> 'currency'));
    input_amount := coalesce(nullif(cost ->> 'amount', '')::numeric, 0);
    percentage_rate := nullif(cost ->> 'percentageRate', '')::numeric;
    if input_amount < 0 or coalesce(percentage_rate, 0) < 0 then
      raise exception using errcode = '22023', message = 'cost amount cannot be negative';
    end if;
    if calculation_type = 'fixed' then
      calculated_amount := input_amount;
    else
      if percentage_rate is null then
        raise exception using errcode = '22023', message = 'percentage rate is required';
      end if;
      calculated_amount := round(original_base * (cost_snapshot ->> 'exchangeRate')::numeric * percentage_rate / 100, 4);
    end if;
    base_amount := round(calculated_amount / (cost_snapshot ->> 'exchangeRate')::numeric, 4);
    insert into public.product_costs (
      id, product_type, product_id, name, calculation_type, input_amount,
      percentage_rate, calculation_base, calculated_amount, currency_code,
      exchange_rate, base_amount, base_currency_code, exchange_rate_date,
      rate_source, source, created_by
    ) values (
      coalesce(nullif(cost ->> 'id', ''), public.next_business_id('PC')), p_product_type,
      p_product_id, btrim(cost ->> 'name'), calculation_type, input_amount,
      case when calculation_type = 'percentage' then percentage_rate else null end,
      'original_purchase_cost', calculated_amount, upper(cost ->> 'currency'),
      (cost_snapshot ->> 'exchangeRate')::numeric, base_amount,
      cost_snapshot ->> 'accountingCurrency', (cost_snapshot ->> 'exchangeRateDate')::timestamptz,
      cost_snapshot ->> 'rateSource', 'product_level', actor_id
    );
    costs_base := costs_base + base_amount;
  end loop;

  insert into public.inventory_cost_snapshots (
    product_type, product_id, shipment_id, shipment_item_id, original_amount,
    original_currency_code, original_exchange_rate, original_base_amount,
    product_costs_base_amount, shipment_costs_base_amount, final_landed_base_amount,
    base_currency_code, exchange_rate_date, rate_source, finalized_at, finalized_by
  ) values (
    p_product_type, p_product_id, null, null, original_amount, original_currency,
    (original_snapshot ->> 'exchangeRate')::numeric, original_base, costs_base, 0,
    original_base + costs_base, original_snapshot ->> 'accountingCurrency',
    (original_snapshot ->> 'exchangeRateDate')::timestamptz,
    original_snapshot ->> 'rateSource', now(), actor_id
  ) on conflict (product_type, product_id) do update set
    product_costs_base_amount = excluded.product_costs_base_amount,
    final_landed_base_amount = excluded.original_base_amount + excluded.product_costs_base_amount
      + public.inventory_cost_snapshots.shipment_costs_base_amount,
    finalized_at = now(), finalized_by = excluded.finalized_by;
end
$$;

create or replace function public.create_inventory_product(p_product_type text, p_product jsonb, p_costs jsonb default '[]'::jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  product_id text;
  currency_code varchar(3);
  snapshot jsonb;
  price numeric(20, 4);
begin
  if not public.can_change_inventory() then
    raise exception using errcode = '42501', message = 'inventory permission is required';
  end if;
  if p_product_type not in ('accessory', 'ammunition') then
    raise exception using errcode = '22023', message = 'invalid inventory product type';
  end if;
  product_id := nullif(btrim(p_product ->> 'id'), '');
  if product_id is null then product_id := public.next_business_id(case when p_product_type = 'accessory' then 'ACC' else 'AMM' end); end if;
  price := (p_product ->> 'price')::numeric;
  if price < 0 then raise exception using errcode = '22023', message = 'price cannot be negative'; end if;
  select coalesce(upper(nullif(btrim(p_product ->> 'price_currency'), '')), s.currency_code)
  into currency_code from public.system_settings as s where s.id = 1;
  snapshot := public.currency_snapshot(currency_code);

  if p_product_type = 'accessory' then
    insert into public.accessories (
      id, name, type, quantity, safety_threshold, price, price_currency,
      price_valuation, date_added, warehouse, shelf, bin
    ) values (
      product_id, btrim(p_product ->> 'name'), coalesce(p_product ->> 'type', ''),
      (p_product ->> 'quantity')::integer, (p_product ->> 'safety_threshold')::integer,
      price, currency_code,
      public.money_valuation(price, currency_code, snapshot ->> 'accountingCurrency',
        (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz,
        snapshot ->> 'rateSource'),
      coalesce(nullif(p_product ->> 'date_added', '')::date, current_date),
      coalesce(p_product ->> 'warehouse', ''), coalesce(p_product ->> 'shelf', ''),
      coalesce(p_product ->> 'bin', '')
    );
  else
    insert into public.ammunition (
      id, name, caliber, package_type, units_per_package, full_packages,
      loose_rounds, safety_threshold, price, price_currency, price_valuation,
      date_added, warehouse, shelf, bin
    ) values (
      product_id, coalesce(p_product ->> 'name', p_product ->> 'caliber', ''),
      btrim(p_product ->> 'caliber'), coalesce(nullif(p_product ->> 'package_type', ''), 'Box'),
      (p_product ->> 'units_per_package')::integer, (p_product ->> 'full_packages')::integer,
      (p_product ->> 'loose_rounds')::integer, (p_product ->> 'safety_threshold')::integer,
      price, currency_code,
      public.money_valuation(price, currency_code, snapshot ->> 'accountingCurrency',
        (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz,
        snapshot ->> 'rateSource'),
      coalesce(nullif(p_product ->> 'date_added', '')::date, current_date),
      coalesce(p_product ->> 'warehouse', ''), coalesce(p_product ->> 'shelf', ''),
      coalesce(p_product ->> 'bin', '')
    );
  end if;
  perform public.replace_product_costs(p_product_type, product_id, coalesce(p_costs, '[]'::jsonb));
  return product_id;
end
$$;

create or replace function public.adjust_inventory_stock(
  p_item_type text,
  p_item_id text,
  p_quantity integer default 0,
  p_packages integer default 0,
  p_loose_rounds integer default 0,
  p_price numeric default null,
  p_purchase_price numeric default null,
  p_currency text default null,
  p_shipment_id text default null,
  p_notes text default '',
  p_location jsonb default null
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
  currency_code varchar(3);
  valuation jsonb;
  transaction_amount numeric;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  if actor_id is null then raise exception using errcode = '42501', message = 'authenticated application user is required'; end if;
  if p_price < 0 or p_purchase_price < 0 then raise exception using errcode = '22023', message = 'price cannot be negative'; end if;
  select coalesce(upper(nullif(btrim(p_currency), '')), s.currency_code) into currency_code from public.system_settings as s where s.id = 1;
  if p_shipment_id is not null and not exists (select 1 from public.shipments as s where s.id = p_shipment_id) then
    raise exception using errcode = '23503', message = 'shipment not found';
  end if;
  if p_item_type = 'accessory' then
    if p_quantity <= 0 then raise exception using errcode = '22023', message = 'quantity must be positive'; end if;
    update public.accessories as a set
      quantity = a.quantity + p_quantity,
      price = coalesce(p_price, a.price),
      price_currency = case when p_price is null then a.price_currency else currency_code end,
      price_valuation = case when p_price is null then a.price_valuation else
        public.money_valuation(p_price, currency_code,
          public.currency_snapshot(currency_code) ->> 'accountingCurrency',
          (public.currency_snapshot(currency_code) ->> 'exchangeRate')::numeric,
          (public.currency_snapshot(currency_code) ->> 'exchangeRateDate')::timestamptz,
          public.currency_snapshot(currency_code) ->> 'rateSource') end,
      warehouse = coalesce(p_location ->> 'warehouse', a.warehouse),
      shelf = coalesce(p_location ->> 'shelf', a.shelf),
      bin = coalesce(p_location ->> 'bin', a.bin)
    where a.id = p_item_id;
    if not found then raise exception using errcode = 'P0002', message = 'accessory not found'; end if;
    added := p_quantity;
  elsif p_item_type = 'ammunition' then
    if p_packages < 0 or p_loose_rounds < 0 then raise exception using errcode = '22023', message = 'ammunition quantities cannot be negative'; end if;
    select a.units_per_package into package_size from public.ammunition as a where a.id = p_item_id for update;
    if package_size is null then raise exception using errcode = 'P0002', message = 'ammunition not found'; end if;
    added := p_packages * package_size + p_loose_rounds;
    if added <= 0 then raise exception using errcode = '22023', message = 'at least one round must be added'; end if;
    update public.ammunition as a set
      full_packages = (a.full_packages * a.units_per_package + a.loose_rounds + added) / a.units_per_package,
      loose_rounds = (a.full_packages * a.units_per_package + a.loose_rounds + added) % a.units_per_package,
      price = coalesce(p_price, a.price),
      price_currency = case when p_price is null then a.price_currency else currency_code end,
      price_valuation = case when p_price is null then a.price_valuation else
        public.money_valuation(p_price, currency_code,
          public.currency_snapshot(currency_code) ->> 'accountingCurrency',
          (public.currency_snapshot(currency_code) ->> 'exchangeRate')::numeric,
          (public.currency_snapshot(currency_code) ->> 'exchangeRateDate')::timestamptz,
          public.currency_snapshot(currency_code) ->> 'rateSource') end,
      warehouse = coalesce(p_location ->> 'warehouse', a.warehouse),
      shelf = coalesce(p_location ->> 'shelf', a.shelf),
      bin = coalesce(p_location ->> 'bin', a.bin)
    where a.id = p_item_id;
  else
    raise exception using errcode = '22023', message = 'invalid inventory item type';
  end if;

  transaction_amount := coalesce(p_purchase_price, p_price);
  if transaction_amount is null then
    insert into public.inventory_transactions (id, item_type, item_id, transaction_type, quantity_delta, shipment_id, notes, created_by)
    values (public.next_business_id('ITX'), p_item_type, p_item_id, 'receipt', added, p_shipment_id, coalesce(p_notes, ''), actor_id);
  else
    valuation := public.currency_snapshot(currency_code);
    insert into public.inventory_transactions (
      id, item_type, item_id, transaction_type, quantity_delta, unit_amount,
      currency, valuation, shipment_id, notes, created_by
    ) values (
      public.next_business_id('ITX'), p_item_type, p_item_id, 'receipt', added,
      transaction_amount, currency_code,
      public.money_valuation(transaction_amount, currency_code, valuation ->> 'accountingCurrency',
        (valuation ->> 'exchangeRate')::numeric, (valuation ->> 'exchangeRateDate')::timestamptz,
        valuation ->> 'rateSource'), p_shipment_id, coalesce(p_notes, ''), actor_id
    );
  end if;
end
$$;

create or replace function public.receive_ammunition(
  p_item_id text,
  p_rounds integer,
  p_units_per_package integer default null,
  p_purchase_price numeric default 0,
  p_currency text default null,
  p_shipment_id text default null,
  p_notes text default ''
)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare actor_id text; package_size integer; total_rounds integer; currency_code varchar(3); snapshot jsonb;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  if p_rounds <= 0 or p_purchase_price < 0 or (p_units_per_package is not null and p_units_per_package <= 0) then
    raise exception using errcode = '22023', message = 'invalid ammunition receipt';
  end if;
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  select coalesce(p_units_per_package, a.units_per_package),
    a.full_packages * a.units_per_package + a.loose_rounds + p_rounds
  into package_size, total_rounds from public.ammunition as a where a.id = p_item_id for update;
  if package_size is null then raise exception using errcode = 'P0002', message = 'ammunition not found'; end if;
  update public.ammunition set units_per_package = package_size,
    full_packages = total_rounds / package_size, loose_rounds = total_rounds % package_size where id = p_item_id;
  select coalesce(upper(nullif(btrim(p_currency), '')), s.currency_code) into currency_code from public.system_settings as s where s.id = 1;
  snapshot := public.currency_snapshot(currency_code);
  insert into public.inventory_transactions (
    id, item_type, item_id, transaction_type, quantity_delta, unit_amount,
    currency, valuation, shipment_id, notes, created_by
  ) values (
    public.next_business_id('ITX'), 'ammunition', p_item_id, 'receipt', p_rounds,
    p_purchase_price, currency_code,
    public.money_valuation(p_purchase_price, currency_code, snapshot ->> 'accountingCurrency',
      (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz,
      snapshot ->> 'rateSource'), p_shipment_id, coalesce(p_notes, ''), actor_id
  );
end
$$;

create or replace function public.bulk_create_shipment(p_input jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  shipment_input jsonb := p_input -> 'shipment';
  lines jsonb := p_input -> 'lineItems';
  line jsonb;
  line_id text;
  shipment_id text;
  product_id text;
  product_ids jsonb;
  snapshot jsonb;
  item_currency varchar(3);
  serial_count integer;
  total_items integer := 0;
  actor_id text;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    raise exception using errcode = '22023', message = 'at least one shipment line item is required';
  end if;
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  shipment_input := shipment_input || jsonb_build_object(
    'totalExpectedItems', (select sum((value ->> 'quantity')::integer) from jsonb_array_elements(lines)),
    'lineItems', '[]'::jsonb
  );
  shipment_id := public.create_shipment(shipment_input);

  for line in select value from jsonb_array_elements(lines) loop
    if (line ->> 'productType') not in ('weapon', 'accessory', 'ammunition')
      or (line ->> 'quantity')::integer <= 0 then
      raise exception using errcode = '22023', message = 'invalid shipment line item';
    end if;
    total_items := total_items + (line ->> 'quantity')::integer;
    line_id := coalesce(nullif(line ->> 'id', ''), public.next_business_id('SLI'));
    item_currency := coalesce(upper(nullif(line ->> 'currency', '')), upper(nullif(shipment_input ->> 'currency', '')));
    if item_currency is null then select s.currency_code into item_currency from public.system_settings as s where s.id = 1; end if;
    snapshot := public.currency_snapshot(item_currency);
    product_ids := '[]'::jsonb;

    if line ->> 'productType' = 'weapon' then
      serial_count := jsonb_array_length(coalesce(line -> 'serialNumbers', '[]'::jsonb));
      if serial_count <> (line ->> 'quantity')::integer then
        raise exception using errcode = '22023', message = 'weapon quantity must match serial-number count';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(line -> 'serialNumbers') as serials(serial)
        group by upper(btrim(serial)) having count(*) > 1
      ) then raise exception using errcode = '23505', message = 'duplicate serial number inside shipment'; end if;
      if exists (
        select 1 from jsonb_array_elements_text(line -> 'serialNumbers') as serials(serial)
        join public.weapons as w on upper(w.serial_number) = upper(btrim(serial))
      ) then raise exception using errcode = '23505', message = 'shipment contains an existing weapon serial number'; end if;
      perform public.bulk_intake_weapons(jsonb_build_object(
        'serialNumbers', line -> 'serialNumbers', 'weaponTypeId', line ->> 'weaponTypeId',
        'weaponSubtypeId', line ->> 'weaponSubtypeId', 'caliberId', line ->> 'caliberId',
        'brandId', line ->> 'brandId', 'modelId', line ->> 'modelId',
        'storageLocationId', line ->> 'storageLocationId', 'condition', 'Excellent',
        'purchasePrice', (line ->> 'purchasePrice')::numeric,
        'retailPrice', (line ->> 'retailPrice')::numeric,
        'wholesalePrice', (line ->> 'wholesalePrice')::numeric,
        'supplierId', shipment_input ->> 'supplierId', 'shipmentId', shipment_id,
        'currency', item_currency, 'notes', 'Initial intake via shipment wizard',
        'additionalCosts', coalesce(line -> 'additionalCosts', '[]'::jsonb)
      ));
      select coalesce(jsonb_agg(w.id order by w.id), '[]'::jsonb) into product_ids
      from public.weapons as w where w.shipment_id = shipment_id
        and w.serial_number in (select value from jsonb_array_elements_text(line -> 'serialNumbers'));
    elsif line ->> 'productType' = 'accessory' then
      product_id := public.create_inventory_product('accessory', jsonb_build_object(
        'name', coalesce(nullif(btrim(concat_ws(' ', line ->> 'brandLabel', line ->> 'modelLabel')), ''), 'Accessory'),
        'type', coalesce(line ->> 'subTypeLabel', ''), 'quantity', (line ->> 'quantity')::integer,
        'safety_threshold', 5, 'price', (line ->> 'retailPrice')::numeric,
        'price_currency', item_currency, 'date_added', current_date,
        'warehouse', coalesce(line #>> '{location,warehouse}', 'Main'),
        'shelf', coalesce(line #>> '{location,shelf}', ''), 'bin', coalesce(line #>> '{location,bin}', '')
      ), coalesce(line -> 'additionalCosts', '[]'::jsonb));
      product_ids := jsonb_build_array(product_id);
    else
      product_id := public.create_inventory_product('ammunition', jsonb_build_object(
        'name', coalesce(nullif(line ->> 'modelLabel', ''), nullif(line ->> 'caliberLabel', ''), 'Ammunition'),
        'caliber', coalesce(line ->> 'caliberLabel', ''), 'package_type', 'Box',
        'units_per_package', 50, 'full_packages', (line ->> 'quantity')::integer / 50,
        'loose_rounds', (line ->> 'quantity')::integer % 50, 'safety_threshold', 100,
        'price', (line ->> 'retailPrice')::numeric, 'price_currency', item_currency,
        'date_added', current_date, 'warehouse', coalesce(line #>> '{location,warehouse}', 'Main'),
        'shelf', coalesce(line #>> '{location,shelf}', ''), 'bin', coalesce(line #>> '{location,bin}', '')
      ), coalesce(line -> 'additionalCosts', '[]'::jsonb));
      product_ids := jsonb_build_array(product_id);
    end if;

    insert into public.shipment_items (
      id, shipment_id, product_type, description, quantity, unit_purchase_amount,
      currency_code, exchange_rate, unit_purchase_base_amount, base_currency_code,
      exchange_rate_date, rate_source, product_ids_json
    ) values (
      line_id, shipment_id, line ->> 'productType',
      coalesce(nullif(btrim(concat_ws(' ', line ->> 'brandLabel', line ->> 'modelLabel')), ''), line ->> 'productType'),
      (line ->> 'quantity')::integer, (line ->> 'purchasePrice')::numeric,
      item_currency, (snapshot ->> 'exchangeRate')::numeric,
      round((line ->> 'purchasePrice')::numeric / (snapshot ->> 'exchangeRate')::numeric, 4),
      snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRateDate')::timestamptz,
      snapshot ->> 'rateSource', product_ids
    );
  end loop;

  perform public.apply_shipment_costs(shipment_id, coalesce(p_input -> 'additionalCosts', '[]'::jsonb));

  update public.shipments as s set
    total_expected_items = total_items,
    status = 'Arrived',
    workflow_status = 'received',
    actual_arrival_date = coalesce(nullif(shipment_input ->> 'actualArrivalDate', '')::date, current_date),
    line_items = lines,
    timeline = s.timeline || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'timestamp', now(), 'status', 'Arrived',
      'userId', actor_id, 'notes', 'Shipment arrived with all items', 'eventType', 'Arrived'
    ))
  where s.id = shipment_id;
  return shipment_id;
end
$$;

create policy employee_customer_insert on public.customers for insert to authenticated
with check (public.can_sell_inventory());
create policy employee_customer_update on public.customers for update to authenticated
using (public.can_sell_inventory()) with check (public.can_sell_inventory());
create policy shipment_staff_supplier_insert on public.suppliers for insert to authenticated
with check (public.can_manage_shipments());

revoke all on function public.replace_product_costs(text, text, jsonb) from public, anon;
revoke all on function public.create_inventory_product(text, jsonb, jsonb) from public, anon;
revoke all on function public.adjust_inventory_stock(text, text, integer, integer, integer, numeric, numeric, text, text, text, jsonb) from public, anon;
revoke all on function public.receive_ammunition(text, integer, integer, numeric, text, text, text) from public, anon;
revoke all on function public.bulk_create_shipment(jsonb) from public, anon;
grant execute on function public.replace_product_costs(text, text, jsonb) to authenticated;
grant execute on function public.create_inventory_product(text, jsonb, jsonb) to authenticated;
grant execute on function public.adjust_inventory_stock(text, text, integer, integer, integer, numeric, numeric, text, text, text, jsonb) to authenticated;
grant execute on function public.receive_ammunition(text, integer, integer, numeric, text, text, text) to authenticated;
grant execute on function public.bulk_create_shipment(jsonb) to authenticated;

commit;
