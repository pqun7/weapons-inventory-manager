begin;

-- Supabase Auth updates an existing admin user with PUT. A later activation
-- migration accidentally restored PATCH, which GoTrue rejects with HTTP 405.
-- Normalize the legacy method centrally as well as repairing current callers
-- so stores upgraded from any supported schema keep working.
--
-- New sb_secret_* keys are API keys, not JWTs, and must not be placed in the
-- Authorization Bearer header. Legacy service_role JWTs still need both
-- headers. Keep detailed provider errors without assuming every error body is
-- valid JSON (405 responses can be empty).
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
  request_method text := case when upper(p_method) = 'PATCH' then 'PUT' else upper(p_method) end;
  request_headers extensions.http_header[];
  response_status integer;
  response_content text;
  response_json jsonb;
  response_message text;
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

  request_headers := array[
    extensions.http_header('apikey', service_key),
    extensions.http_header('Content-Type', 'application/json')
  ];
  if service_key not like 'sb_secret_%' then
    request_headers := array_prepend(
      extensions.http_header('Authorization', 'Bearer ' || service_key),
      request_headers
    );
  end if;

  select response.status, response.content
  into response_status, response_content
  from extensions.http((
    request_method,
    rtrim(project_url, '/') || '/auth/v1/admin/users' || p_path,
    request_headers,
    'application/json',
    coalesce(p_body, '{}'::jsonb)::text
  )::extensions.http_request) response;

  if nullif(response_content, '') is not null then
    begin
      response_json := response_content::jsonb;
    exception when others then
      response_json := null;
    end;
  end if;
  response_message := coalesce(
    response_json ->> 'msg',
    response_json ->> 'message',
    response_json ->> 'error_description',
    nullif(left(regexp_replace(coalesce(response_content, ''), '[[:space:]]+', ' ', 'g'), 300), ''),
    'Supabase Auth administration failed'
  );

  if response_status < 200 or response_status >= 300 then
    raise exception using errcode = 'P0001',
      message = response_message,
      detail = 'Auth API status ' || coalesce(response_status::text, 'unknown');
  end if;
  if nullif(response_content, '') is null then return '{}'::jsonb; end if;
  if response_json is null then
    raise exception using errcode = 'P0001', message = 'Supabase Auth returned an invalid response';
  end if;
  return response_json;
end
$$;

revoke all on function public.auth_admin_request(text, text, jsonb) from public, anon, authenticated;

do $$
declare
  signature regprocedure;
  function_definition text;
  corrected_definition text;
begin
  foreach signature in array array[
    'public.admin_users_action(jsonb)'::regprocedure,
    'public.claim_account(text,text,text)'::regprocedure
  ] loop
    select pg_get_functiondef(signature) into function_definition;
    corrected_definition := replace(
      function_definition,
      'auth_admin_request(''PATCH''',
      'auth_admin_request(''PUT'''
    );
    if corrected_definition <> function_definition then
      execute corrected_definition;
    end if;
  end loop;
end
$$;

revoke all on function public.admin_users_action(jsonb) from public, anon;
grant execute on function public.admin_users_action(jsonb) to authenticated;
revoke all on function public.claim_account(text, text, text) from public;
grant execute on function public.claim_account(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
