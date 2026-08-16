begin;

create or replace function public.update_weapon_details(p_weapon_id text, p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  allowed_keys constant text[] := array[
    'serialNumber', 'weaponTypeId', 'weaponSubtypeId', 'caliberId', 'brandId', 'modelId',
    'storageLocationId', 'supplierId', 'condition', 'purchasePrice', 'retailPrice', 'wholesalePrice',
    'retailPriceMode', 'wholesalePriceMode', 'currency'
  ];
  required_keys constant text[] := array[
    'serialNumber', 'weaponTypeId', 'weaponSubtypeId', 'caliberId', 'brandId', 'modelId',
    'condition', 'purchasePrice', 'retailPrice', 'wholesalePrice', 'retailPriceMode', 'wholesalePriceMode', 'currency'
  ];
  previous_row public.weapons%rowtype;
  v_serial_number text;
  currency_code varchar(3);
  v_purchase_price numeric;
  v_retail_price numeric;
  v_wholesale_price numeric;
  rate_snapshot jsonb;
  purchase_valuation jsonb;
  retail_valuation jsonb;
  wholesale_valuation jsonb;
  actor_id text;
begin
  if not public.can_change_inventory() then
    raise exception using errcode = '42501', message = 'inventory edit permission is required';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or not (p_patch ?& required_keys)
    or (p_patch - allowed_keys) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'invalid weapon details payload';
  end if;

  select * into previous_row from public.weapons where id = p_weapon_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'weapon not found'; end if;

  v_serial_number := btrim(p_patch ->> 'serialNumber');
  currency_code := upper(btrim(p_patch ->> 'currency'));
  v_purchase_price := (p_patch ->> 'purchasePrice')::numeric;
  v_retail_price := (p_patch ->> 'retailPrice')::numeric;
  v_wholesale_price := (p_patch ->> 'wholesalePrice')::numeric;
  if v_serial_number = '' or char_length(v_serial_number) > 200 then
    raise exception using errcode = '22023', message = 'a valid serial number is required';
  end if;
  if currency_code !~ '^[A-Z]{3}$' then raise exception using errcode = '22023', message = 'a valid currency is required'; end if;
  if v_purchase_price < 0 or v_retail_price < 0 or v_wholesale_price < 0 then
    raise exception using errcode = '22023', message = 'weapon prices cannot be negative';
  end if;
  if v_wholesale_price > v_retail_price then raise exception using errcode = '22023', message = 'wholesale price cannot exceed retail price'; end if;
  if p_patch ->> 'condition' not in ('Excellent', 'Good', 'Fair', 'Poor') then raise exception using errcode = '22023', message = 'invalid weapon condition'; end if;
  if p_patch ->> 'retailPriceMode' not in ('auto', 'manual') or p_patch ->> 'wholesalePriceMode' not in ('auto', 'manual') then
    raise exception using errcode = '22023', message = 'invalid pricing mode';
  end if;
  if exists (select 1 from public.weapons as weapon where lower(btrim(weapon.serial_number)) = lower(v_serial_number) and weapon.id <> p_weapon_id and weapon.deleted_at is null) then
    raise exception using errcode = '23505', message = 'serial number already exists';
  end if;
  if not exists (select 1 from public.weapon_subtypes where id = p_patch ->> 'weaponSubtypeId' and weapon_type_id = p_patch ->> 'weaponTypeId') then
    raise exception using errcode = '23503', message = 'weapon type and subtype do not match';
  end if;
  if not exists (select 1 from public.models where id = p_patch ->> 'modelId' and brand_id = p_patch ->> 'brandId')
    or not exists (select 1 from public.brands where id = p_patch ->> 'brandId') then
    raise exception using errcode = '23503', message = 'weapon brand and model do not match';
  end if;
  if not exists (select 1 from public.calibers where id = p_patch ->> 'caliberId') then
    raise exception using errcode = '23503', message = 'caliber not found';
  end if;
  if exists (select 1 from public.subtype_calibers where subtype_id = p_patch ->> 'weaponSubtypeId')
    and not exists (select 1 from public.subtype_calibers where subtype_id = p_patch ->> 'weaponSubtypeId' and caliber_id = p_patch ->> 'caliberId') then
    raise exception using errcode = '23503', message = 'caliber is not valid for the selected subtype';
  end if;
  if nullif(p_patch ->> 'supplierId', '') is not null and not exists (select 1 from public.suppliers where id = p_patch ->> 'supplierId') then
    raise exception using errcode = '23503', message = 'supplier not found';
  end if;
  if nullif(p_patch ->> 'storageLocationId', '') is not null and not exists (select 1 from public.storage_locations where id = p_patch ->> 'storageLocationId') then
    raise exception using errcode = '23503', message = 'storage location not found';
  end if;

  rate_snapshot := public.currency_snapshot(currency_code);
  purchase_valuation := public.money_valuation(v_purchase_price, currency_code, rate_snapshot ->> 'accountingCurrency', (rate_snapshot ->> 'exchangeRate')::numeric, (rate_snapshot ->> 'exchangeRateDate')::timestamptz, rate_snapshot ->> 'rateSource');
  retail_valuation := public.money_valuation(v_retail_price, currency_code, rate_snapshot ->> 'accountingCurrency', (rate_snapshot ->> 'exchangeRate')::numeric, (rate_snapshot ->> 'exchangeRateDate')::timestamptz, rate_snapshot ->> 'rateSource');
  wholesale_valuation := public.money_valuation(v_wholesale_price, currency_code, rate_snapshot ->> 'accountingCurrency', (rate_snapshot ->> 'exchangeRate')::numeric, (rate_snapshot ->> 'exchangeRateDate')::timestamptz, rate_snapshot ->> 'rateSource');

  update public.weapons set
    serial_number = v_serial_number,
    weapon_type_id = p_patch ->> 'weaponTypeId', weapon_subtype_id = p_patch ->> 'weaponSubtypeId',
    caliber_id = p_patch ->> 'caliberId', brand_id = p_patch ->> 'brandId', model_id = p_patch ->> 'modelId',
    storage_location_id = nullif(p_patch ->> 'storageLocationId', ''), supplier_id = nullif(p_patch ->> 'supplierId', ''),
    condition = p_patch ->> 'condition', purchase_price = v_purchase_price, retail_price = v_retail_price, wholesale_price = v_wholesale_price,
    retail_price_mode = p_patch ->> 'retailPriceMode', wholesale_price_mode = p_patch ->> 'wholesalePriceMode',
    purchase_price_valuation = purchase_valuation, retail_price_valuation = retail_valuation, wholesale_price_valuation = wholesale_valuation
  where id = p_weapon_id;

  actor_id := public.current_app_user_id();
  insert into public.audit_logs(id, timestamp, date, user_id, action_type, description, metadata)
  values ('AUD-' || gen_random_uuid()::text, now(), current_date, actor_id, 'Update', 'Weapon ' || v_serial_number || ' details updated',
    jsonb_build_object('entityType', 'weapon', 'entityId', p_weapon_id, 'previousValues', to_jsonb(previous_row), 'newValues', p_patch));
end
$$;

revoke all on function public.update_weapon_details(text, jsonb) from public, anon;
grant execute on function public.update_weapon_details(text, jsonb) to authenticated;

commit;
