begin;

create or replace function public.current_app_user_id()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id
  from public.users as u
  where u.auth_user_id = auth.uid()
    and u.is_active
  limit 1
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.role
  from public.users as u
  where u.auth_user_id = auth.uid()
    and u.is_active
  limit 1
$$;

create or replace function public.has_app_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (
      select u.role = 'Admin'
        or coalesce((u.permissions ->> permission_name)::boolean, false)
      from public.users as u
      where u.auth_user_id = auth.uid()
        and u.is_active
      limit 1
    ),
    false
  )
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.current_app_role() = 'Admin', false)
$$;

create or replace function public.can_view_inventory()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.current_app_role() in ('Admin', 'Employee', 'Manager', 'Sales', 'Inventory', 'Read-Only'), false)
$$;

create or replace function public.can_change_inventory()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.current_app_role() in ('Admin', 'Employee', 'Manager', 'Sales', 'Inventory'), false)
$$;

create or replace function public.can_sell_inventory()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.current_app_role() in ('Admin', 'Employee', 'Manager', 'Sales'), false)
$$;

create or replace function public.can_manage_shipments()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    public.current_app_role() in ('Admin', 'Manager', 'Inventory')
      or public.has_app_permission('shipment.import')
      or public.has_app_permission('canImportExcel'),
    false
  )
$$;

create or replace function public.can_view_financials()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    public.current_app_role() in ('Admin', 'Manager', 'Sales', 'Accountant', 'Read-Only')
      or public.has_app_permission('canViewReports'),
    false
  )
$$;

revoke all on function public.current_app_user_id() from public;
revoke all on function public.current_app_role() from public;
revoke all on function public.has_app_permission(text) from public;
revoke all on function public.is_app_admin() from public;
revoke all on function public.can_view_inventory() from public;
revoke all on function public.can_change_inventory() from public;
revoke all on function public.can_sell_inventory() from public;
revoke all on function public.can_manage_shipments() from public;
revoke all on function public.can_view_financials() from public;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_app_permission(text) to authenticated;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.can_view_inventory() to authenticated;
grant execute on function public.can_change_inventory() to authenticated;
grant execute on function public.can_sell_inventory() to authenticated;
grant execute on function public.can_manage_shipments() to authenticated;
grant execute on function public.can_view_financials() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();
create trigger shipments_set_updated_at before update on public.shipments
for each row execute function public.set_updated_at();
create trigger weapons_set_updated_at before update on public.weapons
for each row execute function public.set_updated_at();
create trigger invoices_set_updated_at before update on public.invoices
for each row execute function public.set_updated_at();
create trigger accessories_set_updated_at before update on public.accessories
for each row execute function public.set_updated_at();
create trigger ammunition_set_updated_at before update on public.ammunition
for each row execute function public.set_updated_at();
create trigger system_settings_set_updated_at before update on public.system_settings
for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at before update on public.user_preferences
for each row execute function public.set_updated_at();
create trigger shipment_items_set_updated_at before update on public.shipment_items
for each row execute function public.set_updated_at();
create trigger product_costs_set_updated_at before update on public.product_costs
for each row execute function public.set_updated_at();
create trigger shipment_costs_set_updated_at before update on public.shipment_costs
for each row execute function public.set_updated_at();
create trigger shipment_cost_allocations_set_updated_at before update on public.shipment_cost_allocations
for each row execute function public.set_updated_at();
create trigger shipment_imports_set_updated_at before update on public.shipment_imports
for each row execute function public.set_updated_at();
create trigger shipment_import_items_set_updated_at before update on public.shipment_import_items
for each row execute function public.set_updated_at();

create or replace function public.validate_manifest_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'draft' and new.status in ('processing', 'cancelled'))
    or (old.status = 'processing' and new.status in ('pending_review', 'failed', 'cancelled'))
    or (old.status = 'pending_review' and new.status in ('scheduled', 'arrived', 'cancelled', 'processing'))
    or (old.status = 'scheduled' and new.status in ('arrived', 'cancelled'))
    or (old.status = 'arrived' and new.status in ('received', 'scheduled', 'cancelled'))
    or (old.status = 'failed' and new.status in ('processing', 'cancelled'))
  ) then
    raise exception using errcode = '23514', message = 'invalid shipment manifest status transition';
  end if;
  return new;
end
$$;

create trigger shipment_imports_validate_transition
before update of status on public.shipment_imports
for each row execute function public.validate_manifest_status_transition();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'weapon_types', 'weapon_subtypes', 'calibers', 'subtype_calibers', 'brands', 'models',
    'warehouses', 'storage_locations', 'currencies', 'exchange_rate_history',
    'exchange_rate_overrides', 'exchange_rate_audit_log', 'users', 'suppliers', 'customers',
    'shipments', 'weapons', 'invoices', 'payment_records', 'accessories', 'ammunition',
    'ammunition_weapon_compatibility', 'accessory_weapon_compatibility', 'audit_logs',
    'app_notifications', 'system_settings', 'saved_filters', 'user_preferences',
    'financial_data_issues', 'inventory_transactions', 'shipment_items', 'product_costs',
    'shipment_costs', 'shipment_cost_scope_items', 'shipment_cost_allocations',
    'inventory_cost_snapshots', 'shipment_imports', 'shipment_documents',
    'shipment_import_items', 'shipment_validation_issues', 'shipment_item_changes',
    'shipment_status_history', 'migration_runs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy admin_full_access on public.%I for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin())',
      table_name
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'weapon_types', 'weapon_subtypes', 'calibers', 'subtype_calibers', 'brands', 'models',
    'warehouses', 'storage_locations', 'currencies'
  ] loop
    execute format(
      'create policy authenticated_reference_read on public.%I for select to authenticated using (public.current_app_user_id() is not null)',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'weapons', 'accessories', 'ammunition', 'ammunition_weapon_compatibility',
    'accessory_weapon_compatibility', 'inventory_transactions', 'inventory_cost_snapshots',
    'product_costs'
  ] loop
    execute format(
      'create policy staff_inventory_read on public.%I for select to authenticated using (public.can_view_inventory())',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'shipments', 'shipment_items', 'shipment_costs', 'shipment_cost_scope_items',
    'shipment_cost_allocations', 'shipment_imports', 'shipment_documents',
    'shipment_import_items', 'shipment_validation_issues', 'shipment_item_changes',
    'shipment_status_history', 'suppliers'
  ] loop
    execute format(
      'create policy shipment_staff_read on public.%I for select to authenticated using (public.can_manage_shipments() or public.can_view_inventory())',
      table_name
    );
  end loop;

  foreach table_name in array array['customers', 'invoices', 'payment_records'] loop
    execute format(
      'create policy financial_staff_read on public.%I for select to authenticated using (public.can_view_financials() or public.can_sell_inventory())',
      table_name
    );
  end loop;
end
$$;

create policy own_profile_read on public.users
for select to authenticated
using (auth_user_id = auth.uid());

create policy own_preferences_access on public.user_preferences
for all to authenticated
using (user_id = public.current_app_user_id())
with check (user_id = public.current_app_user_id());

create policy own_saved_filters_access on public.saved_filters
for all to authenticated
using (user_id = public.current_app_user_id())
with check (user_id = public.current_app_user_id());

create policy staff_settings_read on public.system_settings
for select to authenticated
using (public.current_app_user_id() is not null);

create policy staff_exchange_history_read on public.exchange_rate_history
for select to authenticated
using (public.current_app_user_id() is not null);

create policy staff_exchange_override_read on public.exchange_rate_overrides
for select to authenticated
using (public.current_app_user_id() is not null);

create policy financial_exchange_audit_read on public.exchange_rate_audit_log
for select to authenticated
using (public.can_view_financials());

create policy permitted_audit_read on public.audit_logs
for select to authenticated
using (public.is_app_admin() or public.has_app_permission('canViewReports'));

create policy own_or_broadcast_notifications_read on public.app_notifications
for select to authenticated
using (user_id is null or user_id = public.current_app_user_id());

create policy own_notifications_update on public.app_notifications
for update to authenticated
using (user_id = public.current_app_user_id())
with check (user_id = public.current_app_user_id());

create policy admin_financial_issues_read on public.financial_data_issues
for select to authenticated
using (public.is_app_admin() or public.current_app_role() = 'Accountant');

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.user_preferences, public.saved_filters, public.app_notifications to authenticated;

commit;
