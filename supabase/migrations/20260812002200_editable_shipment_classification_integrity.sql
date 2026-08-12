begin;

-- Legitimate pre-receipt states remain editable. Permission checks and the
-- Arrived/Cancelled guard in the function continue to protect final records.
do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.update_scheduled_shipment(text,jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    $$if shipment_row.workflow_status <> 'scheduled' or shipment_row.status in ('Arrived', 'Cancelled') then$$,
    $$if shipment_row.workflow_status not in ('draft', 'pending_review', 'scheduled', 'failed') or shipment_row.status in ('Arrived', 'Cancelled') then$$
  );
  patched := replace(
    patched,
    $$message = 'only scheduled shipments can be edited'$$,
    $$message = 'only pre-receipt shipments can be edited'$$
  );
  if patched = definition then
    raise exception 'update_scheduled_shipment workflow guard patch did not match';
  end if;
  execute patched;
end
$$;

-- Validate the complete relationship tuple before accepting edited JSON.
-- This prevents a label from being paired with a stale subtype/model ID and
-- moves the error to the edit boundary instead of inventory receipt.
do $$
declare
  definition text;
  patched text;
  marker text := '  select coalesce(sum((line.value ->> ''quantity'')::integer), 0) into next_total';
  validation text := $validation$
  if exists (
    select 1
    from jsonb_array_elements(next_lines) as line(value)
    where line.value ->> 'productType' = 'weapon'
      and not exists (
        select 1 from public.weapon_subtypes as subtype
        where subtype.id = line.value ->> 'weaponSubtypeId'
          and subtype.weapon_type_id = line.value ->> 'weaponTypeId'
      )
  ) then
    raise exception using errcode = '23503', message = 'weapon type and subtype are incompatible';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(next_lines) as line(value)
    where line.value ->> 'productType' = 'weapon'
      and not exists (
        select 1 from public.subtype_calibers as relation
        where relation.subtype_id = line.value ->> 'weaponSubtypeId'
          and relation.caliber_id = line.value ->> 'caliberId'
      )
  ) then
    raise exception using errcode = '23503', message = 'weapon subtype and caliber are incompatible';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(next_lines) as line(value)
    where line.value ->> 'productType' = 'weapon'
      and not exists (
        select 1 from public.models as model
        where model.id = line.value ->> 'modelId'
          and model.brand_id = line.value ->> 'brandId'
      )
  ) then
    raise exception using errcode = '23503', message = 'weapon brand and model are incompatible';
  end if;
  $validation$;
begin
  select pg_get_functiondef('public.update_scheduled_shipment(text,jsonb)'::regprocedure) into definition;
  patched := replace(definition, marker, validation || marker);
  if patched = definition then
    raise exception 'update_scheduled_shipment classification validation patch did not match';
  end if;
  execute patched;
end
$$;

-- Failed reviews may be corrected and revalidated instead of becoming
-- permanently locked. Confirmed scheduled shipments use the shipment editor.
do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.update_manifest_items(text,jsonb,jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    $$i.status = 'pending_review'$$,
    $$i.status in ('pending_review', 'failed')$$
  );
  patched := replace(
    patched,
    $$message = 'only manifests pending review can be edited'$$,
    $$message = 'only unconfirmed manifests can be edited'$$
  );
  if patched = definition then
    raise exception 'update_manifest_items editable states patch did not match';
  end if;
  execute patched;

  select pg_get_functiondef('public.update_manifest_details(text,jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    $$target.status = 'pending_review'$$,
    $$target.status in ('pending_review', 'failed')$$
  );
  patched := replace(
    patched,
    $$message = 'only manifests pending review can be edited'$$,
    $$message = 'only unconfirmed manifests can be edited'$$
  );
  if patched = definition then
    raise exception 'update_manifest_details editable states patch did not match';
  end if;
  execute patched;
end
$$;

revoke all on function public.update_scheduled_shipment(text, jsonb) from public, anon;
revoke all on function public.update_manifest_items(text, jsonb, jsonb) from public, anon;
revoke all on function public.update_manifest_details(text, jsonb) from public, anon;
grant execute on function public.update_scheduled_shipment(text, jsonb) to authenticated;
grant execute on function public.update_manifest_items(text, jsonb, jsonb) to authenticated;
grant execute on function public.update_manifest_details(text, jsonb) to authenticated;

commit;
