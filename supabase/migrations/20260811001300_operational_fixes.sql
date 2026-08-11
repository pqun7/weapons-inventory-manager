begin;

-- The production import preserves existing business identifiers. Seed every server-side
-- counter from those identifiers before generating another one.
insert into public.business_id_counters (prefix, last_value)
select seeded.prefix, seeded.last_value
from (
  select 'INV'::text as prefix, coalesce(max(substring(i.id from 4)::bigint), 0) as last_value
  from public.invoices as i where i.id ~ '^INV[0-9]+$'
  union all
  select 'ITX', coalesce(max(substring(i.id from 4)::bigint), 0)
  from public.inventory_transactions as i where i.id ~ '^ITX[0-9]+$'
  union all
  select 'PAY', coalesce(max(substring(p.id from 4)::bigint), 0)
  from public.payment_records as p where p.id ~ '^PAY[0-9]+$'
  union all
  select 'LOG', coalesce(max(substring(a.id from 4)::bigint), 0)
  from public.audit_logs as a where a.id ~ '^LOG[0-9]+$'
  union all
  select 'NTF', coalesce(max(substring(n.id from 4)::bigint), 0)
  from public.app_notifications as n where n.id ~ '^NTF[0-9]+$'
  union all
  select 'W', coalesce(max(substring(w.id from 2)::bigint), 0)
  from public.weapons as w where w.id ~ '^W[0-9]+$'
  union all
  select 'SHP', coalesce(max(substring(s.id from 4)::bigint), 0)
  from public.shipments as s where s.id ~ '^SHP[0-9]+$'
  union all
  select 'PC', coalesce(max(substring(p.id from 3)::bigint), 0)
  from public.product_costs as p where p.id ~ '^PC[0-9]+$'
  union all
  select 'SLI', coalesce(max(substring(s.id from 4)::bigint), 0)
  from public.shipment_items as s where s.id ~ '^SLI[0-9]+$'
  union all
  select 'SC', coalesce(max(substring(s.id from 3)::bigint), 0)
  from public.shipment_costs as s where s.id ~ '^SC[0-9]+$'
  union all
  select 'SCA', coalesce(max(substring(s.id from 4)::bigint), 0)
  from public.shipment_cost_allocations as s where s.id ~ '^SCA[0-9]+$'
) as seeded
on conflict (prefix) do update
set last_value = greatest(public.business_id_counters.last_value, excluded.last_value);

create or replace function public.business_id_exists(p_prefix text, p_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return case p_prefix
    when 'INV' then exists (select 1 from public.invoices as i where i.id = p_id)
    when 'ITX' then exists (select 1 from public.inventory_transactions as i where i.id = p_id)
    when 'PAY' then exists (select 1 from public.payment_records as p where p.id = p_id)
    when 'LOG' then exists (select 1 from public.audit_logs as a where a.id = p_id)
    when 'NTF' then exists (select 1 from public.app_notifications as n where n.id = p_id)
    when 'W' then exists (select 1 from public.weapons as w where w.id = p_id)
    when 'SHP' then exists (select 1 from public.shipments as s where s.id = p_id)
    when 'PC' then exists (select 1 from public.product_costs as p where p.id = p_id)
    when 'SLI' then exists (select 1 from public.shipment_items as s where s.id = p_id)
    when 'SC' then exists (select 1 from public.shipment_costs as s where s.id = p_id)
    when 'SCA' then exists (select 1 from public.shipment_cost_allocations as s where s.id = p_id)
    else null
  end;
end
$$;

create or replace function public.next_business_id(prefix_value text, pad_length integer default 5)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  normalized_prefix text := upper(btrim(prefix_value));
  next_value bigint;
  candidate text;
  collision boolean;
begin
  if normalized_prefix is null or normalized_prefix = '' or pad_length < 1 or pad_length > 18 then
    raise exception using errcode = '22023', message = 'invalid business identifier parameters';
  end if;

  loop
    insert into public.business_id_counters (prefix, last_value)
    values (normalized_prefix, 1)
    on conflict (prefix) do update
      set last_value = public.business_id_counters.last_value + 1
    returning last_value into next_value;

    candidate := normalized_prefix || lpad(next_value::text, pad_length, '0');
    collision := public.business_id_exists(normalized_prefix, candidate);
    if collision is null then
      raise exception using errcode = '22023', message = format('unsupported business identifier prefix: %s', normalized_prefix);
    end if;
    if not collision then
      return candidate;
    end if;
  end loop;
end
$$;

revoke all on function public.business_id_exists(text, text) from public, anon, authenticated;
revoke all on function public.next_business_id(text, integer) from public, anon;
grant execute on function public.next_business_id(text, integer) to authenticated;

create or replace function public.delete_shipment(p_shipment_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  shipment_row public.shipments%rowtype;
begin
  if not public.is_app_admin() then
    raise exception using errcode = '42501', message = 'administrator permission is required to delete a shipment';
  end if;

  select u.id into actor_id
  from public.users as u
  where u.auth_user_id = auth.uid() and u.is_active
  limit 1;

  select s.* into shipment_row
  from public.shipments as s
  where s.id = p_shipment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'shipment not found';
  end if;

  if exists (select 1 from public.weapons as w where w.shipment_id = p_shipment_id)
    or exists (select 1 from public.inventory_transactions as t where t.shipment_id = p_shipment_id)
    or exists (select 1 from public.inventory_cost_snapshots as c where c.shipment_id = p_shipment_id)
  then
    raise exception using errcode = '23503', message = 'shipment cannot be deleted because inventory has already been received';
  end if;

  if exists (select 1 from public.invoices as i where i.shipment_id = p_shipment_id) then
    raise exception using errcode = '23503', message = 'shipment cannot be deleted because it is linked to an invoice';
  end if;

  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (
    public.next_business_id('LOG'), now(), current_date, actor_id, 'Shipment',
    'Shipment deleted - ' || shipment_row.shipment_number,
    jsonb_build_object(
      'shipmentId', shipment_row.id,
      'shipmentNumber', shipment_row.shipment_number,
      'supplierId', shipment_row.supplier_id,
      'status', shipment_row.status,
      'workflowStatus', shipment_row.workflow_status
    )
  );

  delete from public.shipments as s where s.id = p_shipment_id;
end
$$;

revoke all on function public.delete_shipment(text) from public, anon;
grant execute on function public.delete_shipment(text) to authenticated;

commit;
