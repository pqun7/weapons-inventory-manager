begin;

-- The pgsql-http default timeout is only five seconds. Auth administration is
-- still synchronous and bounded, but gets enough time for normal provider
-- latency before returning a sanitized database error.
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

  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000');
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

-- Do not hold a public.users row lock while asking GoTrue to delete auth.users:
-- auth.users deletion follows its FK back to public.users (ON DELETE SET NULL),
-- so holding that row lock would deadlock until the HTTP request timed out.
create or replace function public.release_user_identity(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public, auth, vault, extensions
as $$
declare
  target public.users;
begin
  select * into target from public.users where id = p_user_id;
  if target.id is null then return; end if;
  if target.is_primary_admin then
    raise exception using errcode = '42501', message = 'The primary administrator cannot be deleted';
  end if;

  if target.auth_user_id is not null then
    perform public.auth_admin_request('DELETE', '/' || target.auth_user_id::text, '{}'::jsonb);
  end if;

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
end
$$;

revoke all on function public.release_user_identity(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
