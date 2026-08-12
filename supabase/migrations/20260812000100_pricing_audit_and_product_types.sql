begin;

alter table public.system_settings
  add column if not exists target_retail_margin_percent numeric(7, 4) not null default 30
    check (target_retail_margin_percent > 0 and target_retail_margin_percent < 100),
  add column if not exists target_wholesale_margin_percent numeric(7, 4) not null default 20
    check (target_wholesale_margin_percent > 0 and target_wholesale_margin_percent < 100),
  add column if not exists maximum_markup_percent numeric(9, 4) not null default 200
    check (maximum_markup_percent >= 0 and maximum_markup_percent <= 10000),
  add column if not exists psychological_pricing boolean not null default false;

alter table public.weapons
  add column if not exists retail_price_mode text not null default 'manual'
    check (retail_price_mode in ('auto', 'manual')),
  add column if not exists wholesale_price_mode text not null default 'manual'
    check (wholesale_price_mode in ('auto', 'manual'));

alter table public.accessories
  add column if not exists retail_price numeric(20, 4) not null default 0 check (retail_price >= 0),
  add column if not exists wholesale_price numeric(20, 4) not null default 0 check (wholesale_price >= 0),
  add column if not exists retail_price_valuation jsonb,
  add column if not exists wholesale_price_valuation jsonb,
  add column if not exists retail_price_mode text not null default 'manual'
    check (retail_price_mode in ('auto', 'manual')),
  add column if not exists wholesale_price_mode text not null default 'manual'
    check (wholesale_price_mode in ('auto', 'manual'));

alter table public.ammunition
  add column if not exists retail_price numeric(20, 4) not null default 0 check (retail_price >= 0),
  add column if not exists wholesale_price numeric(20, 4) not null default 0 check (wholesale_price >= 0),
  add column if not exists retail_price_valuation jsonb,
  add column if not exists wholesale_price_valuation jsonb,
  add column if not exists retail_price_mode text not null default 'manual'
    check (retail_price_mode in ('auto', 'manual')),
  add column if not exists wholesale_price_mode text not null default 'manual'
    check (wholesale_price_mode in ('auto', 'manual'));

update public.accessories as a
set retail_price = case when a.retail_price = 0 then a.price else a.retail_price end,
    wholesale_price = case when a.wholesale_price = 0 then a.price else a.wholesale_price end,
    retail_price_valuation = coalesce(a.retail_price_valuation, a.price_valuation),
    wholesale_price_valuation = coalesce(a.wholesale_price_valuation, a.price_valuation);

update public.ammunition as a
set retail_price = case when a.retail_price = 0 then a.price else a.retail_price end,
    wholesale_price = case when a.wholesale_price = 0 then a.price else a.wholesale_price end,
    retail_price_valuation = coalesce(a.retail_price_valuation, a.price_valuation),
    wholesale_price_valuation = coalesce(a.wholesale_price_valuation, a.price_valuation);

create table if not exists public.inventory_product_types (
  id text primary key,
  category text not null check (category in ('accessory', 'ammunition')),
  name text not null check (length(btrim(name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  created_by text not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (category, normalized_name)
);

alter table public.inventory_product_types enable row level security;
create policy inventory_product_types_read on public.inventory_product_types
for select to authenticated using (public.can_view_inventory());

insert into public.inventory_product_types (id, category, name, normalized_name, created_by)
select gen_random_uuid()::text, source.category, source.name,
       lower(regexp_replace(btrim(source.name), '\s+', ' ', 'g')), actor.id
from (
  select distinct 'accessory'::text as category, btrim(a.type) as name
  from public.accessories as a where nullif(btrim(a.type), '') is not null
  union
  select distinct 'ammunition'::text, btrim(a.caliber)
  from public.ammunition as a where nullif(btrim(a.caliber), '') is not null
) as source
cross join lateral (
  select u.id from public.users as u where u.is_active order by case when u.role = 'Admin' then 0 else 1 end, u.id limit 1
) as actor
on conflict (category, normalized_name) do nothing;

alter table public.customers add column if not exists notes text not null default '';

alter table public.audit_logs
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists entity_name text,
  add column if not exists previous_values jsonb not null default '{}'::jsonb check (jsonb_typeof(previous_values) = 'object'),
  add column if not exists new_values jsonb not null default '{}'::jsonb check (jsonb_typeof(new_values) = 'object'),
  add column if not exists reason text;

update public.audit_logs as log
set entity_type = coalesce(log.entity_type, log.metadata ->> 'entityType'),
    entity_id = coalesce(log.entity_id, log.metadata ->> 'entityId', log.metadata ->> 'weaponId', log.metadata ->> 'invoiceId', log.metadata ->> 'shipmentId', log.metadata ->> 'itemId'),
    entity_name = coalesce(log.entity_name, log.metadata ->> 'entityName', log.metadata ->> 'itemName', log.metadata ->> 'invoiceNumber', log.metadata ->> 'shipmentNumber', log.metadata ->> 'customerName'),
    previous_values = case when jsonb_typeof(log.metadata -> 'previousValues') = 'object' then log.metadata -> 'previousValues' else log.previous_values end,
    new_values = case when jsonb_typeof(log.metadata -> 'newValues') = 'object' then log.metadata -> 'newValues' else log.new_values end,
    reason = coalesce(log.reason, log.metadata ->> 'reason');

create index if not exists idx_audit_logs_timestamp_desc on public.audit_logs(timestamp desc);
create index if not exists idx_audit_logs_user_timestamp on public.audit_logs(user_id, timestamp desc);
create index if not exists idx_audit_logs_action_timestamp on public.audit_logs(action_type, timestamp desc);
create index if not exists idx_audit_logs_entity_timestamp on public.audit_logs(entity_type, entity_id, timestamp desc)
where entity_type is not null and entity_id is not null;

create or replace function public.write_audit_event(p_action_type text, p_description text, p_metadata jsonb default '{}'::jsonb)
returns text language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; audit_id text; safe_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  if actor_id is null then raise exception using errcode = '42501', message = 'authenticated application user is required'; end if;
  if nullif(btrim(p_action_type), '') is null or jsonb_typeof(safe_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid audit event';
  end if;
  audit_id := public.next_business_id('LOG');
  insert into public.audit_logs (
    id, timestamp, date, user_id, action_type, description, metadata,
    entity_type, entity_id, entity_name, previous_values, new_values, reason
  ) values (
    audit_id, now(), current_date, actor_id, btrim(p_action_type), coalesce(p_description, ''), safe_metadata,
    nullif(safe_metadata ->> 'entityType', ''),
    coalesce(nullif(safe_metadata ->> 'entityId', ''), nullif(safe_metadata ->> 'weaponId', ''), nullif(safe_metadata ->> 'invoiceId', ''), nullif(safe_metadata ->> 'shipmentId', ''), nullif(safe_metadata ->> 'itemId', '')),
    coalesce(nullif(safe_metadata ->> 'entityName', ''), nullif(safe_metadata ->> 'itemName', ''), nullif(safe_metadata ->> 'invoiceNumber', ''), nullif(safe_metadata ->> 'shipmentNumber', ''), nullif(safe_metadata ->> 'customerName', '')),
    case when jsonb_typeof(safe_metadata -> 'previousValues') = 'object' then safe_metadata -> 'previousValues' else '{}'::jsonb end,
    case when jsonb_typeof(safe_metadata -> 'newValues') = 'object' then safe_metadata -> 'newValues' else '{}'::jsonb end,
    nullif(safe_metadata ->> 'reason', '')
  );
  return audit_id;
end
$$;

create or replace function public.create_inventory_product_type(p_category text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; type_id text; clean_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g'); normalized text;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  if p_category not in ('accessory', 'ammunition') or clean_name = '' then
    raise exception using errcode = '22023', message = 'a valid product type is required';
  end if;
  normalized := lower(clean_name);
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  select t.id, t.name into type_id, clean_name from public.inventory_product_types as t
  where t.category = p_category and t.normalized_name = normalized limit 1;
  if type_id is not null then return jsonb_build_object('id', type_id, 'category', p_category, 'name', clean_name, 'created', false); end if;
  type_id := gen_random_uuid()::text;
  insert into public.inventory_product_types (id, category, name, normalized_name, created_by)
  values (type_id, p_category, clean_name, normalized, actor_id);
  perform public.write_audit_event('Intake', case when p_category = 'accessory' then 'Accessory type created' else 'Ammunition type created' end,
    jsonb_build_object('entityType', 'InventoryProductType', 'entityId', type_id, 'entityName', clean_name, 'category', p_category, 'newValues', jsonb_build_object('name', clean_name, 'category', p_category)));
  return jsonb_build_object('id', type_id, 'category', p_category, 'name', clean_name, 'created', true);
end
$$;

create or replace function public.update_customer(p_customer_id text, p_patch jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare old_row public.customers%rowtype; new_row public.customers%rowtype;
begin
  if not public.can_sell_inventory() and not public.can_view_financials() then
    raise exception using errcode = '42501', message = 'customer permission is required';
  end if;
  select c.* into old_row from public.customers as c where c.id = p_customer_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'customer not found'; end if;
  if p_patch ? 'email' and nullif(btrim(p_patch ->> 'email'), '') is not null
     and btrim(p_patch ->> 'email') !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception using errcode = '22023', message = 'invalid customer email';
  end if;
  update public.customers as c set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else c.name end,
    phone = case when p_patch ? 'phone' then btrim(p_patch ->> 'phone') else c.phone end,
    email = case when p_patch ? 'email' then btrim(p_patch ->> 'email') else c.email end,
    address = case when p_patch ? 'address' then btrim(p_patch ->> 'address') else c.address end,
    is_wholesale_buyer = case when p_patch ? 'isWholesaleBuyer' then (p_patch ->> 'isWholesaleBuyer')::boolean else c.is_wholesale_buyer end,
    wholesale_discount_percent = case when p_patch ? 'wholesaleDiscountPercent' then (p_patch ->> 'wholesaleDiscountPercent')::numeric else c.wholesale_discount_percent end,
    notes = case when p_patch ? 'notes' then coalesce(p_patch ->> 'notes', '') else c.notes end
  where c.id = p_customer_id returning c.* into new_row;
  if nullif(new_row.name, '') is null then raise exception using errcode = '22023', message = 'customer name is required'; end if;
  perform public.write_audit_event('Update', 'Customer updated', jsonb_build_object(
    'entityType', 'Customer', 'entityId', new_row.id, 'entityName', new_row.name,
    'previousValues', jsonb_build_object('name', old_row.name, 'phone', old_row.phone, 'email', old_row.email, 'address', old_row.address, 'isWholesaleBuyer', old_row.is_wholesale_buyer, 'wholesaleDiscountPercent', old_row.wholesale_discount_percent, 'notes', old_row.notes),
    'newValues', jsonb_build_object('name', new_row.name, 'phone', new_row.phone, 'email', new_row.email, 'address', new_row.address, 'isWholesaleBuyer', new_row.is_wholesale_buyer, 'wholesaleDiscountPercent', new_row.wholesale_discount_percent, 'notes', new_row.notes)
  ));
end
$$;

create or replace function public.update_product_pricing(
  p_product_type text, p_product_id text, p_retail_price numeric, p_wholesale_price numeric,
  p_currency text, p_retail_mode text, p_wholesale_mode text
)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare snapshot jsonb; old_retail numeric; old_wholesale numeric; item_name text; currency_code varchar(3) := upper(btrim(p_currency)); final_cost numeric;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  if p_product_type not in ('weapon', 'accessory', 'ammunition') or p_retail_price <= 0 or p_wholesale_price <= 0
     or p_retail_mode not in ('auto', 'manual') or p_wholesale_mode not in ('auto', 'manual') then
    raise exception using errcode = '22023', message = 'invalid product pricing';
  end if;
  snapshot := public.currency_snapshot(currency_code);
  select cs.final_landed_base_amount into final_cost from public.inventory_cost_snapshots as cs
  where cs.product_type = p_product_type and cs.product_id = p_product_id;
  if final_cost is not null and (round(p_retail_price / (snapshot ->> 'exchangeRate')::numeric, 4) < final_cost
     or round(p_wholesale_price / (snapshot ->> 'exchangeRate')::numeric, 4) < final_cost) then
    raise exception using errcode = '23514', message = 'selling price cannot be below final cost';
  end if;
  if p_product_type = 'weapon' then
    select w.retail_price, w.wholesale_price, w.serial_number into old_retail, old_wholesale, item_name from public.weapons as w where w.id = p_product_id for update;
    update public.weapons as w set retail_price = p_retail_price, wholesale_price = p_wholesale_price,
      retail_price_valuation = public.money_valuation(p_retail_price, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      wholesale_price_valuation = public.money_valuation(p_wholesale_price, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      retail_price_mode = p_retail_mode, wholesale_price_mode = p_wholesale_mode where w.id = p_product_id;
  elsif p_product_type = 'accessory' then
    select a.retail_price, a.wholesale_price, a.name into old_retail, old_wholesale, item_name from public.accessories as a where a.id = p_product_id for update;
    update public.accessories as a set retail_price = p_retail_price, wholesale_price = p_wholesale_price,
      retail_price_valuation = public.money_valuation(p_retail_price, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      wholesale_price_valuation = public.money_valuation(p_wholesale_price, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      retail_price_mode = p_retail_mode, wholesale_price_mode = p_wholesale_mode where a.id = p_product_id;
  else
    select a.retail_price, a.wholesale_price, a.caliber into old_retail, old_wholesale, item_name from public.ammunition as a where a.id = p_product_id for update;
    update public.ammunition as a set retail_price = p_retail_price, wholesale_price = p_wholesale_price,
      retail_price_valuation = public.money_valuation(p_retail_price, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      wholesale_price_valuation = public.money_valuation(p_wholesale_price, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      retail_price_mode = p_retail_mode, wholesale_price_mode = p_wholesale_mode where a.id = p_product_id;
  end if;
  if item_name is null then raise exception using errcode = 'P0002', message = 'inventory product not found'; end if;
  perform public.write_audit_event('Update', 'Product prices updated', jsonb_build_object(
    'entityType', initcap(p_product_type), 'entityId', p_product_id, 'entityName', item_name, 'currency', currency_code,
    'previousValues', jsonb_build_object('retailPrice', old_retail, 'wholesalePrice', old_wholesale),
    'newValues', jsonb_build_object('retailPrice', p_retail_price, 'wholesalePrice', p_wholesale_price, 'retailPriceMode', p_retail_mode, 'wholesalePriceMode', p_wholesale_mode)
  ));
end
$$;

-- Creation remains atomic: accounting cost, landed-cost components and both
-- editable selling prices are committed in one transaction.
create or replace function public.create_inventory_product(p_product_type text, p_product jsonb, p_costs jsonb default '[]'::jsonb)
returns text language plpgsql volatile security definer set search_path = public, auth as $$
declare product_id text; currency_code varchar(3); snapshot jsonb; cost numeric; retail numeric; wholesale numeric;
begin
  if not public.can_change_inventory() then raise exception using errcode = '42501', message = 'inventory permission is required'; end if;
  if p_product_type not in ('accessory', 'ammunition') then raise exception using errcode = '22023', message = 'invalid inventory product type'; end if;
  product_id := coalesce(nullif(btrim(p_product ->> 'id'), ''), public.next_business_id(case when p_product_type = 'accessory' then 'ACC' else 'AMM' end));
  cost := (p_product ->> 'price')::numeric;
  retail := (p_product ->> 'retail_price')::numeric;
  wholesale := (p_product ->> 'wholesale_price')::numeric;
  if cost < 0 or retail < cost or wholesale < cost or wholesale > retail then raise exception using errcode = '23514', message = 'selling prices must cover final cost and wholesale cannot exceed retail'; end if;
  select coalesce(upper(nullif(btrim(p_product ->> 'price_currency'), '')), s.currency_code) into currency_code from public.system_settings as s where s.id = 1;
  snapshot := public.currency_snapshot(currency_code);
  if p_product_type = 'accessory' then
    insert into public.accessories (
      id, name, type, quantity, safety_threshold, price, price_currency, price_valuation,
      retail_price, wholesale_price, retail_price_valuation, wholesale_price_valuation,
      retail_price_mode, wholesale_price_mode, date_added, warehouse, shelf, bin
    ) values (
      product_id, btrim(p_product ->> 'name'), btrim(p_product ->> 'type'), (p_product ->> 'quantity')::integer,
      (p_product ->> 'safety_threshold')::integer, cost, currency_code,
      public.money_valuation(cost, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      retail, wholesale,
      public.money_valuation(retail, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      public.money_valuation(wholesale, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      coalesce(nullif(p_product ->> 'retail_price_mode', ''), 'manual'), coalesce(nullif(p_product ->> 'wholesale_price_mode', ''), 'manual'),
      coalesce(nullif(p_product ->> 'date_added', '')::date, current_date), coalesce(p_product ->> 'warehouse', ''), coalesce(p_product ->> 'shelf', ''), coalesce(p_product ->> 'bin', '')
    );
  else
    insert into public.ammunition (
      id, name, caliber, package_type, units_per_package, full_packages, loose_rounds, safety_threshold,
      price, price_currency, price_valuation, retail_price, wholesale_price, retail_price_valuation,
      wholesale_price_valuation, retail_price_mode, wholesale_price_mode, date_added, warehouse, shelf, bin
    ) values (
      product_id, coalesce(nullif(btrim(p_product ->> 'name'), ''), btrim(p_product ->> 'caliber')), btrim(p_product ->> 'caliber'),
      coalesce(nullif(p_product ->> 'package_type', ''), 'Box'), (p_product ->> 'units_per_package')::integer,
      (p_product ->> 'full_packages')::integer, (p_product ->> 'loose_rounds')::integer, (p_product ->> 'safety_threshold')::integer,
      cost, currency_code, public.money_valuation(cost, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      retail, wholesale,
      public.money_valuation(retail, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      public.money_valuation(wholesale, currency_code, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      coalesce(nullif(p_product ->> 'retail_price_mode', ''), 'manual'), coalesce(nullif(p_product ->> 'wholesale_price_mode', ''), 'manual'),
      coalesce(nullif(p_product ->> 'date_added', '')::date, current_date), coalesce(p_product ->> 'warehouse', ''), coalesce(p_product ->> 'shelf', ''), coalesce(p_product ->> 'bin', '')
    );
  end if;
  perform public.replace_product_costs(p_product_type, product_id, coalesce(p_costs, '[]'::jsonb));
  perform public.write_audit_event('Intake', 'Product created', jsonb_build_object('entityType', initcap(p_product_type), 'entityId', product_id, 'entityName', coalesce(p_product ->> 'name', p_product ->> 'caliber'), 'newValues', jsonb_build_object('finalCost', cost, 'retailPrice', retail, 'wholesalePrice', wholesale, 'currency', currency_code)));
  return product_id;
end
$$;

create or replace function public.apply_receipt_current_cost()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare old_cost numeric; old_retail numeric; old_wholesale numeric; retail_mode text; wholesale_mode text; item_name text;
  settings_row public.system_settings%rowtype; currency_row public.currencies%rowtype; snapshot jsonb; new_retail numeric; new_wholesale numeric;
begin
  if new.transaction_type <> 'receipt' or new.unit_amount is null then return new; end if;
  select * into settings_row from public.system_settings where id = 1;
  select * into currency_row from public.currencies where iso_code = new.currency;
  snapshot := new.valuation;
  if new.item_type = 'accessory' then
    select price, retail_price, wholesale_price, retail_price_mode, wholesale_price_mode, name into old_cost, old_retail, old_wholesale, retail_mode, wholesale_mode, item_name from public.accessories where id = new.item_id for update;
  elsif new.item_type = 'ammunition' then
    select price, retail_price, wholesale_price, retail_price_mode, wholesale_price_mode, caliber into old_cost, old_retail, old_wholesale, retail_mode, wholesale_mode, item_name from public.ammunition where id = new.item_id for update;
  else return new;
  end if;
  if item_name is null then raise exception using errcode = 'P0002', message = 'inventory product not found'; end if;
  new_retail := case when retail_mode = 'auto' then round(least(new.unit_amount * (1 + settings_row.maximum_markup_percent / 100), new.unit_amount / (1 - settings_row.target_retail_margin_percent / 100)), currency_row.decimal_precision) else old_retail end;
  new_wholesale := case when wholesale_mode = 'auto' then round(least(new.unit_amount * (1 + settings_row.maximum_markup_percent / 100), new.unit_amount / (1 - settings_row.target_wholesale_margin_percent / 100)), currency_row.decimal_precision) else old_wholesale end;
  if new_retail < new.unit_amount or new_wholesale < new.unit_amount then raise exception using errcode = '23514', message = 'manual selling price is below the new final cost; update pricing before receiving stock'; end if;
  if new.item_type = 'accessory' then
    update public.accessories set price = new.unit_amount, price_currency = new.currency, price_valuation = snapshot,
      retail_price = new_retail, wholesale_price = new_wholesale,
      retail_price_valuation = public.money_valuation(new_retail, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      wholesale_price_valuation = public.money_valuation(new_wholesale, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource') where id = new.item_id;
  else
    update public.ammunition set price = new.unit_amount, price_currency = new.currency, price_valuation = snapshot,
      retail_price = new_retail, wholesale_price = new_wholesale,
      retail_price_valuation = public.money_valuation(new_retail, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      wholesale_price_valuation = public.money_valuation(new_wholesale, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource') where id = new.item_id;
  end if;
  insert into public.inventory_cost_snapshots (product_type, product_id, shipment_id, shipment_item_id, original_amount, original_currency_code, original_exchange_rate, original_base_amount, product_costs_base_amount, shipment_costs_base_amount, final_landed_base_amount, base_currency_code, exchange_rate_date, rate_source, finalized_at, finalized_by)
  values (new.item_type, new.item_id, new.shipment_id, null, new.unit_amount, new.currency, (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'accountingAmount')::numeric, 0, 0, (snapshot ->> 'accountingAmount')::numeric, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource', now(), new.created_by)
  on conflict (product_type, product_id) do update set shipment_id = excluded.shipment_id, shipment_item_id = null, original_amount = excluded.original_amount, original_currency_code = excluded.original_currency_code, original_exchange_rate = excluded.original_exchange_rate, original_base_amount = excluded.original_base_amount, product_costs_base_amount = 0, shipment_costs_base_amount = 0, final_landed_base_amount = excluded.final_landed_base_amount, base_currency_code = excluded.base_currency_code, exchange_rate_date = excluded.exchange_rate_date, rate_source = excluded.rate_source, finalized_at = now(), finalized_by = excluded.finalized_by;
  perform public.write_audit_event('StockAdjustment', 'Stock received and current cost updated', jsonb_build_object('entityType', initcap(new.item_type), 'entityId', new.item_id, 'entityName', item_name, 'reason', nullif(new.notes, ''), 'previousValues', jsonb_build_object('finalCost', old_cost, 'retailPrice', old_retail, 'wholesalePrice', old_wholesale), 'newValues', jsonb_build_object('finalCost', new.unit_amount, 'retailPrice', new_retail, 'wholesalePrice', new_wholesale, 'currency', new.currency), 'shipmentId', new.shipment_id, 'quantity', new.quantity_delta));
  return new;
end
$$;

drop trigger if exists inventory_receipt_current_cost on public.inventory_transactions;
create trigger inventory_receipt_current_cost after insert on public.inventory_transactions for each row execute function public.apply_receipt_current_cost();

create or replace function public.audit_customer_created()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  perform public.write_audit_event('Intake', 'Customer created', jsonb_build_object(
    'entityType', 'Customer', 'entityId', new.id, 'entityName', new.name,
    'newValues', jsonb_build_object('name', new.name, 'phone', new.phone, 'email', new.email, 'address', new.address, 'isWholesaleBuyer', new.is_wholesale_buyer)
  ));
  return new;
end
$$;
drop trigger if exists customer_created_audit on public.customers;
create trigger customer_created_audit after insert on public.customers for each row execute function public.audit_customer_created();

revoke all on function public.create_inventory_product_type(text, text) from public, anon;
revoke all on function public.update_customer(text, jsonb) from public, anon;
revoke all on function public.update_product_pricing(text, text, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.create_inventory_product_type(text, text) to authenticated;
grant execute on function public.update_customer(text, jsonb) to authenticated;
grant execute on function public.update_product_pricing(text, text, numeric, numeric, text, text, text) to authenticated;
revoke all on function public.apply_receipt_current_cost() from public, anon, authenticated;
revoke all on function public.audit_customer_created() from public, anon, authenticated;

commit;
