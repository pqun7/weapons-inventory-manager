begin;

-- A scheduled import becomes orphaned when its pre-receipt shipment is
-- deleted because shipment_imports.shipment_id uses ON DELETE SET NULL.
-- Permit that exact recovery transition, then repair existing orphan rows.
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
    or (old.status = 'scheduled' and new.status = 'pending_review' and old.shipment_id is null and new.shipment_id is null)
    or (old.status = 'arrived' and new.status in ('received', 'scheduled', 'cancelled'))
    or (old.status = 'failed' and new.status in ('processing', 'cancelled'))
  ) then
    raise exception using errcode = '23514', message = 'invalid shipment manifest status transition';
  end if;
  return new;
end
$$;

update public.shipment_imports as manifest
set
  status = 'pending_review',
  reviewed_at = null,
  confirmed_at = null,
  error_code = null,
  error_message = null,
  updated_at = now()
where manifest.status = 'scheduled'
  and manifest.shipment_id is null;

-- Define these functions directly so behavior does not depend on fragile
-- textual patches from older deployed versions.
create or replace function public.update_manifest_items(p_import_id text, p_item_ids jsonb, p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  changed integer;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment edit permission is required';
  end if;
  if not exists (
    select 1
    from public.shipment_imports as manifest
    where manifest.id = p_import_id
      and manifest.status = 'pending_review'
      and manifest.shipment_id is null
  ) then
    raise exception using errcode = '23514', message = 'manifest cannot be edited while linked to an active shipment';
  end if;
  if jsonb_typeof(p_item_ids) <> 'array'
    or jsonb_array_length(p_item_ids) < 1
    or jsonb_array_length(p_item_ids) > 2000
  then
    raise exception using errcode = '22023', message = 'select between 1 and 2000 manifest items';
  end if;

  changed := public.apply_manifest_item_patch(p_import_id, p_item_ids, p_patch);
  if changed = 0 then
    raise exception using errcode = 'P0002', message = 'manifest item not found';
  end if;
  perform public.validate_manifest_import(p_import_id);
  actor_id := public.current_app_user_id();
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (
    public.next_business_id('LOG'), now(), current_date, actor_id, 'Shipment',
    'Manifest items updated during review',
    jsonb_build_object(
      'importId', p_import_id,
      'itemCount', changed,
      'fields', (select jsonb_agg(field.key) from jsonb_object_keys(p_patch) as field(key))
    )
  );
end
$$;

create or replace function public.update_manifest_details(p_import_id text, p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment edit permission is required';
  end if;

  update public.shipment_imports as target set
    shipment_number = case when p_patch ? 'shipmentNumber' then nullif(p_patch ->> 'shipmentNumber', '') else target.shipment_number end,
    supplier_id = case when p_patch ? 'supplierId' then nullif(p_patch ->> 'supplierId', '') else target.supplier_id end,
    supplier_name = case when p_patch ? 'supplierName' then nullif(p_patch ->> 'supplierName', '') else target.supplier_name end,
    supplier_reference = case when p_patch ? 'supplierReference' then nullif(p_patch ->> 'supplierReference', '') else target.supplier_reference end,
    invoice_number = case when p_patch ? 'invoiceNumber' then nullif(p_patch ->> 'invoiceNumber', '') else target.invoice_number end,
    manifest_number = case when p_patch ? 'manifestNumber' then nullif(p_patch ->> 'manifestNumber', '') else target.manifest_number end,
    shipment_date = case when p_patch ? 'shipmentDate' then nullif(p_patch ->> 'shipmentDate', '')::date else target.shipment_date end,
    expected_arrival_date = case when p_patch ? 'expectedArrivalDate' then nullif(p_patch ->> 'expectedArrivalDate', '')::date else target.expected_arrival_date end,
    origin = case when p_patch ? 'origin' then nullif(p_patch ->> 'origin', '') else target.origin end,
    destination = case when p_patch ? 'destination' then nullif(p_patch ->> 'destination', '') else target.destination end,
    currency = case when p_patch ? 'currency' then upper(nullif(p_patch ->> 'currency', '')) else target.currency end,
    review_note = case when p_patch ? 'reviewNote' then nullif(p_patch ->> 'reviewNote', '') else target.review_note end,
    additional_costs = case when p_patch ? 'additionalCosts' then coalesce(p_patch -> 'additionalCosts', '[]'::jsonb) else target.additional_costs end,
    updated_at = now()
  where target.id = p_import_id
    and target.status = 'pending_review'
    and target.shipment_id is null;

  if not found then
    raise exception using errcode = '23514', message = 'manifest cannot be edited while linked to an active shipment';
  end if;
end
$$;

-- Deleting a pre-receipt shipment now removes its linked manifest workspace.
-- Re-uploading the same file therefore creates a clean pending review.
create or replace function public.delete_shipment(p_shipment_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  shipment_row public.shipments%rowtype;
  linked_import_id text;
begin
  if not public.is_app_admin() then
    raise exception using errcode = '42501', message = 'administrator permission is required to delete a shipment';
  end if;
  select u.id into actor_id
  from public.users as u
  where u.auth_user_id = auth.uid() and u.is_active
  limit 1;
  select s.* into shipment_row
  from public.shipments as s
  where s.id = p_shipment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'shipment not found';
  end if;
  if exists (select 1 from public.weapons as weapon where weapon.shipment_id = p_shipment_id)
    or exists (select 1 from public.inventory_transactions as transaction where transaction.shipment_id = p_shipment_id)
    or exists (select 1 from public.inventory_cost_snapshots as snapshot where snapshot.shipment_id = p_shipment_id)
  then
    raise exception using errcode = '23503', message = 'shipment cannot be deleted because inventory has already been received';
  end if;
  if exists (select 1 from public.invoices as invoice where invoice.shipment_id = p_shipment_id) then
    raise exception using errcode = '23503', message = 'shipment cannot be deleted because it is linked to an invoice';
  end if;

  linked_import_id := shipment_row.import_id;
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (
    public.next_business_id('LOG'), now(), current_date, actor_id, 'Shipment',
    'Shipment deleted - ' || shipment_row.shipment_number,
    jsonb_build_object(
      'shipmentId', shipment_row.id,
      'shipmentNumber', shipment_row.shipment_number,
      'supplierId', shipment_row.supplier_id,
      'status', shipment_row.status,
      'workflowStatus', shipment_row.workflow_status,
      'importId', linked_import_id
    )
  );

  delete from public.shipments as shipment where shipment.id = p_shipment_id;
  if linked_import_id is not null then
    delete from public.shipment_imports as manifest
    where manifest.id = linked_import_id
      and manifest.shipment_id is null;
  end if;
end
$$;

-- A legacy orphan must never win hash de-duplication. Active reviews and
-- manifests still linked to an existing shipment remain protected.
do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.create_manifest_review(jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    $old$where i.file_hash = p_payload ->> 'fileHash' and i.status not in ('failed', 'cancelled')$old$,
    $new$where i.file_hash = p_payload ->> 'fileHash'
      and (
        i.status in ('processing', 'pending_review')
        or (
          i.status in ('scheduled', 'arrived', 'received')
          and i.shipment_id is not null
          and exists (select 1 from public.shipments as shipment where shipment.id = i.shipment_id)
        )
      )$new$
  );
  if patched = definition then
    raise exception 'create_manifest_review orphan de-duplication patch did not match';
  end if;
  execute patched;
end
$$;

revoke all on function public.update_manifest_items(text, jsonb, jsonb) from public, anon;
revoke all on function public.update_manifest_details(text, jsonb) from public, anon;
revoke all on function public.delete_shipment(text) from public, anon;
grant execute on function public.update_manifest_items(text, jsonb, jsonb) to authenticated;
grant execute on function public.update_manifest_details(text, jsonb) to authenticated;
grant execute on function public.delete_shipment(text) to authenticated;

commit;
