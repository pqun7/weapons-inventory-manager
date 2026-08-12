-- All active staff may view non-financial customer profile information. Editing
-- remains capability-controlled. Arbitrary profile attributes are stored as a
-- validated label/value JSON object and are included automatically in backups.

alter table public.customers
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.customers
  drop constraint if exists customers_custom_fields_object_check;
alter table public.customers
  add constraint customers_custom_fields_object_check
  check (jsonb_typeof(custom_fields) = 'object');

create or replace function public.valid_customer_custom_fields(p_fields jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(coalesce(p_fields, '{}'::jsonb)) = 'object'
    and (select count(*) from jsonb_object_keys(coalesce(p_fields, '{}'::jsonb))) <= 50
    and not exists (
      select 1
      from jsonb_each(coalesce(p_fields, '{}'::jsonb)) field
      where jsonb_typeof(field.value) <> 'string'
         or btrim(field.key) = ''
         or length(btrim(field.key)) > 80
         or length(field.value #>> '{}') > 1000
    )
$$;

alter table public.customers
  drop constraint if exists customers_custom_fields_content_check;
alter table public.customers
  add constraint customers_custom_fields_content_check
  check (public.valid_customer_custom_fields(custom_fields));

drop policy if exists customer_sales_read on public.customers;
create policy customer_active_staff_read on public.customers
for select to authenticated
using (public.current_app_user_id() is not null);

drop policy if exists employee_customer_insert on public.customers;
drop policy if exists staff_customer_insert on public.customers;
create policy customer_capability_insert on public.customers
for insert to authenticated
with check (
  public.is_app_admin()
  or public.has_app_permission('customers.manage')
  or public.can_sell_inventory()
);

drop policy if exists employee_customer_update on public.customers;
drop policy if exists staff_customer_update on public.customers;
create policy customer_capability_update on public.customers
for update to authenticated
using (
  public.is_app_admin()
  or public.has_app_permission('customers.manage')
  or public.can_sell_inventory()
)
with check (
  public.is_app_admin()
  or public.has_app_permission('customers.manage')
  or public.can_sell_inventory()
);

create or replace function public.update_customer(p_customer_id text, p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  old_row public.customers%rowtype;
  new_row public.customers%rowtype;
  requested_custom_fields jsonb;
begin
  if not public.is_app_admin()
     and not public.has_app_permission('customers.manage')
     and not public.can_sell_inventory() then
    raise exception using errcode = '42501', message = 'customer permission is required';
  end if;
  select c.* into old_row from public.customers c
  where c.id = p_customer_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;
  if p_patch ? 'email'
     and nullif(btrim(p_patch ->> 'email'), '') is not null
     and btrim(p_patch ->> 'email') !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception using errcode = '22023', message = 'invalid customer email';
  end if;
  requested_custom_fields := case
    when p_patch ? 'customFields' then coalesce(p_patch -> 'customFields', '{}'::jsonb)
    else old_row.custom_fields
  end;
  if not public.valid_customer_custom_fields(requested_custom_fields) then
    raise exception using errcode = '22023', message = 'invalid customer custom fields';
  end if;

  update public.customers c set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else c.name end,
    phone = case when p_patch ? 'phone' then btrim(p_patch ->> 'phone') else c.phone end,
    email = case when p_patch ? 'email' then btrim(p_patch ->> 'email') else c.email end,
    address = case when p_patch ? 'address' then btrim(p_patch ->> 'address') else c.address end,
    is_wholesale_buyer = case when p_patch ? 'isWholesaleBuyer' then (p_patch ->> 'isWholesaleBuyer')::boolean else c.is_wholesale_buyer end,
    wholesale_discount_percent = case when p_patch ? 'wholesaleDiscountPercent' then (p_patch ->> 'wholesaleDiscountPercent')::numeric else c.wholesale_discount_percent end,
    notes = case when p_patch ? 'notes' then coalesce(p_patch ->> 'notes', '') else c.notes end,
    custom_fields = requested_custom_fields
  where c.id = p_customer_id
  returning c.* into new_row;

  if nullif(new_row.name, '') is null then
    raise exception using errcode = '22023', message = 'customer name is required';
  end if;
  perform public.write_audit_event('Update', 'Customer updated', jsonb_build_object(
    'entityType', 'Customer', 'entityId', new_row.id, 'entityName', new_row.name,
    'previousValues', jsonb_build_object(
      'name', old_row.name, 'phone', old_row.phone, 'email', old_row.email,
      'address', old_row.address, 'isWholesaleBuyer', old_row.is_wholesale_buyer,
      'wholesaleDiscountPercent', old_row.wholesale_discount_percent,
      'notes', old_row.notes, 'customFields', old_row.custom_fields
    ),
    'newValues', jsonb_build_object(
      'name', new_row.name, 'phone', new_row.phone, 'email', new_row.email,
      'address', new_row.address, 'isWholesaleBuyer', new_row.is_wholesale_buyer,
      'wholesaleDiscountPercent', new_row.wholesale_discount_percent,
      'notes', new_row.notes, 'customFields', new_row.custom_fields
    )
  ));
end
$$;

revoke all on function public.valid_customer_custom_fields(jsonb) from public, anon;
grant execute on function public.valid_customer_custom_fields(jsonb) to authenticated;
revoke all on function public.update_customer(text, jsonb) from public, anon;
grant execute on function public.update_customer(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
