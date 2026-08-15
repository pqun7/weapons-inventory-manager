begin;

-- Vault's `secret` column is ciphertext. Server-only administration must read
-- `decrypted_secret` from the protected decrypted_secrets view.
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
  select decrypted.decrypted_secret into service_key
  from vault.decrypted_secrets decrypted
  where decrypted.name = 'weapon_store_service_role'
  limit 1;
  select decrypted.decrypted_secret into project_url
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

notify pgrst, 'reload schema';

commit;
