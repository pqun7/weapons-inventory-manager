begin;

create table if not exists public.stock_operation_receipts (
  operation_id uuid primary key,
  request_hash text not null,
  item_type text not null check (item_type in ('accessory', 'ammunition')),
  item_id text not null,
  created_at timestamptz not null default now()
);
alter table public.stock_operation_receipts enable row level security;
revoke all on public.stock_operation_receipts from public, anon, authenticated;

create or replace function public.adjust_inventory_stock_v2(
  p_operation_id uuid,
  p_item_type text,
  p_item_id text,
  p_quantity_delta integer,
  p_cost_update jsonb,
  p_shipment_id text,
  p_notes text,
  p_location jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  request_hash text;
  prior_hash text;
  cost_amount numeric;
  cost_currency text;
  actor_id text;
  snapshot jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'stock operation ID is required';
  end if;
  request_hash := md5(jsonb_build_object(
    'itemType', p_item_type, 'itemId', p_item_id,
    'quantityDelta', p_quantity_delta, 'costUpdate', coalesce(p_cost_update, 'null'::jsonb),
    'shipmentId', p_shipment_id, 'notes', p_notes, 'location', p_location
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select r.request_hash into prior_hash from public.stock_operation_receipts as r where r.operation_id = p_operation_id;
  if found then
    if prior_hash <> request_hash then
      raise exception using errcode = '23505', message = 'stock operation ID was already used for a different request';
    end if;
    return;
  end if;

  if not public.can_change_inventory() then
    raise exception using errcode = '42501', message = 'inventory permission is required';
  end if;
  if p_item_type not in ('accessory', 'ammunition') or nullif(btrim(p_item_id), '') is null then
    raise exception using errcode = '22023', message = 'invalid inventory item';
  end if;
  if p_quantity_delta < 0 then
    raise exception using errcode = '22023', message = 'quantity cannot be negative';
  end if;
  if p_cost_update is not null then
    cost_amount := (p_cost_update ->> 'amount')::numeric;
    cost_currency := upper(btrim(coalesce(p_cost_update ->> 'currency', '')));
    if cost_amount < 0 or cost_currency = '' then
      raise exception using errcode = '22023', message = 'current cost and currency are invalid';
    end if;
  end if;
  if p_quantity_delta = 0 and p_cost_update is null then
    raise exception using errcode = '22023', message = 'stock or current cost must change';
  end if;

  if p_quantity_delta > 0 then
    perform public.adjust_inventory_stock(
      p_item_type, p_item_id,
      case when p_item_type = 'accessory' then p_quantity_delta else 0 end,
      0,
      case when p_item_type = 'ammunition' then p_quantity_delta else 0 end,
      null,
      cost_amount,
      cost_currency,
      p_shipment_id,
      coalesce(p_notes, ''),
      p_location
    );
  else
    select u.id into actor_id from public.users as u
    where u.auth_user_id = auth.uid() and u.is_active limit 1;
    if actor_id is null then
      raise exception using errcode = '42501', message = 'authenticated application user is required';
    end if;
    if p_item_type = 'accessory' then
      update public.accessories set
        warehouse = coalesce(p_location ->> 'warehouse', warehouse),
        shelf = coalesce(p_location ->> 'shelf', shelf),
        bin = coalesce(p_location ->> 'bin', bin)
      where id = p_item_id;
    else
      update public.ammunition set
        warehouse = coalesce(p_location ->> 'warehouse', warehouse),
        shelf = coalesce(p_location ->> 'shelf', shelf),
        bin = coalesce(p_location ->> 'bin', bin)
      where id = p_item_id;
    end if;
    if not found then raise exception using errcode = 'P0002', message = 'inventory item not found'; end if;

    snapshot := public.currency_snapshot(cost_currency);
    insert into public.inventory_transactions (
      id, item_type, item_id, transaction_type, quantity_delta, unit_amount,
      currency, valuation, shipment_id, notes, created_by
    ) values (
      public.next_business_id('ITX'), p_item_type, p_item_id, 'receipt', 0, cost_amount,
      cost_currency,
      public.money_valuation(cost_amount, cost_currency, snapshot ->> 'accountingCurrency',
        (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz,
        snapshot ->> 'rateSource'),
      p_shipment_id, coalesce(p_notes, ''), actor_id
    );
  end if;

  insert into public.stock_operation_receipts (operation_id, request_hash, item_type, item_id)
  values (p_operation_id, request_hash, p_item_type, p_item_id);
end;
$$;

revoke all on function public.adjust_inventory_stock_v2(uuid, text, text, integer, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.adjust_inventory_stock_v2(uuid, text, text, integer, jsonb, text, text, jsonb) to authenticated;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.apply_receipt_current_cost()'::regprocedure) into definition;
  patched := replace(
    definition,
    E'product_costs_base_amount = 0,\n    shipment_costs_base_amount = 0,\n    final_landed_base_amount = excluded.final_landed_base_amount,',
    E'product_costs_base_amount = inventory_cost_snapshots.product_costs_base_amount,\n    shipment_costs_base_amount = inventory_cost_snapshots.shipment_costs_base_amount,\n    final_landed_base_amount = excluded.original_base_amount + inventory_cost_snapshots.product_costs_base_amount + inventory_cost_snapshots.shipment_costs_base_amount,'
  );
  if patched = definition then
    raise exception 'receipt cost snapshot preservation patch did not match the installed function';
  end if;
  execute patched;
end
$$;

commit;
