begin;

do $$
declare
  definition text;
  patched text;
  supplier_check text := 'if not exists (select 1 from public.suppliers as s where s.id = supplier_id) then raise exception using errcode = ''23503'', message = ''supplier not found''; end if;';
  supplier_resolution text := $body$
  supplier_id := nullif(btrim(p_input ->> 'supplierId'), '');
  new_supplier := p_input -> 'newSupplier';
  if new_supplier is not null and jsonb_typeof(new_supplier) = 'object' then
    if nullif(btrim(new_supplier ->> 'name'), '') is null then
      raise exception using errcode = '22023', message = 'supplier name is required';
    end if;
    select s.id into supplier_id
    from public.suppliers as s
    where regexp_replace(lower(s.name), '[^[:alnum:]]', '', 'g') =
          regexp_replace(lower(btrim(new_supplier ->> 'name')), '[^[:alnum:]]', '', 'g')
    order by s.date_added, s.id limit 1 for update;
    if not found then
      supplier_id := public.next_business_id('SUP');
      insert into public.suppliers (id, name, contact_person, phone, email, address, date_added)
      values (
        supplier_id, regexp_replace(btrim(new_supplier ->> 'name'), '\s+', ' ', 'g'),
        btrim(coalesce(new_supplier ->> 'contactPerson', '')),
        btrim(coalesce(new_supplier ->> 'phone', '')),
        lower(btrim(coalesce(new_supplier ->> 'email', ''))),
        btrim(coalesce(new_supplier ->> 'address', '')), current_date
      );
    end if;
  end if;
  if supplier_id is null or not exists (select 1 from public.suppliers as s where s.id = supplier_id) then
    raise exception using errcode = '23503', message = 'supplier not found';
  end if;$body$;
begin
  select pg_get_functiondef('public.create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(definition, 'shipment_id text;', 'shipment_id text;' || E'\n  supplier_id text;' || E'\n  new_supplier jsonb;');
  patched := replace(patched, 'p_input ->> ''supplierId''', 'supplier_id');
  patched := replace(patched, supplier_check, supplier_resolution);
  if patched = definition or position(supplier_check in patched) > 0 then
    raise exception 'create_shipment supplier transaction patch did not match the installed function';
  end if;
  execute patched;
end
$$;

do $$
declare
  definition text;
  patched text;
  sync_supplier text := E'\n  select jsonb_set(shipment_input, ''{supplierId}'', to_jsonb(s.supplier_id), true) into shipment_input from public.shipments as s where s.id = ';
begin
  select pg_get_functiondef('public.bulk_create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(definition,
    'created_shipment_id := public.create_shipment(shipment_input);',
    'created_shipment_id := public.create_shipment(shipment_input);' || sync_supplier || 'created_shipment_id;');
  patched := replace(patched,
    'shipment_id := public.create_shipment(shipment_input);',
    'shipment_id := public.create_shipment(shipment_input);' || sync_supplier || 'shipment_id;');
  if patched = definition then
    raise exception 'bulk_create_shipment supplier synchronization patch did not match the installed function';
  end if;
  execute patched;
end
$$;

revoke all on function public.create_shipment(jsonb) from public, anon;
revoke all on function public.bulk_create_shipment(jsonb) from public, anon;
grant execute on function public.create_shipment(jsonb) to authenticated;
grant execute on function public.bulk_create_shipment(jsonb) to authenticated;

commit;
