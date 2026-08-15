begin;

-- Deleted profiles remain as historical foreign-key targets, but only active
-- profiles should reserve user-facing identities.
drop index if exists public.users_email_unique_ci;
drop index if exists public.users_login_email_unique_ci;
drop index if exists public.users_name_unique_ci;
alter table public.users drop constraint if exists users_username_key;

create unique index users_email_unique_ci
  on public.users (lower(email)) where is_active and email is not null;
create unique index users_login_email_unique_ci
  on public.users (lower(login_email)) where is_active;
create unique index users_name_unique_ci
  on public.users (lower(btrim(name))) where is_active;
create unique index users_username_unique_ci
  on public.users (lower(username)) where is_active and username is not null;

-- Identity fields are immutable for live profiles. The internal release helper
-- gets a transaction-local exception solely while deactivating a non-primary
-- profile. Checking primary protection first keeps the owner undeletable even
-- if the internal flag is present.
create or replace function public.prevent_user_identity_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_primary_admin and (new.role <> 'Admin'::public.app_role or not new.is_active) then
    raise exception using errcode = '42501', message = 'The primary administrator cannot be demoted or deleted';
  end if;
  if current_setting('weapon_store.account_delete_mode', true) = 'on'
     and old.is_active and not new.is_active then
    return new;
  end if;
  if new.name is distinct from old.name then
    raise exception using errcode = '42501', message = 'A user name cannot be changed after account creation';
  end if;
  if new.login_email is distinct from old.login_email then
    raise exception using errcode = '42501', message = 'The internal login identity cannot be changed';
  end if;
  if new.is_primary_admin is distinct from old.is_primary_admin then
    raise exception using errcode = '42501', message = 'The primary administrator designation cannot be changed through the application';
  end if;
  return new;
end
$$;

create or replace function public.release_user_identity(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public, auth, vault, extensions
as $$
declare
  target public.users;
begin
  select * into target from public.users where id = p_user_id for update;
  if target.id is null then return; end if;
  if target.is_primary_admin then
    raise exception using errcode = '42501', message = 'The primary administrator cannot be deleted';
  end if;

  perform set_config('weapon_store.account_delete_mode', 'on', true);
  update public.users
  set auth_user_id = null,
      password_set = false,
      activation_token_hash = null,
      activation_expires_at = null,
      is_active = false
  where id = target.id;
  perform set_config('weapon_store.account_delete_mode', 'off', true);

  -- Hard deletion releases the email in Supabase Auth. The database update is
  -- performed first so an Auth failure rolls the transaction back cleanly.
  if target.auth_user_id is not null then
    perform public.auth_admin_request('DELETE', '/' || target.auth_user_id::text, '{}'::jsonb);
  end if;
end
$$;

revoke all on function public.release_user_identity(text) from public, anon, authenticated;

create or replace function public.release_conflicting_inactive_user_identities(
  p_name text,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public, auth, vault, extensions
as $$
declare
  conflict record;
begin
  for conflict in
    select id from public.users
    where not is_active and (
      (p_name is not null and lower(btrim(name)) = lower(btrim(p_name)))
      or (p_email is not null and (
        lower(email) = lower(p_email)
        or lower(login_email) = lower(p_email)
        or lower(username) = lower(p_email)
      ))
    )
    order by id
  loop
    perform public.release_user_identity(conflict.id);
  end loop;
end
$$;

revoke all on function public.release_conflicting_inactive_user_identities(text, text)
  from public, anon, authenticated;

-- Patch the current administration RPC while preserving later fixes applied to
-- it by previous migrations.
do $$
declare
  function_definition text;
  corrected_definition text;
  create_conflict_marker text := $marker$    if exists (
      select 1 from public.users existing
      where lower(btrim(existing.name)) = lower(btrim(clean_name))
    ) then$marker$;
  create_conflict_replacement text := $marker$    perform public.release_conflicting_inactive_user_identities(clean_name, clean_email);
    if exists (
      select 1 from public.users existing
      where existing.is_active and lower(btrim(existing.name)) = lower(btrim(clean_name))
    ) then$marker$;
  email_conflict_marker text := $marker$      where lower(existing.email) = lower(clean_email)
    ) then$marker$;
  email_conflict_replacement text := $marker$      where existing.is_active and lower(existing.email) = lower(clean_email)
    ) then$marker$;
  update_marker text := $marker$    update public.users
    set email = clean_email,$marker$;
  update_replacement text := $marker$    perform public.release_conflicting_inactive_user_identities(null, clean_email);
    update public.users
    set email = clean_email,$marker$;
  delete_marker_patch text := $marker$    if target.auth_user_id is not null then
      perform public.auth_admin_request('PATCH', '/' || target.auth_user_id::text, jsonb_build_object('ban_duration', '876000h'));
    end if;
    update public.users set is_active = false where id = target.id;$marker$;
  delete_marker_put text := $marker$    if target.auth_user_id is not null then
      perform public.auth_admin_request('PUT', '/' || target.auth_user_id::text, jsonb_build_object('ban_duration', '876000h'));
    end if;
    update public.users set is_active = false where id = target.id;$marker$;
begin
  select pg_get_functiondef('public.admin_users_action(jsonb)'::regprocedure)
  into function_definition;

  corrected_definition := replace(
    function_definition,
    'target_id text := ''U-'' || gen_random_uuid()::text;',
    'target_id text := case when action_name = ''create'' then ''U-'' || gen_random_uuid()::text else coalesce(user_payload ->> ''id'', p_request ->> ''userId'') end;'
  );
  if corrected_definition = function_definition then
    corrected_definition := replace(
      function_definition,
      'target_id text := coalesce(user_payload ->> ''id'', p_request ->> ''userId'');',
      'target_id text := case when action_name = ''create'' then ''U-'' || gen_random_uuid()::text else coalesce(user_payload ->> ''id'', p_request ->> ''userId'') end;'
    );
  end if;
  if corrected_definition = function_definition then
    raise exception 'Expected user ID declaration was not found';
  end if;
  function_definition := corrected_definition;

  corrected_definition := replace(function_definition, create_conflict_marker, create_conflict_replacement);
  if corrected_definition = function_definition then
    raise exception 'Expected create-name conflict block was not found';
  end if;
  function_definition := corrected_definition;

  corrected_definition := replace(function_definition, email_conflict_marker, email_conflict_replacement);
  if corrected_definition = function_definition then
    raise exception 'Expected create-email conflict block was not found';
  end if;
  function_definition := corrected_definition;

  corrected_definition := replace(function_definition, update_marker, update_replacement);
  if corrected_definition = function_definition then
    raise exception 'Expected user-update block was not found';
  end if;
  function_definition := corrected_definition;

  corrected_definition := replace(
    function_definition,
    delete_marker_patch,
    '    perform public.release_user_identity(target.id);'
  );
  if corrected_definition = function_definition then
    corrected_definition := replace(
      function_definition,
      delete_marker_put,
      '    perform public.release_user_identity(target.id);'
    );
  end if;
  if corrected_definition = function_definition then
    raise exception 'Expected null-safe user-delete block was not found';
  end if;

  execute corrected_definition;
end
$$;

revoke all on function public.admin_users_action(jsonb) from public, anon;
grant execute on function public.admin_users_action(jsonb) to authenticated;

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
  perform public.release_conflicting_inactive_user_identities(null, clean_email);
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

revoke all on function public.update_own_email(text) from public, anon;
grant execute on function public.update_own_email(text) to authenticated;

notify pgrst, 'reload schema';

commit;
