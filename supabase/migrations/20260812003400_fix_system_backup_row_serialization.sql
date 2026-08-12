-- Avoid column/alias collisions (for example exchange_rate_history.source)
-- while serializing complete table rows.

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
      'select coalesce(jsonb_agg(to_jsonb(snapshot_row)), ''[]''::jsonb), count(*) from public.%I snapshot_row',
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
      completed_at = now(),
      error_message = null
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

revoke all on function public.create_system_backup(text) from public, anon;
grant execute on function public.create_system_backup(text) to authenticated;

notify pgrst, 'reload schema';
