begin;

-- Legacy rows predate immutable invoice cost snapshots. Use a base valuation
-- only when it is in the accounting currency, existed by the requested date,
-- and no additional product/shipment costs can make it incomplete.
create or replace function public.trusted_product_base_cost(
  p_product_type text,
  p_product_id text,
  p_accounting_currency text,
  p_as_of timestamptz default now()
)
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  valuation jsonb;
  related_shipment_id text;
begin
  case p_product_type
    when 'weapon' then
      select weapon.purchase_price_valuation, weapon.shipment_id
      into valuation, related_shipment_id
      from public.weapons as weapon
      where weapon.id = p_product_id;
    when 'accessory' then
      select accessory.price_valuation
      into valuation
      from public.accessories as accessory
      where accessory.id = p_product_id;
    when 'ammunition' then
      select ammunition.price_valuation
      into valuation
      from public.ammunition as ammunition
      where ammunition.id = p_product_id;
    else
      return null;
  end case;

  if valuation is null
    or jsonb_typeof(valuation -> 'accountingAmount') <> 'number'
    or valuation ->> 'accountingCurrency' <> p_accounting_currency
    or nullif(valuation ->> 'exchangeRateDate', '') is null
    or (valuation ->> 'exchangeRateDate')::timestamptz > p_as_of
    or exists (
      select 1 from public.product_costs as cost
      where cost.product_type = p_product_type and cost.product_id = p_product_id
    ) then
    return null;
  end if;

  if p_product_type = 'weapon' then
    if exists (
      select 1 from public.shipment_costs as cost
      where cost.shipment_id = related_shipment_id
    ) then
      return null;
    end if;
  elsif exists (
    select 1
    from public.inventory_transactions as transaction
    join public.shipment_costs as cost on cost.shipment_id = transaction.shipment_id
    where transaction.item_type = p_product_type
      and transaction.item_id = p_product_id
  ) then
    return null;
  end if;

  return (valuation ->> 'accountingAmount')::numeric;
end
$$;

-- Freeze every safely reconstructable legacy line onto the invoice itself.
with rebuilt_invoices as (
  select
    invoice.id,
    jsonb_agg(
      case
        when line.value ? 'unitLandedCostAccounting' or trusted.unit_cost is null then line.value
        else line.value || jsonb_build_object(
          'unitLandedCostAccounting', trusted.unit_cost,
          'costAccountingCurrency', invoice.accounting_currency,
          'costSnapshotFinalizedAt', invoice.created_at,
          'costSnapshotSource', 'trusted-base-valuation-backfill'
        )
      end
      order by line.ordinality
    ) as line_items,
    bool_or(not (line.value ? 'unitLandedCostAccounting') and trusted.unit_cost is not null) as changed
  from public.invoices as invoice
  cross join lateral jsonb_array_elements(invoice.line_items) with ordinality as line(value, ordinality)
  left join lateral (
    select public.trusted_product_base_cost(
      line.value ->> 'itemType',
      line.value ->> 'itemId',
      invoice.accounting_currency,
      invoice.created_at
    ) as unit_cost
  ) as trusted on true
  where invoice.type = 'Sale' and not invoice.voided
  group by invoice.id
)
update public.invoices as invoice
set line_items = rebuilt.line_items
from rebuilt_invoices as rebuilt
where rebuilt.id = invoice.id and rebuilt.changed;

-- Keep all future invoices immutable at creation time, with the same strict
-- fallback when a finalized landed-cost snapshot is not present.
create or replace function public.capture_sale_line_cost_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  line jsonb;
  enriched_lines jsonb := '[]'::jsonb;
  landed_cost numeric(20, 4);
  cost_currency text;
  finalized_at timestamptz;
  trusted_base_cost numeric(20, 4);
begin
  if new.type <> 'Sale' or jsonb_typeof(new.line_items) <> 'array' then
    return new;
  end if;

  for line in select value from jsonb_array_elements(new.line_items) loop
    if not (line ? 'unitLandedCostAccounting') then
      select snapshot.final_landed_base_amount, snapshot.base_currency_code, snapshot.finalized_at
      into landed_cost, cost_currency, finalized_at
      from public.inventory_cost_snapshots as snapshot
      where snapshot.product_type = line ->> 'itemType'
        and snapshot.product_id = line ->> 'itemId'
        and snapshot.base_currency_code = new.accounting_currency;

      if landed_cost is not null then
        line := line || jsonb_build_object(
          'unitLandedCostAccounting', landed_cost,
          'costAccountingCurrency', cost_currency,
          'costSnapshotFinalizedAt', finalized_at
        );
      else
        trusted_base_cost := public.trusted_product_base_cost(
          line ->> 'itemType', line ->> 'itemId', new.accounting_currency, new.created_at
        );
        if trusted_base_cost is not null then
          line := line || jsonb_build_object(
            'unitLandedCostAccounting', trusted_base_cost,
            'costAccountingCurrency', new.accounting_currency,
            'costSnapshotFinalizedAt', new.created_at,
            'costSnapshotSource', 'trusted-base-valuation'
          );
        end if;
      end if;
    end if;
    enriched_lines := enriched_lines || jsonb_build_array(line);
    landed_cost := null;
    cost_currency := null;
    finalized_at := null;
    trusted_base_cost := null;
  end loop;

  new.line_items := enriched_lines;
  return new;
end
$$;

-- Upgrade the installed dashboard function without duplicating its large,
-- carefully reviewed aggregation query in a second migration. Fresh databases
-- already receive these expressions from migration 007.
do $$
declare
  definition text;
  upgraded text;
begin
  select pg_get_functiondef('public.dashboard_analytics(date,date)'::regprocedure)
  into definition;

  upgraded := replace(
    definition,
    '      snapshot.final_landed_base_amount as unit_cost,',
    '      coalesce(
        snapshot.final_landed_base_amount,
        public.trusted_product_base_cost(''weapon'', weapon.id, (select accounting_currency_code from public.system_settings where id = 1), now())
      ) as unit_cost,'
  );
  upgraded := replace(
    upgraded,
    '      accessory.date_added, snapshot.final_landed_base_amount,',
    '      accessory.date_added, coalesce(
        snapshot.final_landed_base_amount,
        public.trusted_product_base_cost(''accessory'', accessory.id, (select accounting_currency_code from public.system_settings where id = 1), now())
      ),'
  );
  upgraded := replace(
    upgraded,
    '      ammunition.safety_threshold::numeric, ammunition.date_added, snapshot.final_landed_base_amount,',
    '      ammunition.safety_threshold::numeric, ammunition.date_added, coalesce(
        snapshot.final_landed_base_amount,
        public.trusted_product_base_cost(''ammunition'', ammunition.id, (select accounting_currency_code from public.system_settings where id = 1), now())
      ),'
  );

  if upgraded <> definition then
    execute upgraded;
  end if;
end
$$;

commit;
