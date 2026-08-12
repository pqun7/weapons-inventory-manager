begin;

alter table public.shipment_imports
  add column if not exists additional_costs jsonb not null default '[]'::jsonb
  check (jsonb_typeof(additional_costs) = 'array');

alter table public.shipments
  add column if not exists planned_costs jsonb not null default '[]'::jsonb
  check (jsonb_typeof(planned_costs) = 'array');

create or replace function public.update_manifest_details(p_import_id text, p_patch jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment edit permission is required'; end if;
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
  where target.id = p_import_id and target.status = 'pending_review';
  if not found then raise exception using errcode = '23514', message = 'only manifests pending review can be edited'; end if;
end $$;

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
      'purchasePrice', item.unit_price, 'retailPrice', coalesce(item.retail_price, item.unit_price),
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
    'additionalCosts', manifest.additional_costs
  )
  from public.shipment_imports as manifest
  left join public.shipment_import_items as item on item.import_id = manifest.id
  left join public.storage_locations as location on location.id = item.storage_location_id
  left join public.warehouses as warehouse on warehouse.id = location.warehouse_id
  where manifest.id = p_import_id
  group by manifest.id, manifest.additional_costs
$$;

-- Root cause fix: the installed function declares a local shipment_id while
-- querying weapons.shipment_id. Qualify the local reference unambiguously.
do $patch$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.bulk_create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(definition, 'where w.shipment_id = shipment_id', 'where w.shipment_id = bulk_create_shipment.shipment_id');
  patched := replace(patched, 'where s.id = shipment_id;', 'where s.id = bulk_create_shipment.shipment_id;');
  if patched = definition then raise exception 'bulk_create_shipment shipment_id fix did not match'; end if;
  execute patched;
end
$patch$;

-- The confirmation RPC had the same column/local-variable collision in
-- `set shipment_id = shipment_id`. Rename only the local variable references.
do $patch$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.confirm_manifest_review(jsonb)'::regprocedure) into definition;
  patched := replace(definition, 'shipment_id text;', 'confirmed_shipment_id text;');
  patched := replace(patched, 'shipment_id := public.bulk_create_shipment', 'confirmed_shipment_id := public.bulk_create_shipment');
  patched := replace(patched, 'shipment_id := public.create_shipment', 'confirmed_shipment_id := public.create_shipment');
  patched := replace(patched, 'shipment_id = shipment_id,', 'shipment_id = confirmed_shipment_id,');
  patched := replace(patched, 'where s.id = shipment_id;', 'where s.id = confirmed_shipment_id;');
  patched := replace(patched, 'import_row.id, shipment_id,', 'import_row.id, confirmed_shipment_id,');
  patched := replace(patched, 'return shipment_id;', 'return confirmed_shipment_id;');
  if patched = definition then raise exception 'confirm_manifest_review shipment_id fix did not match'; end if;
  execute patched;
end
$patch$;

-- Scheduled shipments keep their products and shipment costs without touching
-- inventory. The same payload can be used later when the shipment arrives.
do $patch$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(definition,
    'actual_arrival_date, line_items, documents, workflow_status',
    'actual_arrival_date, line_items, documents, planned_costs, workflow_status');
  patched := replace(patched,
    $$coalesce(p_input ->> 'notes', ''), 'Pending',$$,
    $$coalesce(p_input ->> 'notes', ''), coalesce(nullif(p_input ->> 'status', ''), 'Pending'),$$);
  patched := replace(patched,
    $$'status', 'Pending',$$,
    $$'status', coalesce(nullif(p_input ->> 'status', ''), 'Pending'),$$);
  patched := replace(patched,
    $$coalesce(p_input -> 'lineItems', '[]'::jsonb),
    '[]'::jsonb, 'draft'$$,
    $$coalesce(p_input -> 'lineItems', '[]'::jsonb),
    '[]'::jsonb, coalesce(p_input -> 'additionalCosts', '[]'::jsonb), 'scheduled'$$);
  if patched = definition then raise exception 'create_shipment scheduled payload patch did not match'; end if;
  execute patched;
end
$patch$;

commit;
