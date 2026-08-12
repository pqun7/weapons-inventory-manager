begin;

alter table public.shipment_import_items
  add column if not exists retail_price numeric(20, 4),
  add column if not exists wholesale_price numeric(20, 4),
  add column if not exists retail_price_mode text not null default 'auto'
    check (retail_price_mode in ('auto', 'manual')),
  add column if not exists wholesale_price_mode text not null default 'auto'
    check (wholesale_price_mode in ('auto', 'manual')),
  add column if not exists additional_costs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(additional_costs) = 'array');

create or replace function public.apply_manifest_item_patch(p_import_id text, p_item_ids jsonb, p_patch jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare changed integer;
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
    retail_price = case when p_patch ? 'retailPrice' then nullif(p_patch ->> 'retailPrice', '')::numeric else item.retail_price end,
    wholesale_price = case when p_patch ? 'wholesalePrice' then nullif(p_patch ->> 'wholesalePrice', '')::numeric else item.wholesale_price end,
    retail_price_mode = case when p_patch ? 'retailPriceMode' then p_patch ->> 'retailPriceMode' else item.retail_price_mode end,
    wholesale_price_mode = case when p_patch ? 'wholesalePriceMode' then p_patch ->> 'wholesalePriceMode' else item.wholesale_price_mode end,
    additional_costs = case when p_patch ? 'additionalCosts' then coalesce(p_patch -> 'additionalCosts', '[]'::jsonb) else item.additional_costs end,
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

create or replace function public.manifest_bulk_input(p_import_id text, p_confirmation jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shipment', jsonb_build_object(
      'shipmentNumber', btrim(p_confirmation ->> 'shipmentNumber'), 'supplierId', p_confirmation ->> 'supplierId',
      'shipmentDate', p_confirmation ->> 'shipmentDate',
      'expectedArrivalDate', coalesce(nullif(p_confirmation ->> 'expectedArrivalDate', ''), p_confirmation ->> 'shipmentDate'),
      'attachments', '[]'::jsonb, 'notes', coalesce(p_confirmation ->> 'note', ''),
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
      'purchasePrice', item.unit_price,
      'retailPrice', coalesce(item.retail_price, item.unit_price),
      'wholesalePrice', coalesce(item.wholesale_price, item.unit_price),
      'retailPriceMode', item.retail_price_mode, 'wholesalePriceMode', item.wholesale_price_mode,
      'serialNumbers', item.serial_numbers_json,
      'currency', coalesce(item.currency, upper(p_confirmation ->> 'currency')),
      'weaponTypeLabel', item.weapon_type, 'subTypeLabel', item.category,
      'caliberLabel', item.caliber, 'brandLabel', item.manufacturer,
      'modelLabel', coalesce(item.model, item.product_name),
      'location', jsonb_build_object('warehouse', warehouse.label, 'shelf', location.shelf, 'bin', location.bin),
      'additionalCosts', item.additional_costs
    ) order by item.row_index), '[]'::jsonb),
    'additionalCosts', '[]'::jsonb
  )
  from public.shipment_import_items as item
  left join public.storage_locations as location on location.id = item.storage_location_id
  left join public.warehouses as warehouse on warehouse.id = location.warehouse_id
  where item.import_id = p_import_id
$$;

-- Keep the shipment transaction as the single writer, but pass the complete
-- pricing contract to create_inventory_product for non-weapon products.
do $patch$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.bulk_create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(definition,
    $old$'safety_threshold', 5, 'price', (line ->> 'retailPrice')::numeric,$old$,
    $new$'safety_threshold', 5, 'price', (line ->> 'purchasePrice')::numeric,
        'retail_price', (line ->> 'retailPrice')::numeric, 'wholesale_price', (line ->> 'wholesalePrice')::numeric,
        'retail_price_mode', coalesce(line ->> 'retailPriceMode', 'auto'), 'wholesale_price_mode', coalesce(line ->> 'wholesalePriceMode', 'auto'),$new$);
  patched := replace(patched,
    $old$'price', (line ->> 'retailPrice')::numeric, 'price_currency', item_currency,$old$,
    $new$'price', (line ->> 'purchasePrice')::numeric, 'retail_price', (line ->> 'retailPrice')::numeric,
        'wholesale_price', (line ->> 'wholesalePrice')::numeric,
        'retail_price_mode', coalesce(line ->> 'retailPriceMode', 'auto'), 'wholesale_price_mode', coalesce(line ->> 'wholesalePriceMode', 'auto'),
        'price_currency', item_currency,$new$);
  if patched = definition then
    raise exception 'bulk_create_shipment pricing patch did not match the installed function';
  end if;
  execute patched;
end
$patch$;

commit;
