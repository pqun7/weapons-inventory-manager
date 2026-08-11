begin;

create or replace function public.validate_manifest_import(p_import_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  manifest_item record;
  normalized_serial text;
  item_status text;
  computed_summary jsonb;
begin
  delete from public.shipment_validation_issues as issue
  where issue.import_id = p_import_id;

  for manifest_item in
    select i.id, i.product_type, i.product_name, i.weapon_type, i.manufacturer, i.model,
           i.caliber, i.sku, i.serial_numbers_json, i.quantity, i.unit_price,
           i.total_price, i.storage_location_id, i.weapon_type_id, i.weapon_subtype_id,
           i.brand_id, i.model_id, i.caliber_id
    from public.shipment_import_items as i
    where i.import_id = p_import_id
    order by i.row_index
  loop
    item_status := 'valid';

    if nullif(btrim(manifest_item.product_name), '') is null then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'productName', 'PRODUCT_REQUIRED', 'error', 'Product name is required', '{}'::jsonb);
      item_status := 'invalid';
    end if;
    if manifest_item.product_type is null or manifest_item.product_type not in ('weapon', 'ammunition', 'accessory') then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'productType', 'PRODUCT_TYPE_REQUIRED', 'error', 'Select a valid product type', '{}'::jsonb);
      item_status := 'invalid';
    end if;
    if manifest_item.quantity is null or manifest_item.quantity <= 0 then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'quantity', 'QUANTITY_INVALID', 'error', 'Quantity must be a positive integer', '{}'::jsonb);
      item_status := 'invalid';
    end if;
    if manifest_item.unit_price is not null and manifest_item.unit_price < 0 then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'unitPrice', 'UNIT_PRICE_NEGATIVE', 'error', 'Unit price cannot be negative', '{}'::jsonb);
      item_status := 'invalid';
    end if;
    if manifest_item.total_price is not null and manifest_item.total_price < 0 then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'totalPrice', 'TOTAL_PRICE_NEGATIVE', 'error', 'Total price cannot be negative', '{}'::jsonb);
      item_status := 'invalid';
    end if;

    if manifest_item.product_type = 'weapon' then
      if jsonb_array_length(manifest_item.serial_numbers_json) = 0 then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'serialNumbers', 'SERIAL_REQUIRED', 'error', 'Serialized weapons require serial numbers', '{}'::jsonb);
        item_status := 'invalid';
      elsif manifest_item.quantity is not null and jsonb_array_length(manifest_item.serial_numbers_json) <> manifest_item.quantity then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'serialNumbers', 'SERIAL_COUNT_MISMATCH', 'error', 'Serial count must equal weapon quantity', '{}'::jsonb);
        item_status := 'invalid';
      end if;
      if manifest_item.weapon_type_id is null or manifest_item.weapon_subtype_id is null or manifest_item.brand_id is null or manifest_item.model_id is null or manifest_item.caliber_id is null then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, manifest_item.id, null, 'MASTER_DATA_MAPPING_REQUIRED', 'warning', 'Complete all weapon classifications before inventory receipt', jsonb_build_object('scope', 'receipt', 'blocksReceipt', true));
      end if;
    end if;

    if manifest_item.storage_location_id is null then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'storageLocationId', 'LOCATION_REQUIRED', 'warning', 'Select a storage location before inventory receipt', jsonb_build_object('scope', 'receipt', 'blocksReceipt', true));
    end if;
    if manifest_item.unit_price is null or manifest_item.unit_price <= 0 then
      insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
      values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'unitPrice', 'PURCHASE_PRICE_REQUIRED_FOR_RECEIPT', 'warning', 'A positive purchase price is required before inventory receipt', jsonb_build_object('scope', 'receipt', 'blocksReceipt', true));
    end if;

    for normalized_serial in
      select upper(regexp_replace(serial_entry.serial_text, '\s+', '', 'g'))
      from jsonb_array_elements_text(manifest_item.serial_numbers_json) as serial_entry(serial_text)
    loop
      if (
        select count(*)
        from public.shipment_import_items as duplicate_item
        cross join lateral jsonb_array_elements_text(duplicate_item.serial_numbers_json) as duplicate_serial(serial_text)
        where duplicate_item.import_id = p_import_id
          and upper(regexp_replace(duplicate_serial.serial_text, '\s+', '', 'g')) = normalized_serial
      ) > 1 then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'serialNumbers', 'DUPLICATE_IN_MANIFEST', 'conflict', 'Serial ' || normalized_serial || ' appears more than once in this manifest', '{}'::jsonb);
        item_status := 'duplicate';
      elsif exists (
        select 1
        from public.weapons as w
        where w.deleted_at is null
          and upper(regexp_replace(w.serial_number, '\s+', '', 'g')) = normalized_serial
      ) then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'serialNumbers', 'DUPLICATE_IN_INVENTORY', 'conflict', 'Serial ' || normalized_serial || ' already exists in inventory', '{}'::jsonb);
        item_status := 'conflict';
      elsif exists (
        select 1
        from public.shipment_import_items as pending_item
        join public.shipment_imports as pending_import on pending_import.id = pending_item.import_id
        cross join lateral jsonb_array_elements_text(pending_item.serial_numbers_json) as pending_serial(serial_text)
        where pending_item.import_id <> p_import_id
          and pending_import.status in ('processing', 'pending_review', 'scheduled', 'arrived')
          and upper(regexp_replace(pending_serial.serial_text, '\s+', '', 'g')) = normalized_serial
      ) then
        insert into public.shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json)
        values (gen_random_uuid()::text, p_import_id, manifest_item.id, 'serialNumbers', 'DUPLICATE_IN_PENDING_SHIPMENT', 'conflict', 'Serial ' || normalized_serial || ' exists in another pending shipment', '{}'::jsonb);
        item_status := 'conflict';
      end if;
    end loop;

    update public.shipment_import_items as target
    set status = item_status, updated_at = now()
    where target.id = manifest_item.id;
  end loop;

  select jsonb_build_object(
    'valid', count(*) filter (where i.status = 'valid'),
    'needsReview', count(*) filter (where i.status = 'needs_review'),
    'invalid', count(*) filter (where i.status = 'invalid'),
    'duplicate', count(*) filter (where i.status = 'duplicate'),
    'conflict', count(*) filter (where i.status = 'conflict')
  )
  into computed_summary
  from public.shipment_import_items as i
  where i.import_id = p_import_id;

  update public.shipment_imports as target
  set validation_summary = computed_summary, updated_at = now()
  where target.id = p_import_id;
end
$$;

commit;
