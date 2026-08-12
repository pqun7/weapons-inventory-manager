begin;

-- The application deliberately exposes only two business roles. Fine-grained
-- employee access is represented by boolean capabilities in users.permissions.
do $$
begin
  create type public.app_role as enum ('Admin', 'Employee');
exception
  when duplicate_object then null;
end
$$;

alter table public.users drop constraint if exists users_role_check;
alter table public.users alter column role drop default;
update public.users set role = 'Employee' where role <> 'Admin';
alter table public.users
  alter column role type public.app_role using role::public.app_role,
  alter column role set default 'Employee'::public.app_role;

alter table public.users
  add column if not exists email text,
  add column if not exists login_email text,
  add column if not exists activation_token_hash text,
  add column if not exists activation_expires_at timestamptz;

update public.users
set email = lower(username)
where email is null and username ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

update public.users
set login_email = coalesce(
  email,
  'legacy.' || md5(id) || '@local.weapon-store.invalid'
)
where login_email is null;

alter table public.users alter column login_email set not null;
create unique index if not exists users_email_unique_ci
  on public.users (lower(email)) where email is not null;
create unique index if not exists users_login_email_unique_ci
  on public.users (lower(login_email));
create unique index if not exists users_name_unique_ci
  on public.users (lower(btrim(name)));

alter table public.users alter column username drop not null;

update public.users
set permissions = (jsonb_build_object(
  'inventory.view', true,
  'sales.create', true,
  'backups.view', true,
  'backups.personal.create', true,
  'backups.personal.restore', true,
  'canViewReports', false,
  'canManageUsers', false
) || permissions) || jsonb_build_object('canViewReports', false, 'canManageUsers', false)
where role = 'Employee'::public.app_role;

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public, auth
as $$
  select u.role::text from public.users u
  where u.auth_user_id = auth.uid() and u.is_active limit 1
$$;

create or replace function public.prevent_user_identity_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    raise exception using errcode = '42501', message = 'A user name cannot be changed after account creation';
  end if;
  if new.login_email is distinct from old.login_email then
    raise exception using errcode = '42501', message = 'The internal login identity cannot be changed';
  end if;
  return new;
end
$$;

drop trigger if exists users_prevent_identity_changes on public.users;
create trigger users_prevent_identity_changes
before update on public.users
for each row execute function public.prevent_user_identity_changes();

-- Sensitive reporting capabilities are never delegable to an Employee.
create or replace function public.has_app_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((
    select case
      when u.role = 'Admin'::public.app_role then true
      when permission_name in ('statistics.view', 'financials.view', 'reports.view', 'metrics.view', 'canViewReports', 'canManageUsers') then false
      else coalesce((u.permissions -> permission_name) = 'true'::jsonb, false)
    end
    from public.users u
    where u.auth_user_id = auth.uid() and u.is_active
    limit 1
  ), false)
$$;

create or replace function public.can_view_inventory()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select public.is_app_admin() or public.has_app_permission('inventory.view') $$;

create or replace function public.can_change_inventory()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select public.is_app_admin() or public.has_app_permission('inventory.edit') $$;

create or replace function public.can_sell_inventory()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select public.is_app_admin() or public.has_app_permission('sales.create') $$;

create or replace function public.can_manage_shipments()
returns boolean language sql stable security definer set search_path = public, auth
as $$
  select public.is_app_admin()
    or public.has_app_permission('shipment.import')
    or public.has_app_permission('shipment.review')
    or public.has_app_permission('shipment.edit')
    or public.has_app_permission('shipment.receive')
$$;

create or replace function public.can_view_financials()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select public.is_app_admin() $$;

-- Backups are stored as scoped snapshots. Employee payloads are intentionally
-- limited by the create/restore RPCs to user-owned preferences and filters.
do $$
begin
  create type public.backup_scope as enum ('system', 'personal');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.app_backups (
  id uuid primary key default gen_random_uuid(),
  scope public.backup_scope not null,
  owner_user_id text references public.users(id) on delete cascade,
  created_by text not null references public.users(id) on delete restrict,
  created_by_name text not null,
  label text not null default '',
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by text references public.users(id) on delete set null,
  check ((scope = 'system' and owner_user_id is null) or (scope = 'personal' and owner_user_id is not null))
);

create table if not exists public.account_auth_attempts (
  id bigint generated always as identity primary key,
  identifier_hash text not null,
  ip_hash text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists account_auth_attempts_rate_limit
  on public.account_auth_attempts (identifier_hash, ip_hash, attempted_at desc);
alter table public.account_auth_attempts enable row level security;

alter table public.app_backups enable row level security;
drop policy if exists app_backups_admin_all on public.app_backups;
create policy app_backups_admin_all on public.app_backups for all to authenticated
using (public.is_app_admin()) with check (public.is_app_admin());
drop policy if exists app_backups_employee_read on public.app_backups;
create policy app_backups_employee_read on public.app_backups for select to authenticated
using (
  public.has_app_permission('backups.view')
  and scope = 'personal' and owner_user_id = public.current_app_user_id()
);

create or replace view public.backup_catalog
with (security_barrier = true)
as
select id, scope, owner_user_id, created_by, created_by_name, label, created_at, restored_at, restored_by
from public.app_backups;

create or replace function public.create_personal_backup(p_label text default '')
returns public.app_backups
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.users;
  result public.app_backups;
begin
  select * into actor from public.users
  where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null then
    raise exception using errcode = '42501', message = 'Personal backup permission is required';
  end if;

  insert into public.app_backups(scope, owner_user_id, created_by, created_by_name, label, payload)
  values (
    'personal', actor.id, actor.id, actor.name, left(coalesce(p_label, ''), 120),
    jsonb_build_object(
      'user_preferences', coalesce((select jsonb_agg(to_jsonb(p)) from public.user_preferences p where p.user_id = actor.id), '[]'::jsonb),
      'saved_filters', coalesce((select jsonb_agg(to_jsonb(f)) from public.saved_filters f where f.user_id = actor.id), '[]'::jsonb)
    )
  ) returning * into result;
  return result;
end
$$;

create or replace function public.restore_personal_backup(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id text := public.current_app_user_id();
  backup public.app_backups;
begin
  select * into backup from public.app_backups where id = p_backup_id;
  if backup.id is null or backup.scope <> 'personal' or backup.owner_user_id <> actor_id then
    raise exception using errcode = '42501', message = 'Only an owned personal backup can be restored';
  end if;
  delete from public.user_preferences where user_id = actor_id;
  insert into public.user_preferences
  select * from jsonb_populate_recordset(null::public.user_preferences, backup.payload -> 'user_preferences');
  delete from public.saved_filters where user_id = actor_id;
  insert into public.saved_filters
  select * from jsonb_populate_recordset(null::public.saved_filters, backup.payload -> 'saved_filters');
  update public.app_backups set restored_at = now(), restored_by = actor_id where id = backup.id;
end
$$;

-- This RPC previously accepted any inventory editor. New reference types are
-- master data and therefore administrator-only.
create or replace function public.create_inventory_product_type(p_category text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  type_id text;
  existing_name text;
  clean_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  normalized text;
begin
  if not public.is_app_admin() then
    raise exception using errcode = '42501', message = 'administrator role is required to create master data';
  end if;
  if p_category not in ('accessory', 'ammunition') or clean_name = '' then
    raise exception using errcode = '22023', message = 'a valid product type is required';
  end if;
  normalized := lower(clean_name);
  actor_id := public.current_app_user_id();
  select t.id, t.name into type_id, existing_name
  from public.inventory_product_types t
  where t.category = p_category and t.normalized_name = normalized limit 1;
  if type_id is not null then
    return jsonb_build_object('id', type_id, 'category', p_category, 'name', existing_name, 'created', false);
  end if;
  type_id := gen_random_uuid()::text;
  insert into public.inventory_product_types(id, category, name, normalized_name, created_by)
  values (type_id, p_category, clean_name, normalized, actor_id);
  return jsonb_build_object('id', type_id, 'category', p_category, 'name', clean_name, 'created', true);
end
$$;

-- Extend the existing audit table without breaking its presentation layer.
alter table public.audit_logs
  add column if not exists user_name text,
  add column if not exists event_action text,
  add column if not exists table_name text,
  add column if not exists record_id text,
  add column if not exists old_values jsonb,
  add column if not exists new_values jsonb;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor_id text;
  actor_name text;
  before_row jsonb;
  after_row jsonb;
  row_id text;
begin
  select u.id, u.name into actor_id, actor_name
  from public.users u where u.auth_user_id = auth.uid() limit 1;
  actor_id := coalesce(actor_id, 'SYSTEM');
  actor_name := coalesce(actor_name, 'System');
  before_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  after_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  if tg_table_name = 'users' then
    before_row := before_row - 'login_email' - 'activation_token_hash';
    after_row := after_row - 'login_email' - 'activation_token_hash';
  elsif tg_table_name = 'app_backups' then
    before_row := before_row - 'payload';
    after_row := after_row - 'payload';
  end if;
  row_id := coalesce(after_row ->> 'id', before_row ->> 'id', after_row ->> 'iso_code', before_row ->> 'iso_code', '');

  insert into public.audit_logs(
    id, timestamp, date, user_id, user_name, action_type, event_action,
    description, metadata, table_name, record_id, old_values, new_values
  ) values (
    gen_random_uuid()::text, now(), current_date, actor_id, actor_name,
    initcap(lower(tg_op)), tg_op,
    format('%s %s on %I', actor_name, lower(tg_op), tg_table_name),
    jsonb_build_object('table', tg_table_name, 'record_id', row_id),
    tg_table_name, row_id, before_row, after_row
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

do $$
declare
  target record;
begin
  for target in
    select tablename from pg_tables
    where schemaname = 'public' and tablename not in ('audit_logs', 'account_auth_attempts')
  loop
    execute format('drop trigger if exists audit_row_change on public.%I', target.tablename);
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      target.tablename
    );
  end loop;
end
$$;

-- Replace policies whose legacy definitions exposed currency data to every user.
drop policy if exists authenticated_reference_read on public.currencies;
drop policy if exists staff_exchange_history_read on public.exchange_rate_history;
drop policy if exists staff_exchange_override_read on public.exchange_rate_overrides;
drop policy if exists financial_exchange_audit_read on public.exchange_rate_audit_log;

create policy permitted_currency_read on public.currencies for select to authenticated
using (public.is_app_admin() or public.has_app_permission('currencies.view'));
create policy permitted_exchange_history_read on public.exchange_rate_history for select to authenticated
using (public.is_app_admin() or public.has_app_permission('currencies.view'));
create policy permitted_exchange_override_read on public.exchange_rate_overrides for select to authenticated
using (public.is_app_admin() or public.has_app_permission('currencies.view'));
create policy permitted_exchange_audit_read on public.exchange_rate_audit_log for select to authenticated
using (public.is_app_admin() or public.has_app_permission('currencies.view'));

drop policy if exists inventory_product_types_read on public.inventory_product_types;
create policy inventory_product_types_read on public.inventory_product_types for select to authenticated
using (public.current_app_user_id() is not null);

drop policy if exists admin_currency_insert on public.currencies;
create policy admin_or_permitted_currency_insert on public.currencies for insert to authenticated
with check (public.is_app_admin() or public.has_app_permission('currencies.add'));
drop policy if exists admin_currency_update on public.currencies;
create policy admin_or_permitted_currency_update on public.currencies for update to authenticated
using (public.is_app_admin() or public.has_app_permission('currencies.edit'))
with check (public.is_app_admin() or public.has_app_permission('currencies.edit'));
drop policy if exists admin_currency_delete on public.currencies;
create policy admin_or_permitted_currency_delete on public.currencies for delete to authenticated
using (public.is_app_admin() or public.has_app_permission('currencies.delete'));

grant select, insert, update, delete on public.app_backups to authenticated;
grant select on public.backup_catalog to authenticated;
grant insert, update on public.users to authenticated;
grant insert, update, delete on public.currencies, public.exchange_rate_overrides to authenticated;
grant execute on function public.create_personal_backup(text) to authenticated;
grant execute on function public.restore_personal_backup(uuid) to authenticated;

commit;
