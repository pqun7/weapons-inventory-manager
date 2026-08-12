-- Business audit events are concise and expandable. Technical row traces are
-- either suppressed for high-volume tables or retained as hidden forensic data.

alter table public.audit_logs
  add column if not exists event_key text,
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists item_count integer not null default 0,
  add column if not exists importance smallint not null default 1,
  add column if not exists is_visible boolean not null default true;

alter table public.audit_logs
  drop constraint if exists audit_logs_details_object_check;
alter table public.audit_logs
  add constraint audit_logs_details_object_check check (jsonb_typeof(details) = 'object');
alter table public.audit_logs
  drop constraint if exists audit_logs_item_count_check;
alter table public.audit_logs
  add constraint audit_logs_item_count_check check (item_count >= 0);
alter table public.audit_logs
  drop constraint if exists audit_logs_importance_check;
alter table public.audit_logs
  add constraint audit_logs_importance_check check (importance between 0 and 3);

create unique index if not exists audit_logs_event_key_unique
  on public.audit_logs(event_key);
create index if not exists audit_logs_business_timeline
  on public.audit_logs(timestamp desc)
  where is_visible and importance > 0;

create or replace function public.write_business_audit_event(
  p_action_type text,
  p_event_key text,
  p_entity_type text,
  p_entity_id text,
  p_entity_name text,
  p_metadata jsonb default '{}'::jsonb,
  p_details jsonb default '{}'::jsonb,
  p_item_count integer default 0,
  p_importance smallint default 2
)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  actor_name text;
  audit_id text := public.next_business_id('LOG');
begin
  select u.id, u.name into actor_id, actor_name
  from public.users u
  where u.auth_user_id = auth.uid() and u.is_active
  limit 1;
  if actor_id is null then
    raise exception using errcode = '42501', message = 'authenticated application user is required';
  end if;
  if nullif(btrim(p_action_type), '') is null
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid business audit event';
  end if;

  insert into public.audit_logs(
    id, timestamp, date, user_id, user_name, action_type, description, metadata,
    entity_type, entity_id, entity_name, event_key, details, item_count,
    importance, is_visible, event_action
  ) values (
    audit_id, now(), current_date, actor_id, actor_name, btrim(p_action_type), '',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('count', greatest(coalesce(p_item_count, 0), 0)),
    nullif(btrim(p_entity_type), ''), nullif(btrim(p_entity_id), ''),
    nullif(btrim(p_entity_name), ''), nullif(btrim(p_event_key), ''),
    coalesce(p_details, '{}'::jsonb), greatest(coalesce(p_item_count, 0), 0),
    greatest(0, least(coalesce(p_importance, 2), 3)), true, 'BUSINESS_EVENT'
  )
  on conflict (event_key) do update set
    timestamp = excluded.timestamp,
    date = excluded.date,
    user_id = excluded.user_id,
    user_name = excluded.user_name,
    metadata = public.audit_logs.metadata || excluded.metadata
      || jsonb_build_object('count', public.audit_logs.item_count + excluded.item_count),
    details = public.audit_logs.details || excluded.details || jsonb_build_object(
      'items', coalesce(public.audit_logs.details -> 'items', '[]'::jsonb)
        || coalesce(excluded.details -> 'items', '[]'::jsonb),
      'duplicates', coalesce(public.audit_logs.details -> 'duplicates', '[]'::jsonb)
        || coalesce(excluded.details -> 'duplicates', '[]'::jsonb)
    ),
    item_count = public.audit_logs.item_count + excluded.item_count,
    importance = greatest(public.audit_logs.importance, excluded.importance),
    is_visible = true
  returning id into audit_id;
  return audit_id;
end
$$;

revoke all on function public.write_business_audit_event(text,text,text,text,text,jsonb,jsonb,integer,smallint) from public, anon;
grant execute on function public.write_business_audit_event(text,text,text,text,text,jsonb,jsonb,integer,smallint) to authenticated;

create or replace function public.classify_audit_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.event_action in ('INSERT', 'UPDATE', 'DELETE') and new.table_name is not null then
    new.is_visible := false;
    new.importance := 0;
  end if;
  if new.action_type = 'Login'
     or new.description ~* '(autosaved|manifest item .* updated during review)' then
    new.is_visible := false;
    new.importance := 0;
  end if;
  return new;
end
$$;

drop trigger if exists audit_logs_classify_event on public.audit_logs;
create trigger audit_logs_classify_event
before insert or update on public.audit_logs
for each row execute function public.classify_audit_event();

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor_id text;
  actor_name text;
  before_row jsonb;
  after_row jsonb;
  row_id text;
begin
  if current_setting('weapon_store.restore_mode', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = any(array[
    'weapons', 'inventory_transactions', 'inventory_cost_snapshots',
    'product_costs', 'shipment_costs', 'shipment_cost_scope_items',
    'shipment_cost_allocations', 'shipment_import_items', 'shipment_item_changes',
    'shipment_status_history', 'shipment_validation_issues', 'business_id_counters'
  ]) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select u.id, u.name into actor_id, actor_name
  from public.users u where u.auth_user_id = auth.uid() limit 1;
  actor_id := coalesce(actor_id, 'SYSTEM');
  actor_name := coalesce(actor_name, 'System');
  before_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  after_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  if tg_table_name = 'users' then
    before_row := before_row - 'login_email' - 'activation_token_hash';
    after_row := after_row - 'login_email' - 'activation_token_hash';
  elsif tg_table_name = 'app_backups' then
    before_row := before_row - 'payload';
    after_row := after_row - 'payload';
  end if;
  row_id := coalesce(after_row ->> 'id', before_row ->> 'id', after_row ->> 'iso_code', before_row ->> 'iso_code', '');
  insert into public.audit_logs(
    id, timestamp, date, user_id, user_name, action_type, event_action,
    description, metadata, table_name, record_id, old_values, new_values,
    importance, is_visible
  ) values (
    gen_random_uuid()::text, now(), current_date, actor_id, actor_name,
    initcap(lower(tg_op)), tg_op,
    format('%s %s on %I', actor_name, lower(tg_op), tg_table_name),
    jsonb_build_object('table', tg_table_name, 'record_id', row_id),
    tg_table_name, row_id, before_row, coalesce(after_row, '{}'::jsonb), 0, false
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

-- Consolidate weapon batches from the same shipment into one business event.
do $$
declare
  function_definition text;
  corrected_definition text;
  audit_start integer;
  return_start integer;
  new_audit text := $new$
  perform public.write_business_audit_event(
    'Intake',
    case when nullif(p_input ->> 'shipmentId', '') is not null
      then 'inventory-intake:shipment:' || (p_input ->> 'shipmentId')
      else 'inventory-intake:batch:' || txid_current()::text end,
    case when nullif(p_input ->> 'shipmentId', '') is not null then 'Shipment' else 'Inventory' end,
    nullif(p_input ->> 'shipmentId', ''),
    coalesce((select s.shipment_number from public.shipments s where s.id = nullif(p_input ->> 'shipmentId', '')), 'Inventory'),
    jsonb_build_object(
      'messageKey', 'audit.business.inventoryIntake',
      'count', added_count,
      'shipmentId', nullif(p_input ->> 'shipmentId', ''),
      'locationId', nullif(p_input ->> 'storageLocationId', '')
    ),
    jsonb_build_object('items', intake_items, 'duplicates', duplicates),
    added_count,
    3
  );
  $new$;
begin
  select pg_get_functiondef('public.bulk_intake_weapons(jsonb)'::regprocedure)
  into function_definition;
  corrected_definition := replace(
    function_definition,
    '  movement jsonb;',
    E'  movement jsonb;\n  intake_items jsonb := ''[]''::jsonb;'
  );
  if corrected_definition = function_definition then
    raise exception 'bulk_intake_weapons declaration marker was not found';
  end if;
  function_definition := corrected_definition;
  corrected_definition := replace(
    function_definition,
    '    added_count := added_count + 1;',
    E'    intake_items := intake_items || jsonb_build_array(jsonb_build_object(\n      ''weaponId'', weapon_id, ''serialNumber'', normalized_serial,\n      ''modelId'', p_input ->> ''modelId'', ''caliberId'', p_input ->> ''caliberId''\n    ));\n    added_count := added_count + 1;'
  );
  if corrected_definition = function_definition then
    raise exception 'bulk_intake_weapons item marker was not found';
  end if;
  function_definition := corrected_definition;
  audit_start := strpos(function_definition, '  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)');
  return_start := strpos(function_definition, '  return jsonb_build_object');
  if audit_start = 0 or return_start = 0 or return_start <= audit_start then
    raise exception 'bulk_intake_weapons audit marker was not found';
  end if;
  corrected_definition := substr(function_definition, 1, audit_start - 1)
    || new_audit
    || substr(function_definition, return_start);
  execute corrected_definition;
end
$$;

-- Hide existing technical spam without deleting forensic history.
update public.audit_logs
set is_visible = false, importance = 0
where (event_action in ('INSERT', 'UPDATE', 'DELETE') and table_name is not null)
   or action_type = 'Login'
   or description ~* '(autosaved|manifest item .* updated during review)';

-- Consolidate legacy batch intake logs per actor/day. New events use shipment keys.
do $$
declare
  grouped record;
begin
  for grouped in
    select user_id, date, min(timestamp) first_at, max(timestamp) last_at,
      sum(coalesce(nullif(metadata ->> 'added', '')::integer, 0)) item_total,
      jsonb_agg(jsonb_build_object('logId', id, 'count', coalesce(nullif(metadata ->> 'added', '')::integer, 0))) breakdown
    from public.audit_logs
    where action_type = 'Intake'
      and description ~ '^[0-9]+ weapon\(s\) added to inventory$'
      and event_key is null
    group by user_id, date
  loop
    insert into public.audit_logs(
      id, timestamp, date, user_id, user_name, action_type, description, metadata,
      entity_type, entity_name, event_key, details, item_count, importance, is_visible,
      event_action
    ) values (
      public.next_business_id('LOG'), grouped.last_at, grouped.date, grouped.user_id,
      (select u.name from public.users u where u.id = grouped.user_id), 'Intake', '',
      jsonb_build_object('messageKey', 'audit.business.inventoryIntake', 'count', grouped.item_total),
      'Inventory', 'Inventory',
      'legacy-inventory-intake:' || grouped.user_id || ':' || grouped.date::text,
      jsonb_build_object('batches', grouped.breakdown), grouped.item_total, 2, true,
      'BUSINESS_EVENT'
    ) on conflict (event_key) do nothing;
  end loop;
  update public.audit_logs
  set is_visible = false, importance = 0
  where action_type = 'Intake'
    and description ~ '^[0-9]+ weapon\(s\) added to inventory$'
    and event_key is null;
end
$$;

notify pgrst, 'reload schema';
