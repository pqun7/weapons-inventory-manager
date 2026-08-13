begin;

-- A historical/base valuation is trustworthy only while no product- or
-- shipment-level landed costs exist outside that valuation. This conservative
-- fallback lets legacy records participate without pretending that an
-- incomplete landed cost is complete.
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

-- Profit must use the cost known at the moment of sale. Current inventory cost is
-- deliberately never used to backfill historical invoices.
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

drop trigger if exists capture_sale_line_cost_snapshots_before_insert on public.invoices;
create trigger capture_sale_line_cost_snapshots_before_insert
before insert on public.invoices
for each row execute function public.capture_sale_line_cost_snapshots();

-- This partial index supports the primary dashboard period predicate without
-- indexing voided or purchase invoices that never participate in sales analytics.
create index if not exists idx_invoices_dashboard_sales_period
on public.invoices(date desc)
where type = 'Sale' and not voided;

create or replace function public.dashboard_analytics(
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'invalid dashboard date range';
  end if;
  if p_end_date - p_start_date > 731 then
    raise exception using errcode = '22023', message = 'dashboard date range cannot exceed two years';
  end if;

  with
  date_params as (
    select
      p_start_date as start_date,
      p_end_date as end_date,
      p_start_date - ((p_end_date - p_start_date) + 1) as previous_start,
      p_start_date - 1 as previous_end,
      case
        when p_end_date - p_start_date <= 31 then 'day'
        when p_end_date - p_start_date <= 180 then 'week'
        else 'month'
      end as bucket
  ),
  scoped_sales as (
    select
      invoice.*,
      case when invoice.date between params.start_date and params.end_date then 'current' else 'previous' end as period_scope
    from public.invoices as invoice
    cross join date_params as params
    where invoice.type = 'Sale'
      and not invoice.voided
      and invoice.date between params.previous_start and params.end_date
  ),
  raw_lines as (
    select
      sale.id as invoice_id,
      sale.date as sale_date,
      sale.period_scope,
      sale.total_negotiated_accounting as invoice_revenue,
      line.value as line,
      coalesce(nullif(line.value ->> 'name', ''), line.value ->> 'itemId', '') as product_name,
      coalesce(nullif(line.value ->> 'itemType', ''), 'weapon') as category,
      case coalesce(nullif(line.value ->> 'itemType', ''), 'weapon')
        when 'weapon' then coalesce((
          select weapon_type.label
          from public.weapons as weapon
          join public.weapon_types as weapon_type on weapon_type.id = weapon.weapon_type_id
          where weapon.id = line.value ->> 'itemId'
        ), 'weapon')
        when 'ammunition' then coalesce((
          select nullif(ammunition.caliber, '')
          from public.ammunition as ammunition
          where ammunition.id = line.value ->> 'itemId'
        ), 'ammunition')
        when 'accessory' then coalesce((
          select nullif(accessory.type, '')
          from public.accessories as accessory
          where accessory.id = line.value ->> 'itemId'
        ), 'accessory')
      end as segment,
      coalesce(nullif(line.value ->> 'itemId', ''), coalesce(line.value ->> 'name', '')) as product_id,
      greatest(coalesce((line.value ->> 'quantity')::numeric, 0), 0) as quantity,
      greatest(coalesce(
        (line.value ->> 'total')::numeric,
        (line.value ->> 'unitPrice')::numeric * (line.value ->> 'quantity')::numeric,
        0
      ), 0) as original_line_total,
      case
        when jsonb_typeof(line.value -> 'unitLandedCostAccounting') = 'number'
          then (line.value ->> 'unitLandedCostAccounting')::numeric
        else null
      end as unit_cost
    from scoped_sales as sale
    cross join lateral jsonb_array_elements(sale.line_items) as line(value)
    where jsonb_typeof(sale.line_items) = 'array'
  ),
  weighted_lines as (
    select raw.*, sum(raw.original_line_total) over (partition by raw.invoice_id) as invoice_line_total
    from raw_lines as raw
  ),
  allocated_lines as (
    select
      weighted.*,
      case when weighted.invoice_line_total > 0
        then weighted.invoice_revenue * weighted.original_line_total / weighted.invoice_line_total
        else 0
      end as allocated_revenue,
      case when weighted.unit_cost is not null then weighted.unit_cost * weighted.quantity else null end as line_cost
    from weighted_lines as weighted
  ),
  invoice_costs as (
    select
      line.invoice_id,
      coalesce(sum(line.line_cost), 0) as cost,
      bool_and(line.line_cost is not null) as cost_complete,
      count(*) as line_count,
      count(line.line_cost) as covered_lines
    from allocated_lines as line
    group by line.invoice_id
  ),
  scope_names as (select 'current'::text as name union all select 'previous'::text),
  performance as (
    select
      scope.name,
      coalesce(sum(sale.total_negotiated_accounting), 0)::numeric as revenue,
      coalesce(sum(cost.cost), 0)::numeric as cost,
      case
        when count(sale.id) = 0 then 0::numeric
        when bool_and(coalesce(cost.cost_complete, false)) then sum(sale.total_negotiated_accounting) - coalesce(sum(cost.cost), 0)
        else null
      end as profit,
      case
        when count(sale.id) = 0 then 0::numeric
        when bool_and(coalesce(cost.cost_complete, false)) and sum(sale.total_negotiated_accounting) > 0
          then (sum(sale.total_negotiated_accounting) - coalesce(sum(cost.cost), 0)) * 100 / sum(sale.total_negotiated_accounting)
        else null
      end as margin_pct,
      count(sale.id)::integer as order_count,
      coalesce(sum((select sum((entry.value ->> 'quantity')::numeric) from jsonb_array_elements(sale.line_items) as entry(value))), 0)::numeric as units_sold,
      case when coalesce(sum(cost.line_count), 0) = 0 then 100::numeric
        else coalesce(sum(cost.covered_lines), 0) * 100.0 / sum(cost.line_count)
      end as cost_coverage_pct,
      coalesce(sum(sale.balance_accounting), 0)::numeric as receivables,
      coalesce(sum(case when sale.balance_accounting > 0 and sale.due_date < current_date then sale.balance_accounting else 0 end), 0)::numeric as overdue
    from scope_names as scope
    left join scoped_sales as sale on sale.period_scope = scope.name
    left join invoice_costs as cost on cost.invoice_id = sale.id
    group by scope.name
  ),
  trend_rows as (
    select
      case (select bucket from date_params)
        when 'day' then sale.date
        when 'week' then date_trunc('week', sale.date::timestamp)::date
        else date_trunc('month', sale.date::timestamp)::date
      end as bucket_date,
      sum(sale.total_negotiated_accounting)::numeric as revenue,
      coalesce(sum(cost.cost), 0)::numeric as cost,
      bool_and(coalesce(cost.cost_complete, false)) as cost_complete,
      coalesce(sum(cost.line_count), 0) as line_count,
      coalesce(sum(cost.covered_lines), 0) as covered_lines
    from scoped_sales as sale
    left join invoice_costs as cost on cost.invoice_id = sale.id
    where sale.period_scope = 'current'
    group by bucket_date
  ),
  category_rows as (
    select
      line.category,
      line.segment,
      sum(line.allocated_revenue)::numeric as revenue,
      coalesce(sum(line.line_cost), 0)::numeric as cost,
      bool_and(line.line_cost is not null) as cost_complete,
      sum(line.quantity)::numeric as units,
      count(*) as line_count,
      count(line.line_cost) as covered_lines
    from allocated_lines as line
    where line.period_scope = 'current'
    group by line.category, line.segment
  ),
  product_rows as (
    select
      line.category,
      lower(line.product_name) as product_key,
      max(line.product_name) as product_name,
      sum(line.allocated_revenue)::numeric as revenue,
      coalesce(sum(line.line_cost), 0)::numeric as cost,
      bool_and(line.line_cost is not null) as cost_complete,
      sum(line.quantity)::numeric as units,
      count(*) as line_count,
      count(line.line_cost) as covered_lines
    from allocated_lines as line
    where line.period_scope = 'current'
    group by line.category, lower(line.product_name)
  ),
  last_sales as (
    select
      entry.value ->> 'itemType' as category,
      entry.value ->> 'itemId' as product_id,
      max(invoice.date) as last_sale_date
    from public.invoices as invoice
    cross join lateral jsonb_array_elements(invoice.line_items) as entry(value)
    where invoice.type = 'Sale' and not invoice.voided
      and invoice.date >= current_date - 180
      and jsonb_typeof(invoice.line_items) = 'array'
    group by entry.value ->> 'itemType', entry.value ->> 'itemId'
  ),
  inventory_base as (
    select
      weapon.id,
      'weapon'::text as category,
      coalesce(nullif(btrim(concat_ws(' ', brand.label, model.label)), ''), weapon.id) as name,
      1::numeric as quantity,
      null::numeric as safety_threshold,
      weapon.date_added,
      coalesce(
        snapshot.final_landed_base_amount,
        public.trusted_product_base_cost('weapon', weapon.id, (select accounting_currency_code from public.system_settings where id = 1), now())
      ) as unit_cost,
      case when jsonb_typeof(weapon.retail_price_valuation -> 'accountingAmount') = 'number'
        then (weapon.retail_price_valuation ->> 'accountingAmount')::numeric else null end as retail_price,
      snapshot.shipment_costs_base_amount,
      sale.last_sale_date
    from public.weapons as weapon
    left join public.brands as brand on brand.id = weapon.brand_id
    left join public.models as model on model.id = weapon.model_id and model.brand_id = weapon.brand_id
    left join public.inventory_cost_snapshots as snapshot on snapshot.product_type = 'weapon' and snapshot.product_id = weapon.id
    left join last_sales as sale on sale.category = 'weapon' and sale.product_id = weapon.id
    where weapon.status = 'Available' and weapon.deleted_at is null

    union all

    select
      accessory.id, 'accessory', accessory.name, accessory.quantity::numeric, accessory.safety_threshold::numeric,
      accessory.date_added, coalesce(
        snapshot.final_landed_base_amount,
        public.trusted_product_base_cost('accessory', accessory.id, (select accounting_currency_code from public.system_settings where id = 1), now())
      ),
      case when jsonb_typeof(accessory.retail_price_valuation -> 'accountingAmount') = 'number'
        then (accessory.retail_price_valuation ->> 'accountingAmount')::numeric else null end,
      snapshot.shipment_costs_base_amount, sale.last_sale_date
    from public.accessories as accessory
    left join public.inventory_cost_snapshots as snapshot on snapshot.product_type = 'accessory' and snapshot.product_id = accessory.id
    left join last_sales as sale on sale.category = 'accessory' and sale.product_id = accessory.id

    union all

    select
      ammunition.id, 'ammunition', coalesce(nullif(ammunition.name, ''), ammunition.caliber),
      (ammunition.full_packages * ammunition.units_per_package + ammunition.loose_rounds)::numeric,
      ammunition.safety_threshold::numeric, ammunition.date_added, coalesce(
        snapshot.final_landed_base_amount,
        public.trusted_product_base_cost('ammunition', ammunition.id, (select accounting_currency_code from public.system_settings where id = 1), now())
      ),
      case when jsonb_typeof(ammunition.retail_price_valuation -> 'accountingAmount') = 'number'
        then (ammunition.retail_price_valuation ->> 'accountingAmount')::numeric else null end,
      snapshot.shipment_costs_base_amount, sale.last_sale_date
    from public.ammunition as ammunition
    left join public.inventory_cost_snapshots as snapshot on snapshot.product_type = 'ammunition' and snapshot.product_id = ammunition.id
    left join last_sales as sale on sale.category = 'ammunition' and sale.product_id = ammunition.id
  ),
  inventory_enriched as (
    select
      inventory.*,
      case when inventory.unit_cost is not null then inventory.unit_cost * inventory.quantity else null end as inventory_value,
      case when inventory.last_sale_date is not null then current_date - inventory.last_sale_date else null end as days_since_sale,
      case
        when inventory.quantity = 0 then 'out'
        when inventory.safety_threshold is not null and inventory.quantity <= inventory.safety_threshold then 'low'
        when inventory.date_added <= current_date - 180 and (inventory.last_sale_date is null or inventory.last_sale_date <= current_date - 180) then 'dead'
        when inventory.date_added <= current_date - 90 and (inventory.last_sale_date is null or inventory.last_sale_date <= current_date - 90) then 'slow'
        else 'active'
      end as inventory_status,
      case when inventory.retail_price > 0 and inventory.unit_cost is not null
        then (inventory.retail_price - inventory.unit_cost) * 100 / inventory.retail_price else null end as margin_pct,
      case when inventory.unit_cost > 0 and inventory.shipment_costs_base_amount is not null
        then inventory.shipment_costs_base_amount * 100 / inventory.unit_cost else null end as shipment_cost_share_pct
    from inventory_base as inventory
  ),
  shipment_summary as (
    select
      count(*) filter (where shipment.status in ('Pending', 'Partial'))::integer as pending,
      count(*) filter (where shipment.status = 'In Transit')::integer as in_transit,
      count(*) filter (where shipment.status = 'Delayed')::integer as delayed
    from public.shipments as shipment
    where shipment.status <> 'Cancelled'
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'accountingCurrency', coalesce((select accounting_currency_code from public.system_settings where id = 1), ''),
    'period', jsonb_build_object(
      'start', params.start_date, 'end', params.end_date,
      'previousStart', params.previous_start, 'previousEnd', params.previous_end, 'bucket', params.bucket
    ),
    'current', (
      select jsonb_build_object(
        'revenue', round(metric.revenue, 4), 'cost', round(metric.cost, 4), 'profit', round(metric.profit, 4),
        'marginPct', round(metric.margin_pct, 2), 'orderCount', metric.order_count, 'unitsSold', metric.units_sold,
        'costCoveragePct', round(metric.cost_coverage_pct, 1), 'receivables', round(metric.receivables, 4), 'overdue', round(metric.overdue, 4)
      ) from performance as metric where metric.name = 'current'
    ),
    'previous', (
      select jsonb_build_object(
        'revenue', round(metric.revenue, 4), 'cost', round(metric.cost, 4), 'profit', round(metric.profit, 4),
        'marginPct', round(metric.margin_pct, 2), 'orderCount', metric.order_count, 'unitsSold', metric.units_sold,
        'costCoveragePct', round(metric.cost_coverage_pct, 1), 'receivables', round(metric.receivables, 4), 'overdue', round(metric.overdue, 4)
      ) from performance as metric where metric.name = 'previous'
    ),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', trend.bucket_date, 'revenue', round(trend.revenue, 4),
        'profit', case when trend.cost_complete then round(trend.revenue - trend.cost, 4) else null end,
        'costCoveragePct', case when trend.line_count = 0 then 100 else round(trend.covered_lines * 100.0 / trend.line_count, 1) end
      ) order by trend.bucket_date) from trend_rows as trend
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', category.category, 'segment', category.segment, 'revenue', round(category.revenue, 4), 'cost', round(category.cost, 4),
        'profit', case when category.cost_complete then round(category.revenue - category.cost, 4) else null end,
        'marginPct', case when category.cost_complete and category.revenue > 0 then round((category.revenue - category.cost) * 100 / category.revenue, 2) else null end,
        'units', category.units, 'costCoveragePct', round(category.covered_lines * 100.0 / category.line_count, 1)
      ) order by category.revenue desc) from category_rows as category
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', product.category || ':' || product.product_key, 'category', product.category, 'name', product.product_name,
        'revenue', round(product.revenue, 4), 'cost', round(product.cost, 4),
        'profit', case when product.cost_complete then round(product.revenue - product.cost, 4) else null end,
        'marginPct', case when product.cost_complete and product.revenue > 0 then round((product.revenue - product.cost) * 100 / product.revenue, 2) else null end,
        'units', product.units, 'costCoveragePct', round(product.covered_lines * 100.0 / product.line_count, 1)
      ) order by product.revenue desc)
      from (select * from product_rows order by revenue desc limit 12) as product
    ), '[]'::jsonb),
    'inventory', jsonb_build_object(
      'value', coalesce((select round(sum(item.inventory_value), 4) from inventory_enriched as item where item.quantity > 0), 0),
      'valueComplete', not exists(select 1 from inventory_enriched as item where item.quantity > 0 and item.inventory_value is null),
      'valuationCoveragePct', coalesce((select round(count(item.inventory_value) filter (where item.quantity > 0) * 100.0 / nullif(count(*) filter (where item.quantity > 0), 0), 1) from inventory_enriched as item), 100),
      'units', coalesce((select sum(item.quantity) from inventory_enriched as item), 0),
      'lowStock', (select count(*) from inventory_enriched as item where item.inventory_status = 'low'),
      'outOfStock', (select count(*) from inventory_enriched as item where item.inventory_status = 'out'),
      'slowMoving', (select count(*) from inventory_enriched as item where item.inventory_status in ('slow', 'dead')),
      'deadStock', (select count(*) from inventory_enriched as item where item.inventory_status = 'dead'),
      'slowCapital', coalesce((select round(sum(item.inventory_value), 4) from inventory_enriched as item where item.inventory_status in ('slow', 'dead')), 0),
      'slowCapitalComplete', not exists(select 1 from inventory_enriched as item where item.inventory_status in ('slow', 'dead') and item.inventory_value is null),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', item.id, 'category', item.category, 'name', item.name, 'quantity', item.quantity,
          'safetyThreshold', item.safety_threshold, 'value', round(item.inventory_value, 4),
          'lastSaleDate', item.last_sale_date, 'daysSinceSale', item.days_since_sale, 'status', item.inventory_status,
          'marginPct', round(item.margin_pct, 2), 'shipmentCostSharePct', round(item.shipment_cost_share_pct, 2)
        ) order by case item.inventory_status when 'out' then 1 when 'low' then 2 when 'dead' then 3 when 'slow' then 4 else 5 end, item.inventory_value desc nulls last)
        from (
          select * from inventory_enriched
          order by case inventory_status when 'out' then 1 when 'low' then 2 when 'dead' then 3 when 'slow' then 4 else 5 end, inventory_value desc nulls last
          limit 12
        ) as item
      ), '[]'::jsonb)
    ),
    'shipments', jsonb_build_object(
      'pending', summary.pending, 'inTransit', summary.in_transit, 'delayed', summary.delayed,
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', recent.id, 'shipmentNumber', recent.shipment_number, 'status', recent.status,
          'expectedArrivalDate', recent.expected_arrival_date, 'supplierName', recent.supplier_name, 'value', recent.value
        ) order by recent.created_at desc)
        from (
          select shipment.id, shipment.shipment_number, shipment.status, shipment.expected_arrival_date, shipment.created_at,
            coalesce(supplier.name, '') as supplier_name,
            case when jsonb_typeof(shipment.total_cost_valuation -> 'accountingAmount') = 'number'
              then (shipment.total_cost_valuation ->> 'accountingAmount')::numeric else null end as value
          from public.shipments as shipment
          left join public.suppliers as supplier on supplier.id = shipment.supplier_id
          where shipment.status <> 'Cancelled'
          order by shipment.created_at desc limit 5
        ) as recent
      ), '[]'::jsonb)
    ),
    'concentration', jsonb_build_object(
      'productCount', (select count(*) from product_rows),
      'topThreeRevenue', coalesce((select round(sum(top_product.revenue), 4) from (select revenue from product_rows order by revenue desc limit 3) as top_product), 0),
      'topThreeSharePct', coalesce((select round(sum(top_product.revenue) * 100 / nullif((select sum(revenue) from product_rows), 0), 1) from (select revenue from product_rows order by revenue desc limit 3) as top_product), 0)
    )
  ) into result
  from date_params as params
  cross join shipment_summary as summary;

  return result;
end
$$;

revoke all on function public.dashboard_analytics(date, date) from public, anon;
grant execute on function public.dashboard_analytics(date, date) to authenticated;

commit;
