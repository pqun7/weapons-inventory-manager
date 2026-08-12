-- Qualify the actor lookup so the users.auth_user_id column cannot conflict
-- with the local auth_user_id variable used while creating an Auth identity.

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
  select app_user.* into actor
  from public.users app_user
  where app_user.auth_user_id = auth.uid() and app_user.is_active
  limit 1;
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

revoke all on function public.admin_users_action(jsonb) from public, anon;
grant execute on function public.admin_users_action(jsonb) to authenticated;
notify pgrst, 'reload schema';
