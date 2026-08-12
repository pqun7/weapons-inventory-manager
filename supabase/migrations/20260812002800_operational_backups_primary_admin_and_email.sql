begin;

alter table public.users
  add column if not exists is_primary_admin boolean not null default false;

update public.users
set is_primary_admin = true,
    role = 'Admin'::public.app_role
where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) in (
  'ayman ali', 'aiman ali', 'أيمن علي', 'ايمن علي'
)
  and not exists (select 1 from public.users where is_primary_admin);

create unique index if not exists users_one_primary_admin
  on public.users (is_primary_admin) where is_primary_admin;

alter table public.users drop constraint if exists users_primary_admin_role_check;
alter table public.users add constraint users_primary_admin_role_check
  check (not is_primary_admin or role = 'Admin'::public.app_role);

create or replace function public.prevent_user_identity_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    raise exception using errcode = '42501', message = 'A user name cannot be changed after account creation';
  end if;
  if new.login_email is distinct from old.login_email then
    raise exception using errcode = '42501', message = 'The internal login identity cannot be changed';
  end if;
  if new.is_primary_admin is distinct from old.is_primary_admin then
    raise exception using errcode = '42501', message = 'The primary administrator designation cannot be changed through the application';
  end if;
  if old.is_primary_admin and (new.role <> 'Admin'::public.app_role or not new.is_active) then
    raise exception using errcode = '42501', message = 'The primary administrator cannot be demoted or deleted';
  end if;
  return new;
end
$$;

create or replace function public.update_own_email(p_email text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id text := public.current_app_user_id();
  clean_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if clean_email is not null and clean_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Invalid email address';
  end if;
  update public.users
  set email = clean_email,
      username = coalesce(clean_email, name)
  where id = actor_id;
  return clean_email;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'This email is already used by another account';
end
$$;

alter table public.app_backups
  add column if not exists item_count bigint not null default 0,
  add column if not exists size_bytes bigint not null default 0,
  add column if not exists status text not null default 'completed',
  add column if not exists completed_at timestamptz,
  add column if not exists error_message text,
  add constraint app_backups_status_check check (status in ('creating', 'completed', 'restoring', 'failed'));

drop view if exists public.backup_catalog;

create or replace function public.system_backup_tables()
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
    'inventory_product_types', 'business_id_counters', 'migration_runs'
  ]::text[]
$$;

create or replace function public.create_system_backup(p_label text default '')
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.users;
  backup_id uuid;
  table_name text;
  table_rows jsonb;
  auth_rows jsonb;
  snapshot jsonb := '{}'::jsonb;
  row_count bigint := 0;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if actor.role <> 'Admin'::public.app_role
     and not public.has_app_permission('backups.system.create') then
    raise exception using errcode = '42501', message = 'System backup permission is required';
  end if;

  insert into public.app_backups(
    scope, owner_user_id, created_by, created_by_name, label, status
  ) values (
    'system', null, actor.id, actor.name,
    left(coalesce(nullif(btrim(p_label), ''), 'System backup'), 120), 'creating'
  ) returning id into backup_id;

  foreach table_name in array public.system_backup_tables() loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(source)), ''[]''::jsonb), count(*) from public.%I source',
      table_name
    ) into table_rows, row_count;
    snapshot := snapshot || jsonb_build_object(table_name, table_rows);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', auth_user.id,
    'email', auth_user.email,
    'encrypted_password', auth_user.encrypted_password,
    'email_confirmed_at', auth_user.email_confirmed_at,
    'raw_app_meta_data', auth_user.raw_app_meta_data,
    'raw_user_meta_data', auth_user.raw_user_meta_data,
    'is_super_admin', auth_user.is_super_admin,
    'banned_until', auth_user.banned_until,
    'deleted_at', auth_user.deleted_at
  )), '[]'::jsonb) into auth_rows
  from auth.users auth_user
  join public.users app_user on app_user.auth_user_id = auth_user.id;

  update public.app_backups
  set payload = jsonb_build_object(
        'format_version', 1,
        'created_at', now(),
        'tables', snapshot,
        'auth_users', auth_rows
      ),
      item_count = (
        select coalesce(sum(jsonb_array_length(value)), 0)
        from jsonb_each(snapshot)
      ) + jsonb_array_length(auth_rows),
      size_bytes = pg_column_size(jsonb_build_object('tables', snapshot, 'auth_users', auth_rows)),
      status = 'completed',
      completed_at = now()
  where id = backup_id;
  return backup_id;
exception
  when others then
    if backup_id is not null then
      update public.app_backups
      set status = 'failed', error_message = sqlerrm, completed_at = now()
      where id = backup_id;
    end if;
    raise;
end
$$;

drop function if exists public.create_personal_backup(text);
create function public.create_personal_backup(p_label text default '')
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.users;
  backup_id uuid;
  snapshot jsonb;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  snapshot := jsonb_build_object(
    'format_version', 1,
    'user_preferences', coalesce((select jsonb_agg(to_jsonb(p)) from public.user_preferences p where p.user_id = actor.id), '[]'::jsonb),
    'saved_filters', coalesce((select jsonb_agg(to_jsonb(f)) from public.saved_filters f where f.user_id = actor.id), '[]'::jsonb)
  );
  insert into public.app_backups(
    scope, owner_user_id, created_by, created_by_name, label, payload,
    item_count, size_bytes, status, completed_at
  ) values (
    'personal', actor.id, actor.id, actor.name,
    left(coalesce(nullif(btrim(p_label), ''), 'Personal backup'), 120), snapshot,
    jsonb_array_length(snapshot -> 'user_preferences') + jsonb_array_length(snapshot -> 'saved_filters'),
    pg_column_size(snapshot), 'completed', now()
  ) returning id into backup_id;
  return backup_id;
end
$$;

create or replace function public.restore_system_backup(p_backup_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.users;
  selected_backup public.app_backups;
  safety_backup_id uuid;
  tables_payload jsonb;
  table_name text;
  restore_tables text[] := public.system_backup_tables();
  reverse_index integer;
  previous_auth_user_ids uuid[];
  auth_record record;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null or actor.role <> 'Admin'::public.app_role then
    raise exception using errcode = '42501', message = 'Administrator role is required to restore the system';
  end if;
  select * into selected_backup from public.app_backups where id = p_backup_id for update;
  if selected_backup.id is null or selected_backup.scope <> 'system' or selected_backup.status <> 'completed' then
    raise exception using errcode = '22023', message = 'A completed system backup is required';
  end if;
  if coalesce((selected_backup.payload ->> 'format_version')::integer, 0) <> 1 then
    raise exception using errcode = '22023', message = 'Unsupported backup format';
  end if;

  perform pg_advisory_xact_lock(hashtext('weapon-store-system-restore'));
  safety_backup_id := public.create_system_backup(
    'Automatic safety backup before restore ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
  update public.app_backups set status = 'restoring' where id = p_backup_id;
  tables_payload := selected_backup.payload -> 'tables';
  select coalesce(array_agg(auth_user_id), '{}'::uuid[]) into previous_auth_user_ids
  from public.users where auth_user_id is not null;

  perform set_config('session_replication_role', 'replica', true);
  for reverse_index in reverse coalesce(array_upper(restore_tables, 1), 0)..coalesce(array_lower(restore_tables, 1), 1) loop
    table_name := restore_tables[reverse_index];
    if tables_payload ? table_name and to_regclass(format('public.%I', table_name)) is not null then
      execute format('delete from public.%I', table_name);
    end if;
  end loop;
  foreach table_name in array restore_tables loop
    if tables_payload ? table_name and to_regclass(format('public.%I', table_name)) is not null then
      execute format(
        'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)',
        table_name, table_name
      ) using tables_payload -> table_name;
    end if;
  end loop;

  for auth_record in
    select * from jsonb_to_recordset(selected_backup.payload -> 'auth_users') as restored_auth(
      id uuid,
      email varchar,
      encrypted_password varchar,
      email_confirmed_at timestamptz,
      raw_app_meta_data jsonb,
      raw_user_meta_data jsonb,
      is_super_admin boolean,
      banned_until timestamptz,
      deleted_at timestamptz
    )
  loop
    update auth.users
    set email = auth_record.email,
        encrypted_password = auth_record.encrypted_password,
        email_confirmed_at = auth_record.email_confirmed_at,
        raw_app_meta_data = auth_record.raw_app_meta_data,
        raw_user_meta_data = auth_record.raw_user_meta_data,
        is_super_admin = auth_record.is_super_admin,
        banned_until = auth_record.banned_until,
        deleted_at = auth_record.deleted_at,
        updated_at = now()
    where id = auth_record.id;
  end loop;
  update auth.users current_auth
  set banned_until = now() + interval '100 years', updated_at = now()
  where current_auth.id = any(previous_auth_user_ids)
    and not exists (
      select 1
      from jsonb_array_elements(selected_backup.payload -> 'auth_users') restored
      where (restored ->> 'id')::uuid = current_auth.id
    );
  perform set_config('session_replication_role', 'origin', true);

  update public.app_backups
  set status = 'completed', restored_at = now(), restored_by = (
    select u.id from public.users u where u.id = actor.id
  )
  where id = p_backup_id;
  insert into public.audit_logs(
    id, timestamp, date, user_id, user_name, action_type, event_action,
    description, metadata, table_name, record_id
  ) values (
    gen_random_uuid()::text, now(), current_date, actor.id, actor.name,
    'Backup', 'SYSTEM_RESTORE', actor.name || ' restored the complete system backup',
    jsonb_build_object('backup_id', p_backup_id, 'safety_backup_id', safety_backup_id),
    'app_backups', p_backup_id::text
  );
  return safety_backup_id;
exception
  when others then
    perform set_config('session_replication_role', 'origin', true);
    update public.app_backups set status = 'failed', error_message = sqlerrm
    where id = p_backup_id;
    raise;
end
$$;

create or replace function public.delete_backup(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then
    raise exception using errcode = '42501', message = 'Administrator role is required to delete backups';
  end if;
  delete from public.app_backups where id = p_backup_id;
end
$$;

drop policy if exists app_backups_employee_read on public.app_backups;
create policy app_backups_employee_read on public.app_backups for select to authenticated
using (
  scope = 'personal' and owner_user_id = public.current_app_user_id()
  or scope = 'system' and (
    public.is_app_admin() or public.has_app_permission('backups.system.create')
  )
);

revoke all on public.app_backups from authenticated;
grant select (
  id, scope, owner_user_id, created_by, created_by_name, label, created_at,
  restored_at, restored_by, item_count, size_bytes, status, completed_at, error_message
) on public.app_backups to authenticated;
grant execute on function public.update_own_email(text) to authenticated;
grant execute on function public.create_system_backup(text) to authenticated;
grant execute on function public.create_personal_backup(text) to authenticated;
grant execute on function public.restore_personal_backup(uuid) to authenticated;
grant execute on function public.restore_system_backup(uuid) to authenticated;
grant execute on function public.delete_backup(uuid) to authenticated;

commit;
