begin;

-- Provider migrations are staged through authenticated, administrator-only RPCs.
-- The public client never receives SQL privileges on the staging tables and a
-- complete server-side backup is created before destination rows are changed.

create table if not exists public.provider_migration_sessions (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null check (source_provider in ('sqlite', 'supabase')),
  target_provider text not null check (target_provider in ('sqlite', 'supabase')),
  source_schema text not null,
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  created_by uuid not null default auth.uid(),
  status text not null default 'uploading'
    check (status in ('uploading', 'applying', 'completed', 'failed')),
  safety_backup_id uuid references public.app_backups(id) on delete set null,
  source_primary_user_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);

create table if not exists public.provider_migration_chunks (
  migration_id uuid not null references public.provider_migration_sessions(id) on delete cascade,
  table_name text not null,
  chunk_index integer not null check (chunk_index >= 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  row_count integer generated always as (jsonb_array_length(rows)) stored,
  created_at timestamptz not null default now(),
  primary key (migration_id, table_name, chunk_index)
);

alter table public.provider_migration_sessions enable row level security;
alter table public.provider_migration_chunks enable row level security;

revoke all on public.provider_migration_sessions from public, anon, authenticated;
revoke all on public.provider_migration_chunks from public, anon, authenticated;

create or replace function public.provider_migration_tables()
returns text[]
language sql
immutable
security definer
set search_path = public
as $$
  select array[
    'weapon_types', 'weapon_subtypes', 'calibers', 'subtype_calibers', 'brands', 'models',
    'warehouses', 'storage_locations', 'currencies', 'exchange_rate_history',
    'exchange_rate_overrides', 'exchange_rate_audit_log', 'users', 'suppliers', 'customers',
    'shipments', 'shipment_imports', 'shipment_items', 'shipment_documents',
    'shipment_import_items', 'shipment_validation_issues', 'shipment_item_changes',
    'shipment_status_history', 'weapons', 'invoices', 'payment_records', 'accessories',
    'ammunition', 'ammunition_weapon_compatibility', 'accessory_weapon_compatibility',
    'audit_logs', 'system_settings', 'saved_filters', 'user_preferences', 'app_notifications',
    'financial_data_issues', 'inventory_transactions', 'product_costs', 'shipment_costs',
    'shipment_cost_scope_items', 'shipment_cost_allocations', 'inventory_cost_snapshots',
    'inventory_product_types'
  ]::text[]
$$;

create or replace function public.begin_provider_migration(
  p_source_provider text,
  p_source_schema text,
  p_source_digest text,
  p_manifest jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.users;
  table_entry record;
  result_id uuid;
  allowed_tables text[] := public.provider_migration_tables();
  total_rows bigint := 0;
  table_rows bigint;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null or actor.role <> 'Admin'::public.app_role then
    raise exception using errcode = '42501', message = 'Administrator authentication is required for provider migration';
  end if;
  if p_source_provider <> 'sqlite' then
    raise exception using errcode = '22023', message = 'This destination accepts SQLite provider snapshots only';
  end if;
  if coalesce(length(btrim(p_source_schema)), 0) = 0 or p_source_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid provider migration metadata';
  end if;
  if jsonb_typeof(p_manifest) <> 'object' or not (p_manifest ? 'users') then
    raise exception using errcode = '22023', message = 'The provider migration manifest is invalid';
  end if;

  for table_entry in select key, value from jsonb_each(p_manifest) loop
    if not table_entry.key = any(allowed_tables)
       or jsonb_typeof(table_entry.value) <> 'number'
       or (table_entry.value #>> '{}') !~ '^\d+$' then
      raise exception using errcode = '22023', message = 'The provider migration manifest contains an unsupported table or count';
    end if;
    table_rows := (table_entry.value #>> '{}')::bigint;
    if table_rows > 10000000 then
      raise exception using errcode = '54000', message = 'A provider migration table exceeds the supported row limit';
    end if;
    total_rows := total_rows + table_rows;
  end loop;
  if total_rows > 25000000 then
    raise exception using errcode = '54000', message = 'The provider migration exceeds the supported row limit';
  end if;

  insert into public.provider_migration_sessions(
    source_provider, target_provider, source_schema, source_digest, manifest, created_by
  ) values (
    p_source_provider, 'supabase', left(btrim(p_source_schema), 80), p_source_digest, p_manifest, auth.uid()
  ) returning id into result_id;
  return result_id;
end
$$;

create or replace function public.append_provider_migration_chunk(
  p_migration_id uuid,
  p_table_name text,
  p_chunk_index integer,
  p_rows jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  migration public.provider_migration_sessions;
begin
  select * into migration from public.provider_migration_sessions
  where id = p_migration_id for update;
  if migration.id is null or migration.created_by <> auth.uid() then
    raise exception using errcode = '42501', message = 'Provider migration session not found';
  end if;
  if migration.status <> 'uploading' then
    raise exception using errcode = '55000', message = 'Provider migration is not accepting data';
  end if;
  if not (migration.manifest ? p_table_name)
     or not p_table_name = any(public.provider_migration_tables()) then
    raise exception using errcode = '22023', message = 'Unsupported provider migration table';
  end if;
  if p_chunk_index < 0 or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 500
     or pg_column_size(p_rows) > 4194304 then
    raise exception using errcode = '54000', message = 'Provider migration chunk is invalid or too large';
  end if;
  insert into public.provider_migration_chunks(migration_id, table_name, chunk_index, rows)
  values (p_migration_id, p_table_name, p_chunk_index, p_rows);
end
$$;

create or replace function public.provider_migration_rows(p_migration_id uuid, p_table_name text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_value order by chunks.chunk_index, expanded.ordinality), '[]'::jsonb)
  from public.provider_migration_chunks chunks
  cross join lateral jsonb_array_elements(chunks.rows) with ordinality as expanded(row_value, ordinality)
  where chunks.migration_id = p_migration_id and chunks.table_name = p_table_name
$$;

create or replace function public.normalize_provider_migration_rows(p_table_name text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  input_row jsonb;
  normalized_row jsonb;
  result jsonb := '[]'::jsonb;
  column_info record;
  field_value jsonb;
  decoded_text text;
  decoded_json jsonb;
  decoded_boolean boolean;
begin
  if not p_table_name = any(public.provider_migration_tables())
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid provider migration rows';
  end if;
  for input_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(input_row) <> 'object' then
      raise exception using errcode = '22023', message = 'Provider migration rows must be objects';
    end if;
    normalized_row := input_row;
    for column_info in
      select attribute.attname, data_type.typname
      from pg_attribute attribute
      join pg_type data_type on data_type.oid = attribute.atttypid
      where attribute.attrelid = format('public.%I', p_table_name)::regclass
        and attribute.attnum > 0 and not attribute.attisdropped
        and input_row ? attribute.attname
    loop
      field_value := normalized_row -> column_info.attname;
      if field_value = 'null'::jsonb then continue; end if;
      if column_info.typname = 'bool' then
        if jsonb_typeof(field_value) = 'boolean' then continue; end if;
        decoded_text := lower(btrim(field_value #>> '{}'));
        if decoded_text in ('1', 'true', 'yes', 'on') then decoded_boolean := true;
        elsif decoded_text in ('0', 'false', 'no', 'off') then decoded_boolean := false;
        else raise exception using errcode = '22023', message = 'Invalid boolean value in provider migration';
        end if;
        normalized_row := jsonb_set(normalized_row, array[column_info.attname], to_jsonb(decoded_boolean), true);
      elsif column_info.typname in ('json', 'jsonb') and jsonb_typeof(field_value) = 'string' then
        decoded_text := field_value #>> '{}';
        begin
          decoded_json := decoded_text::jsonb;
        exception when others then
          raise exception using errcode = '22023', message = 'Invalid JSON value in provider migration';
        end;
        normalized_row := jsonb_set(normalized_row, array[column_info.attname], decoded_json, true);
      end if;
    end loop;
    result := result || jsonb_build_array(normalized_row);
  end loop;
  return result;
end
$$;

create or replace function public.insert_provider_migration_rows(p_table_name text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  normalized_rows jsonb;
  column_list text;
begin
  if not p_table_name = any(public.provider_migration_tables()) then
    raise exception using errcode = '22023', message = 'Unsupported provider migration table';
  end if;
  if jsonb_array_length(p_rows) = 0 then return; end if;
  normalized_rows := public.normalize_provider_migration_rows(p_table_name, p_rows);
  select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
  into column_list
  from pg_attribute attribute
  where attribute.attrelid = format('public.%I', p_table_name)::regclass
    and attribute.attnum > 0 and not attribute.attisdropped
    and attribute.attgenerated = '' and attribute.attidentity = ''
    and exists (
      select 1 from jsonb_array_elements(normalized_rows) source_row
      where source_row ? attribute.attname
    );
  if column_list is null then
    raise exception using errcode = '22023', message = 'Provider migration table has no compatible columns';
  end if;
  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)',
    p_table_name, column_list, column_list, p_table_name
  ) using normalized_rows;
end
$$;

create or replace function public.apply_provider_migration(p_migration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  actor public.users;
  migration public.provider_migration_sessions;
  current_table text;
  restore_tables text[] := public.provider_migration_tables();
  reverse_index integer;
  expected_count bigint;
  uploaded_count bigint;
  actual_count bigint;
  source_users jsonb;
  migrated_users jsonb;
  source_primary jsonb;
  source_primary_count integer;
  source_primary_id text;
  actor_login_email text;
  table_rows jsonb;
  safety_id uuid;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null or actor.role <> 'Admin'::public.app_role then
    raise exception using errcode = '42501', message = 'Administrator authentication is required for provider migration';
  end if;
  select * into migration from public.provider_migration_sessions
  where id = p_migration_id for update;
  if migration.id is null or migration.created_by <> auth.uid() or migration.status <> 'uploading' then
    raise exception using errcode = '55000', message = 'Provider migration is not ready to apply';
  end if;

  perform pg_advisory_xact_lock(hashtext('armory-provider-migration'));
  foreach current_table in array restore_tables loop
    if migration.manifest ? current_table then
      expected_count := (migration.manifest ->> current_table)::bigint;
      select coalesce(sum(row_count), 0) into uploaded_count
      from public.provider_migration_chunks chunks
      where chunks.migration_id = p_migration_id and chunks.table_name = current_table;
      if expected_count <> uploaded_count then
        raise exception using errcode = '22023', message = 'Provider migration row counts do not match the manifest';
      end if;
    end if;
  end loop;

  source_users := public.provider_migration_rows(p_migration_id, 'users');
  select count(*)::integer into source_primary_count
  from jsonb_array_elements(source_users) source_row
  where lower(coalesce(source_row ->> 'is_primary_admin', 'false')) in ('1', 'true');
  select source_row into source_primary
  from jsonb_array_elements(source_users) source_row
  where lower(coalesce(source_row ->> 'is_primary_admin', 'false')) in ('1', 'true')
  limit 1;
  if source_primary_count <> 1 or coalesce(source_primary ->> 'id', '') = '' then
    raise exception using errcode = '22023', message = 'The SQLite snapshot must contain exactly one primary administrator';
  end if;
  source_primary_id := source_primary ->> 'id';
  actor_login_email := coalesce(nullif(actor.login_email, ''), nullif(actor.email, ''), actor.username);

  select coalesce(jsonb_agg(
    case when source_row ->> 'id' = source_primary_id then
      (source_row - 'password_hash' - 'failed_login_attempts' - 'locked_until') || jsonb_build_object(
        'auth_user_id', auth.uid(), 'login_email', actor_login_email,
        'password_set', true, 'activation_token_hash', null,
        'activation_expires_at', null, 'is_active', true,
        'is_primary_admin', true, 'role', 'Admin'
      )
    else
      (source_row - 'password_hash' - 'failed_login_attempts' - 'locked_until') || jsonb_build_object(
        'auth_user_id', null, 'login_email', null, 'password_set', false,
        'activation_token_hash', null, 'activation_expires_at', null,
        'is_primary_admin', false,
        'role', case when source_row ->> 'role' = 'Admin' then 'Admin' else 'Employee' end
      )
    end
  ), '[]'::jsonb) into migrated_users
  from jsonb_array_elements(source_users) source_row;

  safety_id := public.create_system_backup(
    'Automatic safety backup before SQLite provider migration ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
  update public.provider_migration_sessions
  set status = 'applying', safety_backup_id = safety_id, error_message = null
  where id = p_migration_id;
  perform set_config('weapon_store.restore_mode', 'on', true);

  for reverse_index in reverse coalesce(array_upper(restore_tables, 1), 0)..coalesce(array_lower(restore_tables, 1), 1) loop
    current_table := restore_tables[reverse_index];
    if migration.manifest ? current_table and to_regclass(format('public.%I', current_table)) is not null then
      execute format('delete from public.%I', current_table);
    end if;
  end loop;
  foreach current_table in array restore_tables loop
    if migration.manifest ? current_table and to_regclass(format('public.%I', current_table)) is not null then
      table_rows := case when current_table = 'users' then migrated_users
        else public.provider_migration_rows(p_migration_id, current_table) end;
      perform public.insert_provider_migration_rows(current_table, table_rows);
      execute format('select count(*) from public.%I', current_table) into actual_count;
      expected_count := (migration.manifest ->> current_table)::bigint;
      if actual_count <> expected_count then
        raise exception using errcode = '22023', message = 'Provider migration verification failed';
      end if;
    end if;
  end loop;

  if public.current_app_user_id() is distinct from source_primary_id then
    raise exception using errcode = '23514', message = 'The destination administrator identity could not be preserved';
  end if;
  perform set_config('weapon_store.restore_mode', 'off', true);
  insert into public.audit_logs(
    id, timestamp, date, user_id, user_name, action_type, event_action,
    description, metadata, table_name, record_id
  ) values (
    gen_random_uuid()::text, now(), current_date, source_primary_id,
    coalesce(source_primary ->> 'name', actor.name), 'Backup', 'PROVIDER_MIGRATION',
    'SQLite data migrated to Supabase after a complete destination safety backup',
    jsonb_build_object('migration_id', p_migration_id, 'safety_backup_id', safety_id,
      'source_schema', migration.source_schema, 'source_digest', migration.source_digest),
    'provider_migration_sessions', p_migration_id::text
  );
  update public.provider_migration_sessions
  set status = 'completed', source_primary_user_id = source_primary_id,
      completed_at = now(), error_message = null
  where id = p_migration_id;
  return jsonb_build_object(
    'migrationId', p_migration_id,
    'safetyBackupId', safety_id,
    'sourcePrimaryUserId', source_primary_id
  );
end
$$;

create or replace function public.begin_provider_migration_export()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.users;
  backup_id uuid;
  backup_payload jsonb;
  table_name text;
  manifest jsonb := '{}'::jsonb;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null or actor.role <> 'Admin'::public.app_role then
    raise exception using errcode = '42501', message = 'Administrator authentication is required for provider migration';
  end if;
  backup_id := public.create_system_backup(
    'Provider export snapshot ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
  select payload into backup_payload from public.app_backups where id = backup_id;
  foreach table_name in array public.provider_migration_tables() loop
    if backup_payload -> 'tables' ? table_name then
      manifest := manifest || jsonb_build_object(
        table_name, jsonb_array_length(backup_payload -> 'tables' -> table_name)
      );
    end if;
  end loop;
  return jsonb_build_object(
    'backupId', backup_id,
    'schemaVersion', (select schema_version from public.app_installation where singleton),
    'manifest', manifest
  );
end
$$;

create or replace function public.read_provider_migration_export(
  p_backup_id uuid,
  p_table_name text,
  p_offset integer default 0,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.users;
  backup_payload jsonb;
  result jsonb;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null or actor.role <> 'Admin'::public.app_role then
    raise exception using errcode = '42501', message = 'Administrator authentication is required for provider migration';
  end if;
  if not p_table_name = any(public.provider_migration_tables())
     or p_offset < 0 or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'Invalid provider export request';
  end if;
  select payload into backup_payload from public.app_backups
  where id = p_backup_id and created_by = actor.id and scope = 'system' and status = 'completed';
  if backup_payload is null then
    raise exception using errcode = '42501', message = 'Provider export snapshot not found';
  end if;
  select coalesce(jsonb_agg(exported.value order by exported.ordinality), '[]'::jsonb)
  into result
  from jsonb_array_elements(coalesce(backup_payload -> 'tables' -> p_table_name, '[]'::jsonb))
    with ordinality as exported(value, ordinality)
  where exported.ordinality > p_offset and exported.ordinality <= p_offset + p_limit;
  return result;
end
$$;

revoke all on function public.provider_migration_tables() from public, anon, authenticated;
revoke all on function public.provider_migration_rows(uuid, text) from public, anon, authenticated;
revoke all on function public.normalize_provider_migration_rows(text, jsonb) from public, anon, authenticated;
revoke all on function public.insert_provider_migration_rows(text, jsonb) from public, anon, authenticated;
revoke all on function public.begin_provider_migration(text, text, text, jsonb) from public, anon;
revoke all on function public.append_provider_migration_chunk(uuid, text, integer, jsonb) from public, anon;
revoke all on function public.apply_provider_migration(uuid) from public, anon;
revoke all on function public.begin_provider_migration_export() from public, anon;
revoke all on function public.read_provider_migration_export(uuid, text, integer, integer) from public, anon;

grant execute on function public.begin_provider_migration(text, text, text, jsonb) to authenticated;
grant execute on function public.append_provider_migration_chunk(uuid, text, integer, jsonb) to authenticated;
grant execute on function public.apply_provider_migration(uuid) to authenticated;
grant execute on function public.begin_provider_migration_export() to authenticated;
grant execute on function public.read_provider_migration_export(uuid, text, integer, integer) to authenticated;

update public.app_installation
set schema_version = '20260815000100'
where singleton;

notify pgrst, 'reload schema';

commit;
