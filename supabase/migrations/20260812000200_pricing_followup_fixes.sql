begin;

create or replace function public.create_inventory_product_type(p_category text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public, auth as $$
declare
  actor_id text;
  type_id text;
  existing_name text;
  clean_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  normalized text;
begin
  if not public.can_change_inventory() then
    raise exception using errcode = '42501', message = 'inventory permission is required';
  end if;
  if p_category not in ('accessory', 'ammunition') or clean_name = '' then
    raise exception using errcode = '22023', message = 'a valid product type is required';
  end if;
  normalized := lower(clean_name);
  select u.id into actor_id
  from public.users as u
  where u.auth_user_id = auth.uid() and u.is_active
  limit 1;

  select t.id, t.name into type_id, existing_name
  from public.inventory_product_types as t
  where t.category = p_category and t.normalized_name = normalized
  limit 1;
  if type_id is not null then
    return jsonb_build_object('id', type_id, 'category', p_category, 'name', existing_name, 'created', false);
  end if;

  type_id := gen_random_uuid()::text;
  insert into public.inventory_product_types (id, category, name, normalized_name, created_by)
  values (type_id, p_category, clean_name, normalized, actor_id);
  perform public.write_audit_event(
    'Intake',
    case when p_category = 'accessory' then 'Accessory type created' else 'Ammunition type created' end,
    jsonb_build_object(
      'entityType', 'InventoryProductType', 'entityId', type_id, 'entityName', clean_name,
      'category', p_category,
      'newValues', jsonb_build_object('name', clean_name, 'category', p_category)
    )
  );
  return jsonb_build_object('id', type_id, 'category', p_category, 'name', clean_name, 'created', true);
end
$$;

revoke all on function public.create_inventory_product_type(text, text) from public, anon;
grant execute on function public.create_inventory_product_type(text, text) to authenticated;

commit;
