begin;

create extension if not exists http with schema extensions;

drop trigger if exists users_prevent_identity_changes on public.users;
do $$
declare
  fallback_admin_id text;
begin
  if not exists (select 1 from public.users where is_primary_admin) then
    select id into fallback_admin_id
    from public.users
    where role = 'Admin'::public.app_role and is_active
    order by created_at, id
    limit 1;
    if fallback_admin_id is not null then
      update public.users
      set name = 'ايمن علي',
          username = case when email is null then 'ايمن علي' else username end,
          is_primary_admin = true
      where id = fallback_admin_id;
      update auth.users auth_user
      set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
            || jsonb_build_object('display_name', 'ايمن علي'),
          updated_at = now()
      from public.users app_user
      where app_user.id = fallback_admin_id and auth_user.id = app_user.auth_user_id;
    end if;
  end if;
end
$$;
create trigger users_prevent_identity_changes
before update on public.users
for each row execute function public.prevent_user_identity_changes();

create or replace function public.auth_admin_request(
  p_method text,
  p_path text,
  p_body jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, vault, extensions
as $$
declare
  service_key text;
  project_url text;
  response_status integer;
  response_content text;
begin
  select decrypted.secret into service_key
  from vault.decrypted_secrets decrypted
  where decrypted.name = 'weapon_store_service_role'
  limit 1;
  select decrypted.secret into project_url
  from vault.decrypted_secrets decrypted
  where decrypted.name = 'weapon_store_project_url'
  limit 1;
  if service_key is null or project_url is null then
    raise exception using errcode = '55000', message = 'Supabase server credentials are not configured in Vault';
  end if;

  select response.status, response.content
  into response_status, response_content
  from extensions.http((
    upper(p_method),
    rtrim(project_url, '/') || '/auth/v1/admin/users' || p_path,
    array[
      extensions.http_header('Authorization', 'Bearer ' || service_key),
      extensions.http_header('apikey', service_key),
      extensions.http_header('Content-Type', 'application/json')
    ],
    'application/json',
    coalesce(p_body, '{}'::jsonb)::text
  )::extensions.http_request) response;

  if response_status < 200 or response_status >= 300 then
    raise exception using errcode = 'P0001',
      message = coalesce((response_content::jsonb ->> 'msg'), (response_content::jsonb ->> 'message'), response_content, 'Supabase Auth administration failed'),
      detail = 'Auth API status ' || response_status;
  end if;
  if nullif(response_content, '') is null then return '{}'::jsonb; end if;
  return response_content::jsonb;
end
$$;

revoke all on function public.auth_admin_request(text, text, jsonb) from public, anon, authenticated;

create or replace function public.admin_users_action(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.users;
  target public.users;
  action_name text := p_request ->> 'action';
  user_payload jsonb := coalesce(p_request -> 'user', '{}'::jsonb);
  target_id text := coalesce(user_payload ->> 'id', p_request ->> 'userId');
  clean_name text;
  clean_email text;
  requested_role public.app_role;
  requested_permissions jsonb;
  login_email text;
  auth_response jsonb;
  auth_user_id uuid;
  setup_code text;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null or actor.role <> 'Admin'::public.app_role then
    raise exception using errcode = '42501', message = 'Administrator role is required';
  end if;

  if action_name = 'create' then
    clean_name := regexp_replace(btrim(user_payload ->> 'name'), '\s+', ' ', 'g');
    clean_email := nullif(lower(btrim(coalesce(user_payload ->> 'email', ''))), '');
    requested_role := coalesce((user_payload ->> 'role')::public.app_role, 'Employee'::public.app_role);
    requested_permissions := case when requested_role = 'Admin' then '{}'::jsonb else coalesce(user_payload -> 'permissions', '{}'::jsonb) end;
    if clean_name = '' or length(clean_name) > 120 then
      raise exception using errcode = '22023', message = 'Name is required and must be at most 120 characters';
    end if;
    if clean_email is not null and clean_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'Invalid email address';
    end if;
    login_email := coalesce(clean_email, lower(regexp_replace(target_id, '[^a-zA-Z0-9]', '', 'g')) || '.' || substr(gen_random_uuid()::text, 1, 8) || '@local.weapon-store.invalid');
    setup_code := upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 12));
    auth_response := public.auth_admin_request('POST', '', jsonb_build_object(
      'email', login_email,
      'password', encode(gen_random_bytes(48), 'hex') || 'Aa1!',
      'email_confirm', true,
      'user_metadata', jsonb_build_object('app_user_id', target_id, 'display_name', clean_name, 'requires_password_setup', true)
    ));
    auth_user_id := (auth_response ->> 'id')::uuid;
    insert into public.users(
      id, auth_user_id, username, email, login_email, name, role, permissions,
      password_set, activation_token_hash, activation_expires_at, is_active, is_primary_admin
    ) values (
      target_id, auth_user_id, coalesce(clean_email, clean_name), clean_email, login_email,
      clean_name, requested_role, requested_permissions, false,
      encode(digest(setup_code, 'sha256'), 'hex'), now() + interval '7 days', true, false
    );
    return jsonb_build_object('success', true, 'userId', target_id, 'activationCode', setup_code);
  end if;

  select * into target from public.users where id = target_id;
  if target.id is null then raise exception using errcode = 'P0002', message = 'User not found'; end if;

  if action_name = 'update' then
    clean_name := regexp_replace(btrim(user_payload ->> 'name'), '\s+', ' ', 'g');
    if clean_name <> target.name then raise exception using errcode = '42501', message = 'A user name cannot be changed'; end if;
    clean_email := nullif(lower(btrim(coalesce(user_payload ->> 'email', ''))), '');
    if clean_email is not null and clean_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'Invalid email address';
    end if;
    requested_role := (user_payload ->> 'role')::public.app_role;
    if target.is_primary_admin and requested_role <> 'Admin'::public.app_role then
      raise exception using errcode = '42501', message = 'The primary administrator cannot be demoted';
    end if;
    if target.id = actor.id and requested_role <> 'Admin'::public.app_role then
      raise exception using errcode = '42501', message = 'You cannot remove your own administrator role';
    end if;
    update public.users
    set email = clean_email,
        username = coalesce(clean_email, name),
        role = requested_role,
        permissions = case when requested_role = 'Admin' then '{}'::jsonb else coalesce(user_payload -> 'permissions', '{}'::jsonb) end
    where id = target.id;
    return jsonb_build_object('success', true, 'userId', target.id);
  end if;

  if action_name = 'delete' then
    if target.id = actor.id then raise exception using errcode = '42501', message = 'You cannot delete your own account'; end if;
    if target.is_primary_admin then raise exception using errcode = '42501', message = 'The primary administrator cannot be deleted'; end if;
    if target.role = 'Admin'::public.app_role and not actor.is_primary_admin then
      raise exception using errcode = '42501', message = 'Only the primary administrator can delete another administrator';
    end if;
    perform public.auth_admin_request('PATCH', '/' || target.auth_user_id::text, jsonb_build_object('ban_duration', '876000h'));
    update public.users set is_active = false where id = target.id;
    return jsonb_build_object('success', true, 'userId', target.id);
  end if;

  if action_name = 'reset-activation' then
    if target.password_set then raise exception using errcode = '22023', message = 'This account already completed password setup'; end if;
    setup_code := upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 12));
    update public.users
    set activation_token_hash = encode(digest(setup_code, 'sha256'), 'hex'),
        activation_expires_at = now() + interval '7 days'
    where id = target.id;
    return jsonb_build_object('success', true, 'userId', target.id, 'activationCode', setup_code);
  end if;

  raise exception using errcode = '22023', message = 'Unsupported user administration action';
exception
  when unique_violation then
    if auth_user_id is not null then
      perform public.auth_admin_request('DELETE', '/' || auth_user_id::text, '{}'::jsonb);
    end if;
    raise exception using errcode = '23505', message = 'The name or email is already used by another account';
end
$$;

create or replace function public.resolve_account(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  clean_identifier text := regexp_replace(btrim(p_identifier), '\s+', ' ', 'g');
  account public.users;
  v_identifier_hash text := encode(digest(lower(clean_identifier), 'sha256'), 'hex');
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip_hash text;
begin
  v_ip_hash := encode(digest(coalesce(request_headers ->> 'x-forwarded-for', 'unknown'), 'sha256'), 'hex');
  if (select count(*) from public.account_auth_attempts attempts
      where attempts.identifier_hash = v_identifier_hash
        and attempts.ip_hash = v_ip_hash
        and attempts.attempted_at >= now() - interval '15 minutes') >= 10 then
    raise exception using errcode = 'P0001', message = 'Too many attempts. Try again in 15 minutes.';
  end if;
  insert into public.account_auth_attempts(identifier_hash, ip_hash) values (v_identifier_hash, v_ip_hash);
  select * into account from public.users
  where is_active and (
    (position('@' in clean_identifier) > 0 and lower(email) = lower(clean_identifier))
    or (position('@' in clean_identifier) = 0 and lower(name) = lower(clean_identifier))
  ) limit 1;
  if account.id is null then raise exception using errcode = 'P0002', message = 'Account not found'; end if;
  return jsonb_build_object(
    'passwordSet', account.password_set,
    'loginEmail', account.login_email,
    'displayName', account.name
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
begin
  if length(p_password) < 12 or p_password !~ '[a-z]' or p_password !~ '[A-Z]' or p_password !~ '[0-9]' then
    raise exception using errcode = '22023', message = 'Use at least 12 characters with upper-case, lower-case, and a number';
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
  perform public.auth_admin_request('PATCH', '/' || account.auth_user_id::text, jsonb_build_object(
    'password', p_password,
    'user_metadata', jsonb_build_object('app_user_id', account.id, 'display_name', account.name, 'requires_password_setup', false)
  ));
  update public.users
  set password_set = true, activation_token_hash = null, activation_expires_at = null
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
end
$$;

revoke all on function public.admin_users_action(jsonb) from public, anon;
grant execute on function public.admin_users_action(jsonb) to authenticated;
revoke all on function public.resolve_account(text) from public;
grant execute on function public.resolve_account(text) to anon, authenticated;
revoke all on function public.claim_account(text, text, text) from public;
grant execute on function public.claim_account(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
