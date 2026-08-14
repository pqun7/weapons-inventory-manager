begin;

-- A brand-new project needs the same non-demo baseline that the maintenance
-- reset command preserves. Existing installations keep their current values.
insert into public.currencies
  (iso_code, name, symbol, decimal_precision, is_active, last_known_rate, last_rate_updated_at)
values
  ('USD', 'US Dollar', '$', 2, true, 1, now()),
  ('SAR', 'Saudi Riyal', 'SAR', 2, true, 3.75, now()),
  ('SDG', 'Sudanese Pound', 'SDG', 2, true, 1, now()),
  ('EGP', 'Egyptian Pound', 'EGP', 2, true, 1, now())
on conflict (iso_code) do nothing;

insert into public.system_settings (
  id, currency_symbol, currency_code, accounting_currency_code,
  rate_base_currency_code, supported_currencies, show_demo_data
) values (1, '$', 'USD', 'USD', 'USD', '["USD", "SAR", "SDG", "EGP"]'::jsonb, false)
on conflict (id) do nothing;

-- Every deployed store owns exactly one Supabase project. This row exposes only
-- non-sensitive compatibility metadata through the RPC below; the table itself
-- is never selectable through the Data API.
create table if not exists public.app_installation (
  singleton boolean primary key default true check (singleton),
  installation_id uuid not null default gen_random_uuid(),
  store_name text not null default 'Armory Store' check (length(store_name) between 1 and 120),
  schema_version text not null default '20260814000100',
  setup_completed_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.app_installation(singleton, schema_version)
values (true, '20260814000100')
on conflict (singleton) do update set schema_version = excluded.schema_version;

alter table public.app_installation enable row level security;
revoke all on table public.app_installation from public, anon, authenticated;

create or replace function public.armory_installation_info()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'storeName', installation.store_name,
    'installationId', installation.installation_id::text,
    'schemaVersion', installation.schema_version,
    'initialized', installation.setup_completed_at is not null
      and exists (select 1 from public.users where is_primary_admin and is_active)
  )
  from public.app_installation installation
  where installation.singleton
$$;

revoke all on function public.armory_installation_info() from public;
grant execute on function public.armory_installation_info() to anon, authenticated;

-- New sb_secret keys are sent as an apikey. Legacy JWT service_role keys still
-- require the Authorization header. In both cases the credential remains
-- encrypted in Vault and is never returned to a desktop client.
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
  request_headers extensions.http_header[];
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
    upper(p_method),
    rtrim(project_url, '/') || '/auth/v1/admin/users' || p_path,
    request_headers,
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
