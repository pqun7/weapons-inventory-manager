-- Restore system snapshots without requiring the managed Postgres superuser-only
-- session_replication_role setting. User triggers are disabled transactionally;
-- foreign-key and other internal constraint triggers remain enabled.

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

  select * into selected_backup
  from public.app_backups
  where id = p_backup_id
  for update;
  if selected_backup.id is null
     or selected_backup.scope <> 'system'
     or selected_backup.status <> 'completed' then
    raise exception using errcode = '22023', message = 'A completed system backup is required';
  end if;
  if coalesce((selected_backup.payload ->> 'format_version')::integer, 0) <> 1 then
    raise exception using errcode = '22023', message = 'Unsupported backup format';
  end if;

  perform pg_advisory_xact_lock(hashtext('weapon-store-system-restore'));
  safety_backup_id := public.create_system_backup(
    'Automatic safety backup before restore ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
  update public.app_backups set status = 'restoring', error_message = null
  where id = p_backup_id;

  tables_payload := selected_backup.payload -> 'tables';
  select coalesce(array_agg(auth_user_id), '{}'::uuid[])
  into previous_auth_user_ids
  from public.users
  where auth_user_id is not null;

  -- USER triggers include audit and derived-data triggers. Disabling them here
  -- prevents the restore itself from changing the snapshot being restored.
  -- Constraint triggers remain active, so corrupt snapshots still fail atomically.
  foreach table_name in array restore_tables loop
    if tables_payload ? table_name
       and to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I disable trigger user', table_name);
    end if;
  end loop;

  for reverse_index in reverse
    coalesce(array_upper(restore_tables, 1), 0)..coalesce(array_lower(restore_tables, 1), 1)
  loop
    table_name := restore_tables[reverse_index];
    if tables_payload ? table_name
       and to_regclass(format('public.%I', table_name)) is not null then
      execute format('delete from public.%I', table_name);
    end if;
  end loop;

  foreach table_name in array restore_tables loop
    if tables_payload ? table_name
       and to_regclass(format('public.%I', table_name)) is not null then
      execute format(
        'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)',
        table_name,
        table_name
      ) using tables_payload -> table_name;
    end if;
  end loop;

  foreach table_name in array restore_tables loop
    if tables_payload ? table_name
       and to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable trigger user', table_name);
    end if;
  end loop;

  for auth_record in
    select *
    from jsonb_to_recordset(selected_backup.payload -> 'auth_users') as restored_auth(
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

  update public.app_backups
  set status = 'completed',
      restored_at = now(),
      restored_by = (select u.id from public.users u where u.id = actor.id),
      error_message = null
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
    -- All table changes and trigger state above are transactional and are rolled
    -- back before this handler runs. Re-raise so the client receives the cause.
    raise;
end
$$;

revoke all on function public.restore_system_backup(uuid) from public, anon;
grant execute on function public.restore_system_backup(uuid) to authenticated;

notify pgrst, 'reload schema';
