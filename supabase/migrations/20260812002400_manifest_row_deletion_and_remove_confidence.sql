begin;

-- Confidence is an extraction implementation detail. It is deliberately not a
-- shipment business field and is no longer persisted or exposed in tables.
create or replace function public.create_manifest_review(p_payload jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  import_id text := coalesce(nullif(p_payload ->> 'id', ''), gen_random_uuid()::text);
  existing_id text;
  item jsonb;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment import permission is required';
  end if;
  select public.current_app_user_id() into actor_id;
  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception using errcode = '22023', message = 'at least one manifest item is required';
  end if;
  if coalesce(p_payload ->> 'fileHash', '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid manifest file hash';
  end if;

  select i.id into existing_id
  from public.shipment_imports as i
  where i.file_hash = p_payload ->> 'fileHash' and i.status not in ('failed', 'cancelled')
  order by i.created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;

  insert into public.shipment_imports (
    id, status, file_name, file_type, file_size, file_hash, raw_extraction_json,
    normalized_json, shipment_number, supplier_name, supplier_reference,
    invoice_number, manifest_number, shipment_date, expected_arrival_date, origin,
    destination, currency, review_note, prompt_version, schema_version, ai_provider,
    ai_model, ai_request_id, ai_processing_ms, ai_requested_at, validation_summary,
    error_code, error_message, created_by
  ) values (
    import_id, 'pending_review', p_payload ->> 'fileName', p_payload ->> 'fileType',
    (p_payload ->> 'fileSize')::integer, p_payload ->> 'fileHash',
    coalesce(p_payload -> 'rawExtraction', '{}'::jsonb), coalesce(p_payload -> 'normalized', '{}'::jsonb),
    nullif(p_payload ->> 'shipmentNumber', ''), nullif(p_payload ->> 'supplierName', ''),
    nullif(p_payload ->> 'supplierReference', ''), nullif(p_payload ->> 'invoiceNumber', ''),
    nullif(p_payload ->> 'manifestNumber', ''), nullif(p_payload ->> 'shipmentDate', '')::date,
    nullif(p_payload ->> 'expectedArrivalDate', '')::date, nullif(p_payload ->> 'origin', ''),
    nullif(p_payload ->> 'destination', ''), upper(nullif(p_payload ->> 'currency', '')),
    nullif(p_payload ->> 'reviewNote', ''), nullif(p_payload ->> 'promptVersion', ''),
    coalesce(nullif(p_payload ->> 'schemaVersion', ''), '1.3'), nullif(p_payload ->> 'aiProvider', ''),
    nullif(p_payload ->> 'aiModel', ''), nullif(p_payload ->> 'aiRequestId', ''),
    nullif(p_payload ->> 'aiProcessingMs', '')::integer,
    case when p_payload ->> 'aiProvider' is null then null else now() end,
    '{}'::jsonb, nullif(p_payload ->> 'errorCode', ''), nullif(p_payload ->> 'errorMessage', ''), actor_id
  );

  for item in select value from jsonb_array_elements(p_payload -> 'items') loop
    insert into public.shipment_import_items (
      id, import_id, row_index, product_type, product_name, category, weapon_type,
      manufacturer, model, caliber, sku, product_code, serial_number, serial_numbers_json,
      quantity, unit_price, retail_price, wholesale_price, retail_price_mode,
      wholesale_price_mode, additional_costs, total_price, currency, country_of_origin, weapon_type_id,
      weapon_subtype_id, brand_id, model_id, caliber_id, storage_location_id,
      source_json, raw_data_json, status
    ) values (
      coalesce(nullif(item ->> 'id', ''), gen_random_uuid()::text), import_id,
      (item ->> 'rowIndex')::integer, nullif(item ->> 'productType', ''),
      nullif(item ->> 'productName', ''), nullif(item ->> 'category', ''),
      nullif(item ->> 'weaponType', ''), nullif(item ->> 'manufacturer', ''),
      nullif(item ->> 'model', ''), nullif(item ->> 'caliber', ''), nullif(item ->> 'sku', ''),
      nullif(item ->> 'productCode', ''), nullif(item ->> 'serialNumber', ''),
      coalesce(item -> 'serialNumbers', '[]'::jsonb), nullif(item ->> 'quantity', '')::integer,
      nullif(item ->> 'unitPrice', '')::numeric,
      nullif(item ->> 'retailPrice', '')::numeric, nullif(item ->> 'wholesalePrice', '')::numeric,
      coalesce(nullif(item ->> 'retailPriceMode', ''), 'auto'),
      coalesce(nullif(item ->> 'wholesalePriceMode', ''), 'auto'),
      coalesce(item -> 'additionalCosts', '[]'::jsonb), nullif(item ->> 'totalPrice', '')::numeric,
      upper(nullif(item ->> 'currency', '')), nullif(item ->> 'countryOfOrigin', ''),
      nullif(item ->> 'weaponTypeId', ''), nullif(item ->> 'weaponSubtypeId', ''),
      nullif(item ->> 'brandId', ''), nullif(item ->> 'modelId', ''),
      nullif(item ->> 'caliberId', ''), nullif(item ->> 'storageLocationId', ''),
      coalesce(item -> 'source', '{}'::jsonb), coalesce(item -> 'rawData', '{}'::jsonb), 'needs_review'
    );
  end loop;

  insert into public.shipment_status_history (id, import_id, shipment_id, from_status, to_status, note, changed_by)
  values (gen_random_uuid()::text, import_id, null, null, 'pending_review', 'Manifest extraction saved to Supabase', actor_id);
  perform public.validate_manifest_import(import_id);
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (public.next_business_id('LOG'), now(), current_date, actor_id, 'Import', 'Manifest processed for review - ' || (p_payload ->> 'fileName'), jsonb_build_object('importId', import_id, 'fileHash', p_payload ->> 'fileHash', 'itemCount', jsonb_array_length(p_payload -> 'items')));
  return import_id;
end
$$;

alter table public.shipment_import_items drop column if exists confidence_json;

create or replace function public.delete_manifest_items(p_import_id text, p_item_ids jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  deleted_count integer;
  remaining_count integer;
  target_count integer;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment edit permission is required';
  end if;
  if not exists (select 1 from public.shipment_imports as i where i.id = p_import_id and i.status in ('pending_review', 'failed')) then
    raise exception using errcode = '23514', message = 'only unconfirmed manifests can be edited';
  end if;
  if jsonb_typeof(p_item_ids) <> 'array' or jsonb_array_length(p_item_ids) < 1 or jsonb_array_length(p_item_ids) > 2000 then
    raise exception using errcode = '22023', message = 'select between 1 and 2000 manifest items';
  end if;

  select count(*) into remaining_count
  from public.shipment_import_items as item
  where item.import_id = p_import_id;
  select count(*) into target_count
  from public.shipment_import_items as item
  where item.import_id = p_import_id
    and item.id in (select distinct value from jsonb_array_elements_text(p_item_ids));
  if target_count = 0 then
    raise exception using errcode = 'P0002', message = 'manifest item not found';
  end if;
  if remaining_count - target_count < 1 then
    raise exception using errcode = '23514', message = 'a shipment must keep at least one product row';
  end if;

  delete from public.shipment_import_items as item
  where item.import_id = p_import_id
    and item.id in (select value from jsonb_array_elements_text(p_item_ids));
  get diagnostics deleted_count = row_count;
  perform public.validate_manifest_import(p_import_id);
  actor_id := public.current_app_user_id();
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (public.next_business_id('LOG'), now(), current_date, actor_id, 'Delete', 'Shipment manifest rows deleted', jsonb_build_object('importId', p_import_id, 'deletedCount', deleted_count, 'itemIds', p_item_ids));
end
$$;

revoke all on function public.delete_manifest_items(text, jsonb) from public, anon;
grant execute on function public.delete_manifest_items(text, jsonb) to authenticated;

commit;
