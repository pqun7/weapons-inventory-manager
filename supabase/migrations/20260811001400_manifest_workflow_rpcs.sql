begin;

create or replace function public.validate_manifest_import(p_import_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  item record;
  serial_value text;
  item_status text;
  summary jsonb;
begin
  delete from public.shipment_validation_issues as issue where issue.import_id = p_import_id;

  for item in
    select i.id, i.product_type, i.product_name, i.weapon_type, i.manufacturer, i.model,
           i.caliber, i.sku, i.serial_numbers_json, i.quantity, i.unit_price,
           i.total_price, i.storage_location_id, i.weapon_type_id, i.weapon_subtype_id,
           i.brand_id, i.model_id, i.caliber_id
    from public.shipment_import_items as i
    where i.import_id = p_import_id
    order by i.row_index
  loop
    item_status := 'valid';

    if nullif(btrim(item.product_name), '') is null then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, item.id, 'productName', 'PRODUCT_REQUIRED', 'error', 'Product name is required', '{}'::jsonb);
      item_status := 'invalid';
    end if;
    if item.product_type is null or item.product_type not in ('weapon', 'ammunition', 'accessory') then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, item.id, 'productType', 'PRODUCT_TYPE_REQUIRED', 'error', 'Select a valid product type', '{}'::jsonb);
      item_status := 'invalid';
    end if;
    if item.quantity is null or item.quantity <= 0 then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, item.id, 'quantity', 'QUANTITY_INVALID', 'error', 'Quantity must be a positive integer', '{}'::jsonb);
      item_status := 'invalid';
    end if;
    if item.unit_price is not null and item.unit_price < 0 then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, item.id, 'unitPrice', 'UNIT_PRICE_NEGATIVE', 'error', 'Unit price cannot be negative', '{}'::jsonb);
      item_status := 'invalid';
    end if;
    if item.total_price is not null and item.total_price < 0 then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, item.id, 'totalPrice', 'TOTAL_PRICE_NEGATIVE', 'error', 'Total price cannot be negative', '{}'::jsonb);
      item_status := 'invalid';
    end if;

    if item.product_type = 'weapon' then
      if jsonb_array_length(item.serial_numbers_json) = 0 then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, item.id, 'serialNumbers', 'SERIAL_REQUIRED', 'error', 'Serialized weapons require serial numbers', '{}'::jsonb);
        item_status := 'invalid';
      elsif item.quantity is not null and jsonb_array_length(item.serial_numbers_json) <> item.quantity then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, item.id, 'serialNumbers', 'SERIAL_COUNT_MISMATCH', 'error', 'Serial count must equal weapon quantity', '{}'::jsonb);
        item_status := 'invalid';
      end if;
      if item.weapon_type_id is null or item.weapon_subtype_id is null or item.brand_id is null or item.model_id is null or item.caliber_id is null then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, item.id, null, 'MASTER_DATA_MAPPING_REQUIRED', 'warning', 'Complete all weapon classifications before inventory receipt', jsonb_build_object('scope', 'receipt', 'blocksReceipt', true));
      end if;
    end if;

    if item.storage_location_id is null then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, item.id, 'storageLocationId', 'LOCATION_REQUIRED', 'warning', 'Select a storage location before inventory receipt', jsonb_build_object('scope', 'receipt', 'blocksReceipt', true));
    end if;
    if item.unit_price is null or item.unit_price <= 0 then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, item.id, 'unitPrice', 'PURCHASE_PRICE_REQUIRED_FOR_RECEIPT', 'warning', 'A positive purchase price is required before inventory receipt', jsonb_build_object('scope', 'receipt', 'blocksReceipt', true));
    end if;

    for serial_value in select upper(regexp_replace(value, '\s+', '', 'g')) from jsonb_array_elements_text(item.serial_numbers_json)
    loop
      if (
        select count(*)
        from public.shipment_import_items as duplicate_item
        cross join lateral jsonb_array_elements_text(duplicate_item.serial_numbers_json) as serial(serial_value)
        where duplicate_item.import_id = p_import_id
          and upper(regexp_replace(serial.serial_value, '\s+', '', 'g')) = serial_value
      ) > 1 then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, item.id, 'serialNumbers', 'DUPLICATE_IN_MANIFEST', 'conflict', 'Serial ' || serial_value || ' appears more than once in this manifest', '{}'::jsonb);
        item_status := 'duplicate';
      elsif exists (
        select 1 from public.weapons as w
        where w.deleted_at is null and upper(regexp_replace(w.serial_number, '\s+', '', 'g')) = serial_value
      ) then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, item.id, 'serialNumbers', 'DUPLICATE_IN_INVENTORY', 'conflict', 'Serial ' || serial_value || ' already exists in inventory', '{}'::jsonb);
        item_status := 'conflict';
      elsif exists (
        select 1
        from public.shipment_import_items as pending_item
        join public.shipment_imports as pending_import on pending_import.id = pending_item.import_id
        cross join lateral jsonb_array_elements_text(pending_item.serial_numbers_json) as pending_serial(serial_value)
        where pending_item.import_id <> p_import_id
          and pending_import.status in ('processing', 'pending_review', 'scheduled', 'arrived')
          and upper(regexp_replace(pending_serial.serial_value, '\s+', '', 'g')) = serial_value
      ) then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, item.id, 'serialNumbers', 'DUPLICATE_IN_PENDING_SHIPMENT', 'conflict', 'Serial ' || serial_value || ' exists in another pending shipment', '{}'::jsonb);
        item_status := 'conflict';
      end if;
    end loop;

    update public.shipment_import_items as target
    set status = item_status, updated_at = now()
    where target.id = item.id;
  end loop;

  select jsonb_build_object(
    'valid', count(*) filter (where i.status = 'valid'),
    'needsReview', count(*) filter (where i.status = 'needs_review'),
    'invalid', count(*) filter (where i.status = 'invalid'),
    'duplicate', count(*) filter (where i.status = 'duplicate'),
    'conflict', count(*) filter (where i.status = 'conflict')
  ) into summary
  from public.shipment_import_items as i
  where i.import_id = p_import_id;

  update public.shipment_imports as target
  set validation_summary = summary, updated_at = now()
  where target.id = p_import_id;
end
$$;

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
      quantity, unit_price, total_price, currency, country_of_origin, weapon_type_id,
      weapon_subtype_id, brand_id, model_id, caliber_id, storage_location_id,
      confidence_json, source_json, raw_data_json, status
    ) values (
      coalesce(nullif(item ->> 'id', ''), gen_random_uuid()::text), import_id,
      (item ->> 'rowIndex')::integer, nullif(item ->> 'productType', ''),
      nullif(item ->> 'productName', ''), nullif(item ->> 'category', ''),
      nullif(item ->> 'weaponType', ''), nullif(item ->> 'manufacturer', ''),
      nullif(item ->> 'model', ''), nullif(item ->> 'caliber', ''), nullif(item ->> 'sku', ''),
      nullif(item ->> 'productCode', ''), nullif(item ->> 'serialNumber', ''),
      coalesce(item -> 'serialNumbers', '[]'::jsonb), nullif(item ->> 'quantity', '')::integer,
      nullif(item ->> 'unitPrice', '')::numeric, nullif(item ->> 'totalPrice', '')::numeric,
      upper(nullif(item ->> 'currency', '')), nullif(item ->> 'countryOfOrigin', ''),
      nullif(item ->> 'weaponTypeId', ''), nullif(item ->> 'weaponSubtypeId', ''),
      nullif(item ->> 'brandId', ''), nullif(item ->> 'modelId', ''),
      nullif(item ->> 'caliberId', ''), nullif(item ->> 'storageLocationId', ''),
      coalesce(item -> 'confidence', '{}'::jsonb), coalesce(item -> 'source', '{}'::jsonb),
      coalesce(item -> 'rawData', '{}'::jsonb), 'needs_review'
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

create or replace function public.apply_manifest_item_patch(p_import_id text, p_item_ids jsonb, p_patch jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  update public.shipment_import_items as item set
    product_type = case when p_patch ? 'productType' then nullif(p_patch ->> 'productType', '') else item.product_type end,
    product_name = case when p_patch ? 'productName' then nullif(p_patch ->> 'productName', '') else item.product_name end,
    category = case when p_patch ? 'category' then nullif(p_patch ->> 'category', '') else item.category end,
    weapon_type = case when p_patch ? 'weaponType' then nullif(p_patch ->> 'weaponType', '') else item.weapon_type end,
    manufacturer = case when p_patch ? 'manufacturer' then nullif(p_patch ->> 'manufacturer', '') else item.manufacturer end,
    model = case when p_patch ? 'model' then nullif(p_patch ->> 'model', '') else item.model end,
    caliber = case when p_patch ? 'caliber' then nullif(p_patch ->> 'caliber', '') else item.caliber end,
    sku = case when p_patch ? 'sku' then nullif(p_patch ->> 'sku', '') else item.sku end,
    product_code = case when p_patch ? 'productCode' then nullif(p_patch ->> 'productCode', '') else item.product_code end,
    serial_number = case when p_patch ? 'serialNumber' then nullif(p_patch ->> 'serialNumber', '') when p_patch ? 'serialNumbers' and jsonb_array_length(p_patch -> 'serialNumbers') = 1 then p_patch #>> '{serialNumbers,0}' else item.serial_number end,
    serial_numbers_json = case when p_patch ? 'serialNumbers' then coalesce(p_patch -> 'serialNumbers', '[]'::jsonb) else item.serial_numbers_json end,
    quantity = case when p_patch ? 'quantity' then nullif(p_patch ->> 'quantity', '')::integer else item.quantity end,
    unit_price = case when p_patch ? 'unitPrice' then nullif(p_patch ->> 'unitPrice', '')::numeric else item.unit_price end,
    total_price = case when p_patch ? 'totalPrice' then nullif(p_patch ->> 'totalPrice', '')::numeric else item.total_price end,
    currency = case when p_patch ? 'currency' then upper(nullif(p_patch ->> 'currency', '')) else item.currency end,
    country_of_origin = case when p_patch ? 'countryOfOrigin' then nullif(p_patch ->> 'countryOfOrigin', '') else item.country_of_origin end,
    weapon_type_id = case when p_patch ? 'weaponTypeId' then nullif(p_patch ->> 'weaponTypeId', '') else item.weapon_type_id end,
    weapon_subtype_id = case when p_patch ? 'weaponSubtypeId' then nullif(p_patch ->> 'weaponSubtypeId', '') else item.weapon_subtype_id end,
    brand_id = case when p_patch ? 'brandId' then nullif(p_patch ->> 'brandId', '') else item.brand_id end,
    model_id = case when p_patch ? 'modelId' then nullif(p_patch ->> 'modelId', '') else item.model_id end,
    caliber_id = case when p_patch ? 'caliberId' then nullif(p_patch ->> 'caliberId', '') else item.caliber_id end,
    storage_location_id = case when p_patch ? 'storageLocationId' then nullif(p_patch ->> 'storageLocationId', '') else item.storage_location_id end,
    updated_at = now()
  where item.import_id = p_import_id
    and item.id in (select value from jsonb_array_elements_text(p_item_ids));
  get diagnostics changed = row_count;
  return changed;
end
$$;

create or replace function public.update_manifest_items(p_import_id text, p_item_ids jsonb, p_patch jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; changed integer;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment edit permission is required'; end if;
  if not exists (select 1 from public.shipment_imports as i where i.id = p_import_id and i.status = 'pending_review') then raise exception using errcode = '23514', message = 'only manifests pending review can be edited'; end if;
  if jsonb_typeof(p_item_ids) <> 'array' or jsonb_array_length(p_item_ids) < 1 or jsonb_array_length(p_item_ids) > 2000 then raise exception using errcode = '22023', message = 'select between 1 and 2000 manifest items'; end if;
  changed := public.apply_manifest_item_patch(p_import_id, p_item_ids, p_patch);
  if changed = 0 then raise exception using errcode = 'P0002', message = 'manifest item not found'; end if;
  perform public.validate_manifest_import(p_import_id);
  actor_id := public.current_app_user_id();
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (public.next_business_id('LOG'), now(), current_date, actor_id, 'Shipment', 'Manifest items updated during review', jsonb_build_object('importId', p_import_id, 'itemCount', changed, 'fields', (select jsonb_agg(key) from jsonb_object_keys(p_patch) as key)));
end $$;

create or replace function public.update_manifest_details(p_import_id text, p_patch jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment edit permission is required'; end if;
  update public.shipment_imports as item set
    shipment_number = case when p_patch ? 'shipmentNumber' then nullif(p_patch ->> 'shipmentNumber', '') else item.shipment_number end,
    supplier_id = case when p_patch ? 'supplierId' then nullif(p_patch ->> 'supplierId', '') else item.supplier_id end,
    supplier_name = case when p_patch ? 'supplierName' then nullif(p_patch ->> 'supplierName', '') else item.supplier_name end,
    supplier_reference = case when p_patch ? 'supplierReference' then nullif(p_patch ->> 'supplierReference', '') else item.supplier_reference end,
    invoice_number = case when p_patch ? 'invoiceNumber' then nullif(p_patch ->> 'invoiceNumber', '') else item.invoice_number end,
    manifest_number = case when p_patch ? 'manifestNumber' then nullif(p_patch ->> 'manifestNumber', '') else item.manifest_number end,
    shipment_date = case when p_patch ? 'shipmentDate' then nullif(p_patch ->> 'shipmentDate', '')::date else item.shipment_date end,
    expected_arrival_date = case when p_patch ? 'expectedArrivalDate' then nullif(p_patch ->> 'expectedArrivalDate', '')::date else item.expected_arrival_date end,
    origin = case when p_patch ? 'origin' then nullif(p_patch ->> 'origin', '') else item.origin end,
    destination = case when p_patch ? 'destination' then nullif(p_patch ->> 'destination', '') else item.destination end,
    currency = case when p_patch ? 'currency' then upper(nullif(p_patch ->> 'currency', '')) else item.currency end,
    review_note = case when p_patch ? 'reviewNote' then nullif(p_patch ->> 'reviewNote', '') else item.review_note end,
    updated_at = now()
  where item.id = p_import_id and item.status = 'pending_review';
  if not found then raise exception using errcode = '23514', message = 'only manifests pending review can be edited'; end if;
end $$;

create or replace function public.delete_manifest_review(p_import_id text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; review record;
begin
  if not public.is_app_admin() and not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment cancel permission is required'; end if;
  select i.id, i.file_name, i.file_hash, i.shipment_id, i.status into review from public.shipment_imports as i where i.id = p_import_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'manifest review not found'; end if;
  if review.shipment_id is not null or review.status not in ('pending_review', 'failed', 'cancelled') then raise exception using errcode = '23514', message = 'only unconfirmed manifest reviews can be deleted'; end if;
  actor_id := public.current_app_user_id();
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (public.next_business_id('LOG'), now(), current_date, actor_id, 'Shipment', 'Unconfirmed manifest review deleted - ' || review.file_name, jsonb_build_object('importId', review.id, 'fileHash', review.file_hash));
  delete from public.shipment_imports as i where i.id = p_import_id;
end $$;

create or replace function public.manifest_bulk_input(p_import_id text, p_confirmation jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shipment', jsonb_build_object(
      'shipmentNumber', btrim(p_confirmation ->> 'shipmentNumber'),
      'supplierId', p_confirmation ->> 'supplierId',
      'shipmentDate', p_confirmation ->> 'shipmentDate',
      'expectedArrivalDate', coalesce(nullif(p_confirmation ->> 'expectedArrivalDate', ''), p_confirmation ->> 'shipmentDate'),
      'attachments', '[]'::jsonb,
      'notes', coalesce(p_confirmation ->> 'note', ''),
      'purchaseOrderNumber', nullif(p_confirmation ->> 'supplierReference', ''),
      'invoiceNumber', nullif(p_confirmation ->> 'invoiceNumber', ''),
      'currency', upper(p_confirmation ->> 'currency'),
      'actualArrivalDate', case when p_confirmation ->> 'arrival' = 'arrived_now' then current_date::text else null end
    ),
    'lineItems', coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id, 'productType', item.product_type,
      'weaponTypeId', item.weapon_type_id, 'weaponSubtypeId', item.weapon_subtype_id,
      'caliberId', item.caliber_id, 'brandId', item.brand_id, 'modelId', item.model_id,
      'storageLocationId', item.storage_location_id, 'quantity', item.quantity,
      'purchasePrice', item.unit_price, 'retailPrice', 0, 'wholesalePrice', 0,
      'serialNumbers', item.serial_numbers_json, 'currency', coalesce(item.currency, upper(p_confirmation ->> 'currency')),
      'weaponTypeLabel', item.weapon_type, 'subTypeLabel', item.category,
      'caliberLabel', item.caliber, 'brandLabel', item.manufacturer,
      'modelLabel', coalesce(item.model, item.product_name),
      'location', jsonb_build_object('warehouse', warehouse.label, 'shelf', location.shelf, 'bin', location.bin),
      'additionalCosts', '[]'::jsonb
    ) order by item.row_index), '[]'::jsonb),
    'additionalCosts', '[]'::jsonb
  )
  from public.shipment_import_items as item
  left join public.storage_locations as location on location.id = item.storage_location_id
  left join public.warehouses as warehouse on warehouse.id = location.warehouse_id
  where item.import_id = p_import_id
$$;

create or replace function public.confirm_manifest_review(p_confirmation jsonb)
returns text language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; import_row record; shipment_id text; bulk_input jsonb; target_status text;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment review permission is required'; end if;
  select i.id, i.status, i.validation_summary into import_row from public.shipment_imports as i where i.id = p_confirmation ->> 'importId' for update;
  if not found or import_row.status <> 'pending_review' then raise exception using errcode = '23514', message = 'manifest is not pending review'; end if;
  if nullif(btrim(p_confirmation ->> 'shipmentNumber'), '') is null then raise exception using errcode = '22023', message = 'shipment number is required'; end if;
  if not exists (select 1 from public.suppliers as s where s.id = p_confirmation ->> 'supplierId') then raise exception using errcode = '23503', message = 'supplier not found'; end if;
  if exists (select 1 from public.shipments as s where s.shipment_number = btrim(p_confirmation ->> 'shipmentNumber')) then raise exception using errcode = '23505', message = 'shipment number already exists'; end if;
  if coalesce((import_row.validation_summary ->> 'invalid')::integer, 0) + coalesce((import_row.validation_summary ->> 'duplicate')::integer, 0) + coalesce((import_row.validation_summary ->> 'conflict')::integer, 0) > 0 then raise exception using errcode = '23514', message = 'resolve invalid, duplicate, and conflicting items before confirmation'; end if;
  if p_confirmation ->> 'arrival' not in ('future', 'arrived_now') then raise exception using errcode = '22023', message = 'invalid arrival mode'; end if;
  if p_confirmation ->> 'arrival' = 'arrived_now' and exists (
    select 1 from public.shipment_import_items as item where item.import_id = import_row.id
      and (item.unit_price is null or item.unit_price <= 0 or item.storage_location_id is null
        or (item.product_type = 'weapon' and (item.weapon_type_id is null or item.weapon_subtype_id is null or item.brand_id is null or item.model_id is null or item.caliber_id is null)))
  ) then raise exception using errcode = '23514', message = 'complete purchase price, location, and weapon classifications before inventory receipt'; end if;
  perform public.currency_snapshot(upper(p_confirmation ->> 'currency'));
  actor_id := public.current_app_user_id();
  bulk_input := public.manifest_bulk_input(import_row.id, p_confirmation);
  if p_confirmation ->> 'arrival' = 'arrived_now' then
    update public.shipment_imports as i set status = 'arrived' where i.id = import_row.id;
    shipment_id := public.bulk_create_shipment(bulk_input);
    update public.shipment_imports as i set status = 'received', shipment_id = shipment_id, shipment_number = btrim(p_confirmation ->> 'shipmentNumber'), supplier_id = p_confirmation ->> 'supplierId', supplier_reference = nullif(p_confirmation ->> 'supplierReference', ''), invoice_number = nullif(p_confirmation ->> 'invoiceNumber', ''), manifest_number = nullif(p_confirmation ->> 'manifestNumber', ''), shipment_date = (p_confirmation ->> 'shipmentDate')::date, expected_arrival_date = nullif(p_confirmation ->> 'expectedArrivalDate', '')::date, origin = nullif(p_confirmation ->> 'origin', ''), destination = nullif(p_confirmation ->> 'destination', ''), currency = upper(p_confirmation ->> 'currency'), reviewed_at = now(), confirmed_at = now(), updated_at = now() where i.id = import_row.id;
    update public.shipments as s set import_id = import_row.id, workflow_status = 'received' where s.id = shipment_id;
    target_status := 'received';
  else
    shipment_id := public.create_shipment((bulk_input -> 'shipment') || jsonb_build_object('totalExpectedItems', (select coalesce(sum(i.quantity), 0) from public.shipment_import_items as i where i.import_id = import_row.id), 'lineItems', bulk_input -> 'lineItems'));
    update public.shipment_imports as i set status = 'scheduled', shipment_id = shipment_id, shipment_number = btrim(p_confirmation ->> 'shipmentNumber'), supplier_id = p_confirmation ->> 'supplierId', supplier_reference = nullif(p_confirmation ->> 'supplierReference', ''), invoice_number = nullif(p_confirmation ->> 'invoiceNumber', ''), manifest_number = nullif(p_confirmation ->> 'manifestNumber', ''), shipment_date = (p_confirmation ->> 'shipmentDate')::date, expected_arrival_date = (p_confirmation ->> 'expectedArrivalDate')::date, origin = nullif(p_confirmation ->> 'origin', ''), destination = nullif(p_confirmation ->> 'destination', ''), currency = upper(p_confirmation ->> 'currency'), reviewed_at = now(), confirmed_at = now(), updated_at = now() where i.id = import_row.id;
    update public.shipments as s set import_id = import_row.id, workflow_status = 'scheduled' where s.id = shipment_id;
    target_status := 'scheduled';
  end if;
  insert into public.shipment_status_history (id, import_id, shipment_id, from_status, to_status, note, changed_by)
  values (gen_random_uuid()::text, import_row.id, shipment_id, 'pending_review', target_status, coalesce(p_confirmation ->> 'note', ''), actor_id);
  return shipment_id;
end $$;

create or replace function public.confirm_manifest_arrival(p_import_id text)
returns text language plpgsql volatile security definer set search_path = public, auth as $$
declare import_row record; old_shipment record; actor_id text; confirmation jsonb; bulk_input jsonb; new_shipment_id text;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment receive permission is required'; end if;
  select i.id, i.status, i.shipment_id, i.shipment_number, i.supplier_id, i.supplier_reference, i.invoice_number, i.manifest_number, i.shipment_date, i.expected_arrival_date, i.origin, i.destination, i.currency into import_row from public.shipment_imports as i where i.id = p_import_id for update;
  if not found or import_row.status <> 'scheduled' or import_row.shipment_id is null then raise exception using errcode = '23514', message = 'shipment is not scheduled for arrival'; end if;
  if exists (select 1 from public.shipment_import_items as item where item.import_id = p_import_id and (item.unit_price is null or item.unit_price <= 0 or item.storage_location_id is null or (item.product_type = 'weapon' and (item.weapon_type_id is null or item.weapon_subtype_id is null or item.brand_id is null or item.model_id is null or item.caliber_id is null)))) then raise exception using errcode = '23514', message = 'complete purchase price, location, and weapon classifications before inventory receipt'; end if;
  select s.id, s.notes into old_shipment from public.shipments as s where s.id = import_row.shipment_id for update;
  confirmation := jsonb_build_object('importId', p_import_id, 'shipmentNumber', import_row.shipment_number, 'supplierId', import_row.supplier_id, 'supplierReference', import_row.supplier_reference, 'invoiceNumber', import_row.invoice_number, 'manifestNumber', import_row.manifest_number, 'shipmentDate', import_row.shipment_date, 'expectedArrivalDate', import_row.expected_arrival_date, 'origin', import_row.origin, 'destination', import_row.destination, 'currency', import_row.currency, 'arrival', 'arrived_now', 'note', old_shipment.notes);
  bulk_input := public.manifest_bulk_input(p_import_id, confirmation);
  actor_id := public.current_app_user_id();
  update public.shipment_imports as i set status = 'arrived' where i.id = p_import_id;
  delete from public.shipments as s where s.id = old_shipment.id;
  new_shipment_id := public.bulk_create_shipment(bulk_input);
  update public.shipment_imports as i set status = 'received', shipment_id = new_shipment_id, updated_at = now() where i.id = p_import_id;
  update public.shipments as s set import_id = p_import_id, workflow_status = 'received' where s.id = new_shipment_id;
  insert into public.shipment_status_history (id, import_id, shipment_id, from_status, to_status, note, changed_by) values (gen_random_uuid()::text, p_import_id, new_shipment_id, 'scheduled', 'received', 'Shipment arrival confirmed', actor_id);
  return new_shipment_id;
end $$;

create or replace function public.reschedule_manifest(p_import_id text, p_expected_arrival_date date, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; row_data record;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment reschedule permission is required'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception using errcode = '22023', message = 'a delay reason is required'; end if;
  select i.status, i.shipment_id into row_data from public.shipment_imports as i where i.id = p_import_id for update;
  if not found or row_data.status not in ('scheduled', 'arrived') then raise exception using errcode = '23514', message = 'only scheduled or arrived shipments can be rescheduled'; end if;
  actor_id := public.current_app_user_id();
  update public.shipment_imports as i set status = 'scheduled', expected_arrival_date = p_expected_arrival_date, updated_at = now() where i.id = p_import_id;
  update public.shipments as s set expected_arrival_date = p_expected_arrival_date, workflow_status = 'scheduled', status = 'Delayed', delay_reason = btrim(p_reason), last_arrival_prompt_at = null where s.id = row_data.shipment_id;
  insert into public.shipment_status_history (id, import_id, shipment_id, from_status, to_status, note, changed_by) values (gen_random_uuid()::text, p_import_id, row_data.shipment_id, row_data.status, 'scheduled', btrim(p_reason), actor_id);
end $$;

create or replace function public.cancel_manifest(p_import_id text, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; row_data record;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment cancel permission is required'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception using errcode = '22023', message = 'a cancellation reason is required'; end if;
  select i.status, i.shipment_id into row_data from public.shipment_imports as i where i.id = p_import_id for update;
  if not found or row_data.status in ('received', 'cancelled') then raise exception using errcode = '23514', message = 'this shipment can no longer be cancelled'; end if;
  actor_id := public.current_app_user_id();
  update public.shipment_imports as i set status = 'cancelled', updated_at = now() where i.id = p_import_id;
  update public.shipments as s set workflow_status = 'cancelled', status = 'Cancelled', arrival_note = btrim(p_reason) where s.id = row_data.shipment_id;
  insert into public.shipment_status_history (id, import_id, shipment_id, from_status, to_status, note, changed_by) values (gen_random_uuid()::text, p_import_id, row_data.shipment_id, row_data.status, 'cancelled', btrim(p_reason), actor_id);
end $$;

revoke all on function public.validate_manifest_import(text) from public, anon, authenticated;
revoke all on function public.apply_manifest_item_patch(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.manifest_bulk_input(text, jsonb) from public, anon, authenticated;
revoke all on function public.create_manifest_review(jsonb) from public, anon;
revoke all on function public.update_manifest_items(text, jsonb, jsonb) from public, anon;
revoke all on function public.update_manifest_details(text, jsonb) from public, anon;
revoke all on function public.delete_manifest_review(text) from public, anon;
revoke all on function public.confirm_manifest_review(jsonb) from public, anon;
revoke all on function public.confirm_manifest_arrival(text) from public, anon;
revoke all on function public.reschedule_manifest(text, date, text) from public, anon;
revoke all on function public.cancel_manifest(text, text) from public, anon;
grant execute on function public.create_manifest_review(jsonb) to authenticated;
grant execute on function public.update_manifest_items(text, jsonb, jsonb) to authenticated;
grant execute on function public.update_manifest_details(text, jsonb) to authenticated;
grant execute on function public.delete_manifest_review(text) to authenticated;
grant execute on function public.confirm_manifest_review(jsonb) to authenticated;
grant execute on function public.confirm_manifest_arrival(text) to authenticated;
grant execute on function public.reschedule_manifest(text, date, text) to authenticated;
grant execute on function public.cancel_manifest(text, text) to authenticated;

commit;
