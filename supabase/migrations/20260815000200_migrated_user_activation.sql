begin;

-- Imported SQLite password hashes are intentionally never copied into
-- Supabase Auth.  Every non-primary user receives a stable internal login
-- address and an Auth identity is created only when that user claims a fresh
-- activation code issued by an administrator.

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
        'auth_user_id', null,
        'login_email', lower(coalesce(nullif(regexp_replace(source_row ->> 'id', '[^a-zA-Z0-9]', '', 'g'), ''), 'migrated'))
          || '.' || substr(md5(p_migration_id::text || ':' || (source_row ->> 'id')), 1, 12)
          || '@local.weapon-store.invalid',
        'password_set', false, 'activation_token_hash', null,
        'activation_expires_at', null, 'is_primary_admin', false,
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

create or replace function public.claim_account(p_identifier text, p_activation_code text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  account public.users;
  clean_identifier text := regexp_replace(btrim(p_identifier), '\s+', ' ', 'g');
  auth_response jsonb;
  created_auth_user_id uuid;
begin
  if length(p_password) < 8 or length(p_password) > 256
     or p_password !~ '[a-z]' or p_password !~ '[A-Z]' or p_password !~ '[0-9]' then
    raise exception using errcode = '22023', message = 'Use 8 to 256 characters with upper-case, lower-case, and a number';
  end if;
  select * into account from public.users
  where is_active and (
    (position('@' in clean_identifier) > 0 and lower(email) = lower(clean_identifier))
    or (position('@' in clean_identifier) = 0 and lower(name) = lower(clean_identifier))
  ) for update;
  if account.id is null then raise exception using errcode = 'P0002', message = 'Account not found'; end if;
  if account.password_set then raise exception using errcode = '22023', message = 'Password setup has already been completed'; end if;
  if account.activation_expires_at is null or account.activation_expires_at < now() then
    raise exception using errcode = '22023', message = 'The activation code is missing or expired';
  end if;
  if encode(digest(upper(btrim(p_activation_code)), 'sha256'), 'hex') <> account.activation_token_hash then
    raise exception using errcode = '42501', message = 'Activation code is incorrect';
  end if;

  if account.auth_user_id is null then
    auth_response := public.auth_admin_request('POST', '', jsonb_build_object(
      'email', account.login_email,
      'password', p_password,
      'email_confirm', true,
      'user_metadata', jsonb_build_object(
        'app_user_id', account.id,
        'display_name', account.name,
        'requires_password_setup', false
      )
    ));
    created_auth_user_id := (auth_response ->> 'id')::uuid;
    if created_auth_user_id is null then
      raise exception using errcode = 'P0001', message = 'Supabase Auth did not create the migrated account';
    end if;
  else
    perform public.auth_admin_request('PATCH', '/' || account.auth_user_id::text, jsonb_build_object(
      'password', p_password,
      'user_metadata', jsonb_build_object(
        'app_user_id', account.id,
        'display_name', account.name,
        'requires_password_setup', false
      )
    ));
  end if;

  update public.users
  set auth_user_id = coalesce(auth_user_id, created_auth_user_id),
      password_set = true,
      activation_token_hash = null,
      activation_expires_at = null
  where id = account.id;
  insert into public.audit_logs(
    id, timestamp, date, user_id, user_name, action_type, event_action,
    description, metadata, table_name, record_id
  ) values (
    gen_random_uuid()::text, now(), current_date, account.id, account.name,
    'Update', 'PASSWORD_SETUP', account.name || ' completed first-login password setup',
    jsonb_build_object('account_id', account.id), 'users', account.id
  );
  return jsonb_build_object('success', true, 'loginEmail', account.login_email);
exception
  when others then
    if created_auth_user_id is not null then
      begin
        perform public.auth_admin_request('DELETE', '/' || created_auth_user_id::text, '{}'::jsonb);
      exception when others then null;
      end;
    end if;
    raise;
end
$$;

do $$
declare
  function_definition text;
  old_delete text := $replace$    perform public.auth_admin_request('PATCH', '/' || target.auth_user_id::text, jsonb_build_object('ban_duration', '876000h'));
    update public.users set is_active = false where id = target.id;$replace$;
  safe_delete text := $replace$    if target.auth_user_id is not null then
      perform public.auth_admin_request('PATCH', '/' || target.auth_user_id::text, jsonb_build_object('ban_duration', '876000h'));
    end if;
    update public.users set is_active = false where id = target.id;$replace$;
  released_delete text := '    perform public.release_user_identity(target.id);';
begin
  select pg_get_functiondef('public.admin_users_action(jsonb)'::regprocedure)
  into function_definition;
  if position(released_delete in function_definition) > 0 then
    null;
  elsif position(safe_delete in function_definition) > 0 then
    null;
  elsif position(old_delete in function_definition) > 0 then
    execute replace(function_definition, old_delete, safe_delete);
  else
    raise exception 'Expected migrated-user delete block was not found';
  end if;
end
$$;

revoke all on function public.claim_account(text, text, text) from public;
grant execute on function public.claim_account(text, text, text) to anon, authenticated;

update public.app_installation
set schema_version = '20260815000200'
where singleton;

notify pgrst, 'reload schema';

commit;
