begin;

create or replace function public.apply_shipment_costs(p_shipment_id text, p_costs jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare
  actor_id text;
  cost jsonb;
  cost_id text;
  snapshot jsonb;
  cost_currency varchar(3);
  calculation_type text;
  allocation_method text;
  cost_scope text;
  input_amount numeric(20, 4);
  percentage_rate numeric(12, 6);
  calculated_amount numeric(20, 4);
  base_amount numeric(20, 4);
  eligible_value numeric(20, 4);
  eligible_quantity numeric(20, 4);
  eligible_count integer;
  line record;
  automatic_base numeric(20, 4);
  final_base numeric(20, 4);
  final_amount numeric(20, 4);
  allocated_base numeric(20, 4);
  manual_sum numeric(20, 4);
  product_id_value text;
  product_count integer;
  accounting_currency varchar(3);
  rate_date timestamptz;
  rate_source_value text;
  shipment_original_base numeric(20, 4);
  shipment_cost_base numeric(20, 4);
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  if coalesce(jsonb_typeof(p_costs), 'null') <> 'array' then raise exception using errcode = '22023', message = 'shipment costs must be an array'; end if;
  if not exists (select 1 from public.shipments as s where s.id = p_shipment_id for update) then
    raise exception using errcode = 'P0002', message = 'shipment not found';
  end if;
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  update public.inventory_cost_snapshots as inventory set
    final_landed_base_amount = inventory.final_landed_base_amount - inventory.shipment_costs_base_amount,
    shipment_costs_base_amount = 0
  where inventory.shipment_id = p_shipment_id;
  delete from public.shipment_costs as sc where sc.shipment_id = p_shipment_id;

  for cost in select value from jsonb_array_elements(p_costs) loop
    if nullif(btrim(cost ->> 'name'), '') is null then raise exception using errcode = '22023', message = 'shipment cost name is required'; end if;
    calculation_type := cost ->> 'calculationType';
    allocation_method := cost ->> 'allocationMethod';
    cost_scope := cost ->> 'scope';
    if calculation_type not in ('fixed', 'percentage')
      or allocation_method not in ('by_value', 'by_quantity', 'equal', 'manual')
      or cost_scope not in ('entire_shipment', 'selected_products', 'single_product', 'manual') then
      raise exception using errcode = '22023', message = 'invalid shipment cost configuration';
    end if;
    cost_currency := upper(cost ->> 'currency');
    snapshot := public.currency_snapshot(cost_currency);
    accounting_currency := snapshot ->> 'accountingCurrency';
    rate_date := (snapshot ->> 'exchangeRateDate')::timestamptz;
    rate_source_value := snapshot ->> 'rateSource';
    input_amount := coalesce(nullif(cost ->> 'amount', '')::numeric, 0);
    percentage_rate := nullif(cost ->> 'percentageRate', '')::numeric;

    select coalesce(sum(si.unit_purchase_base_amount * si.quantity), 0), coalesce(sum(si.quantity), 0), count(1)
    into eligible_value, eligible_quantity, eligible_count
    from public.shipment_items as si
    where si.shipment_id = p_shipment_id and (
      cost_scope = 'entire_shipment'
      or (cost -> 'selectedShipmentItemIds') ? si.id
    );
    if eligible_count = 0 then raise exception using errcode = '22023', message = 'shipment cost scope has no eligible items'; end if;
    if calculation_type = 'fixed' then
      calculated_amount := input_amount;
    else
      if percentage_rate is null or percentage_rate < 0 then raise exception using errcode = '22023', message = 'valid percentage rate is required'; end if;
      calculated_amount := round(eligible_value * (snapshot ->> 'exchangeRate')::numeric * percentage_rate / 100, 4);
    end if;
    if calculated_amount < 0 then raise exception using errcode = '22023', message = 'shipment cost cannot be negative'; end if;
    base_amount := round(calculated_amount / (snapshot ->> 'exchangeRate')::numeric, 4);
    cost_id := coalesce(nullif(cost ->> 'id', ''), public.next_business_id('SC'));
    insert into public.shipment_costs (
      id, shipment_id, name, calculation_type, input_amount, percentage_rate,
      calculation_base, calculated_amount, currency_code, exchange_rate, base_amount,
      base_currency_code, exchange_rate_date, rate_source, source, scope,
      allocation_method, created_by
    ) values (
      cost_id, p_shipment_id, btrim(cost ->> 'name'), calculation_type, input_amount,
      case when calculation_type = 'percentage' then percentage_rate else null end,
      'original_purchase_cost', calculated_amount, cost_currency,
      (snapshot ->> 'exchangeRate')::numeric, base_amount, accounting_currency,
      rate_date, rate_source_value, 'shipment_level', cost_scope, allocation_method, actor_id
    );

    allocated_base := 0;
    manual_sum := 0;
    if allocation_method = 'manual' then
      select coalesce(sum((entry.value #>> '{}')::numeric / (snapshot ->> 'exchangeRate')::numeric), 0)
      into manual_sum from jsonb_each(coalesce(cost -> 'manualAllocations', '{}'::jsonb)) as entry(key, value);
      if abs(manual_sum - base_amount) > 0.01 then
        raise exception using errcode = '23514', message = 'manual shipment cost allocations must equal the total cost';
      end if;
    end if;

    for line in
      select si.id, si.product_type, si.quantity, si.unit_purchase_base_amount, si.product_ids_json
      from public.shipment_items as si
      where si.shipment_id = p_shipment_id and (
        cost_scope = 'entire_shipment' or (cost -> 'selectedShipmentItemIds') ? si.id
      ) order by si.id
    loop
      insert into public.shipment_cost_scope_items (cost_id, shipment_item_id) values (cost_id, line.id);
      automatic_base := case allocation_method
        when 'by_value' then case when eligible_value = 0 then base_amount / eligible_count else base_amount * (line.unit_purchase_base_amount * line.quantity) / eligible_value end
        when 'by_quantity' then case when eligible_quantity = 0 then base_amount / eligible_count else base_amount * line.quantity / eligible_quantity end
        else base_amount / eligible_count end;
      automatic_base := round(automatic_base, 4);
      if allocation_method = 'manual' then
        if not coalesce(cost -> 'manualAllocations', '{}'::jsonb) ? line.id then
          raise exception using errcode = '22023', message = 'manual allocation is missing a shipment line';
        end if;
        final_amount := (cost #>> array['manualAllocations', line.id])::numeric;
        final_base := round(final_amount / (snapshot ->> 'exchangeRate')::numeric, 4);
      else
        final_base := automatic_base;
        final_amount := round(final_base * (snapshot ->> 'exchangeRate')::numeric, 4);
      end if;
      insert into public.shipment_cost_allocations (
        id, shipment_id, shipment_item_id, cost_id, automatic_amount, final_amount,
        manual_override, difference, currency_code, exchange_rate, automatic_base_amount,
        final_base_amount, base_currency_code, allocation_method
      ) values (
        public.next_business_id('SCA'), p_shipment_id, line.id, cost_id,
        round(automatic_base * (snapshot ->> 'exchangeRate')::numeric, 4), final_amount,
        allocation_method = 'manual', final_amount - round(automatic_base * (snapshot ->> 'exchangeRate')::numeric, 4),
        cost_currency, (snapshot ->> 'exchangeRate')::numeric, automatic_base, final_base,
        accounting_currency, allocation_method
      );
      allocated_base := allocated_base + final_base;
      product_count := jsonb_array_length(line.product_ids_json);
      if product_count > 0 then
        for product_id_value in select value from jsonb_array_elements_text(line.product_ids_json) loop
          update public.inventory_cost_snapshots as inventory set
            shipment_id = p_shipment_id, shipment_item_id = line.id,
            shipment_costs_base_amount = inventory.shipment_costs_base_amount + round(final_base / product_count, 4),
            final_landed_base_amount = inventory.final_landed_base_amount + round(final_base / product_count, 4),
            finalized_at = now(), finalized_by = actor_id
          where inventory.product_type = line.product_type and inventory.product_id = product_id_value;
          if not found then raise exception using errcode = '23514', message = 'inventory cost snapshot missing for shipment product'; end if;
        end loop;
      end if;
    end loop;
    if abs(allocated_base - base_amount) > greatest(0.01, eligible_count * 0.0001) then
      raise exception using errcode = '23514', message = 'shipment cost allocation does not reconcile';
    end if;
  end loop;

  select coalesce(sum(si.unit_purchase_base_amount * si.quantity), 0) into shipment_original_base
  from public.shipment_items as si where si.shipment_id = p_shipment_id;
  select coalesce(sum(sc.base_amount), 0) into shipment_cost_base
  from public.shipment_costs as sc where sc.shipment_id = p_shipment_id;
  select s.accounting_currency_code into accounting_currency from public.system_settings as s where s.id = 1;
  update public.shipments set total_cost_valuation = jsonb_build_object(
    'originalAmount', shipment_original_base + shipment_cost_base,
    'originalCurrency', accounting_currency, 'exchangeRate', 1,
    'accountingAmount', shipment_original_base + shipment_cost_base,
    'accountingCurrency', accounting_currency, 'exchangeRateDate', coalesce(rate_date, now()),
    'rateSource', coalesce(rate_source_value, 'default')
  ) where id = p_shipment_id;
end
$$;

revoke all on function public.apply_shipment_costs(text, jsonb) from public, anon;
grant execute on function public.apply_shipment_costs(text, jsonb) to authenticated;

commit;
