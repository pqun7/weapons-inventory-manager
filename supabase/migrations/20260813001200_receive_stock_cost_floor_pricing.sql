begin;

create or replace function public.apply_receipt_current_cost()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  old_cost numeric;
  old_retail numeric;
  old_wholesale numeric;
  retail_mode text;
  wholesale_mode text;
  item_name text;
  settings_row public.system_settings%rowtype;
  currency_row public.currencies%rowtype;
  snapshot jsonb;
  new_retail numeric;
  new_wholesale numeric;
  manual_price_adjusted boolean := false;
begin
  if current_setting('weapon_store.restore_mode', true) = 'on' then return new; end if;
  if new.transaction_type <> 'receipt' or new.unit_amount is null then return new; end if;

  select * into settings_row from public.system_settings where id = 1;
  select * into currency_row from public.currencies where iso_code = new.currency;
  if currency_row.iso_code is null then
    raise exception using errcode = '22023', message = 'receipt currency is not configured';
  end if;
  snapshot := new.valuation;

  if new.item_type = 'accessory' then
    select price, retail_price, wholesale_price, retail_price_mode, wholesale_price_mode, name
    into old_cost, old_retail, old_wholesale, retail_mode, wholesale_mode, item_name
    from public.accessories where id = new.item_id for update;
  elsif new.item_type = 'ammunition' then
    select price, retail_price, wholesale_price, retail_price_mode, wholesale_price_mode, caliber
    into old_cost, old_retail, old_wholesale, retail_mode, wholesale_mode, item_name
    from public.ammunition where id = new.item_id for update;
  else
    return new;
  end if;

  if item_name is null then
    raise exception using errcode = 'P0002', message = 'inventory product not found';
  end if;

  new_retail := case
    when retail_mode = 'auto' then round(least(
      new.unit_amount * (1 + settings_row.maximum_markup_percent / 100),
      new.unit_amount / (1 - settings_row.target_retail_margin_percent / 100)
    ), currency_row.decimal_precision)
    else greatest(coalesce(old_retail, 0), new.unit_amount)
  end;
  new_wholesale := case
    when wholesale_mode = 'auto' then round(least(
      new.unit_amount * (1 + settings_row.maximum_markup_percent / 100),
      new.unit_amount / (1 - settings_row.target_wholesale_margin_percent / 100)
    ), currency_row.decimal_precision)
    else greatest(coalesce(old_wholesale, 0), new.unit_amount)
  end;
  new_wholesale := least(new_wholesale, new_retail);
  manual_price_adjusted := (retail_mode = 'manual' and new_retail <> old_retail)
    or (wholesale_mode = 'manual' and new_wholesale <> old_wholesale);

  if new.item_type = 'accessory' then
    update public.accessories
    set price = new.unit_amount,
        price_currency = new.currency,
        price_valuation = snapshot,
        retail_price = new_retail,
        wholesale_price = new_wholesale,
        retail_price_valuation = public.money_valuation(new_retail, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
        wholesale_price_valuation = public.money_valuation(new_wholesale, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource')
    where id = new.item_id;
  else
    update public.ammunition
    set price = new.unit_amount,
        price_currency = new.currency,
        price_valuation = snapshot,
        retail_price = new_retail,
        wholesale_price = new_wholesale,
        retail_price_valuation = public.money_valuation(new_retail, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
        wholesale_price_valuation = public.money_valuation(new_wholesale, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource')
    where id = new.item_id;
  end if;

  insert into public.inventory_cost_snapshots (
    product_type, product_id, shipment_id, shipment_item_id,
    original_amount, original_currency_code, original_exchange_rate,
    original_base_amount, product_costs_base_amount, shipment_costs_base_amount,
    final_landed_base_amount, base_currency_code, exchange_rate_date,
    rate_source, finalized_at, finalized_by
  ) values (
    new.item_type, new.item_id, new.shipment_id, null,
    new.unit_amount, new.currency, (snapshot ->> 'exchangeRate')::numeric,
    (snapshot ->> 'accountingAmount')::numeric, 0, 0,
    (snapshot ->> 'accountingAmount')::numeric, snapshot ->> 'accountingCurrency',
    (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource',
    now(), new.created_by
  )
  on conflict (product_type, product_id) do update set
    shipment_id = excluded.shipment_id,
    shipment_item_id = null,
    original_amount = excluded.original_amount,
    original_currency_code = excluded.original_currency_code,
    original_exchange_rate = excluded.original_exchange_rate,
    original_base_amount = excluded.original_base_amount,
    product_costs_base_amount = 0,
    shipment_costs_base_amount = 0,
    final_landed_base_amount = excluded.final_landed_base_amount,
    base_currency_code = excluded.base_currency_code,
    exchange_rate_date = excluded.exchange_rate_date,
    rate_source = excluded.rate_source,
    finalized_at = now(),
    finalized_by = excluded.finalized_by;

  perform public.write_audit_event(
    'StockAdjustment',
    case when manual_price_adjusted
      then 'Stock received; selling price adjusted to cover the new final cost'
      else 'Stock received and current cost updated'
    end,
    jsonb_build_object(
      'entityType', initcap(new.item_type),
      'entityId', new.item_id,
      'entityName', item_name,
      'reason', nullif(new.notes, ''),
      'previousValues', jsonb_build_object('finalCost', old_cost, 'retailPrice', old_retail, 'wholesalePrice', old_wholesale),
      'newValues', jsonb_build_object('finalCost', new.unit_amount, 'retailPrice', new_retail, 'wholesalePrice', new_wholesale, 'currency', new.currency),
      'manualPriceAdjustedToCostFloor', manual_price_adjusted,
      'shipmentId', new.shipment_id,
      'quantity', new.quantity_delta
    )
  );
  return new;
end
$$;

commit;
