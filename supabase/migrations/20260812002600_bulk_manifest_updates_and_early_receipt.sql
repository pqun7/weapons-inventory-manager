begin;

-- One request and one validation pass for any number of row-specific edits.
create or replace function public.bulk_update_manifest_items(p_import_id text, p_updates jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  update_entry jsonb;
  changed integer;
  changed_total integer := 0;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment edit permission is required';
  end if;
  if not exists (
    select 1 from public.shipment_imports as manifest
    where manifest.id = p_import_id
      and manifest.status = 'pending_review'
      and manifest.shipment_id is null
  ) then
    raise exception using errcode = '23514', message = 'only an unconfirmed manifest review can be edited';
  end if;
  if jsonb_typeof(p_updates) <> 'array'
    or jsonb_array_length(p_updates) < 1
    or jsonb_array_length(p_updates) > 2000
  then
    raise exception using errcode = '22023', message = 'submit between 1 and 2000 manifest item updates';
  end if;

  for update_entry in select value from jsonb_array_elements(p_updates)
  loop
    if nullif(update_entry ->> 'itemId', '') is null
      or jsonb_typeof(update_entry -> 'patch') <> 'object'
    then
      raise exception using errcode = '22023', message = 'each manifest update requires itemId and patch';
    end if;
    changed := public.apply_manifest_item_patch(
      p_import_id,
      jsonb_build_array(update_entry ->> 'itemId'),
      update_entry -> 'patch'
    );
    if changed <> 1 then
      raise exception using errcode = 'P0002', message = 'manifest item not found: ' || (update_entry ->> 'itemId');
    end if;
    changed_total := changed_total + changed;
  end loop;

  perform public.validate_manifest_import(p_import_id);
  actor_id := public.current_app_user_id();
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (
    public.next_business_id('LOG'), now(), current_date, actor_id, 'Shipment',
    'Manifest items updated in one bulk operation',
    jsonb_build_object('importId', p_import_id, 'itemCount', changed_total)
  );
end
$$;

-- Receipt is allowed before the expected date. Preserve the shipment identity
-- and move the manifest through both legal states instead of skipping directly
-- from scheduled to received.
create or replace function public.receive_scheduled_shipment(p_shipment_id text)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  scheduled_row public.shipments%rowtype;
  receipt_input jsonb;
  received_shipment_id text;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment receive permission is required';
  end if;

  select s.* into scheduled_row
  from public.shipments as s
  where s.id = p_shipment_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'shipment not found'; end if;
  if scheduled_row.workflow_status = 'received' or scheduled_row.status = 'Arrived' then
    raise exception using errcode = '23514', message = 'shipment has already been received';
  end if;
  if scheduled_row.status = 'Cancelled' then
    raise exception using errcode = '23514', message = 'cancelled shipment cannot be received';
  end if;
  if jsonb_typeof(scheduled_row.line_items) <> 'array' or jsonb_array_length(scheduled_row.line_items) = 0 then
    raise exception using errcode = '23514', message = 'shipment has no saved line items to receive';
  end if;

  receipt_input := jsonb_build_object(
    'shipment', jsonb_build_object(
      'id', scheduled_row.id,
      'shipmentNumber', scheduled_row.shipment_number,
      'supplierId', scheduled_row.supplier_id,
      'shipmentDate', scheduled_row.shipment_date,
      'expectedArrivalDate', scheduled_row.expected_arrival_date,
      'actualArrivalDate', current_date,
      'attachments', scheduled_row.attachments,
      'notes', scheduled_row.notes,
      'purchaseOrderNumber', scheduled_row.purchase_order_number,
      'invoiceNumber', scheduled_row.invoice_number,
      'shippingCarrier', scheduled_row.shipping_carrier,
      'containerNumber', scheduled_row.container_number,
      'currency', scheduled_row.currency,
      'purchaseDate', scheduled_row.purchase_date
    ),
    'lineItems', scheduled_row.line_items,
    'additionalCosts', scheduled_row.planned_costs
  );

  if scheduled_row.import_id is not null then
    update public.shipment_imports as manifest
    set status = 'arrived', updated_at = now()
    where manifest.id = scheduled_row.import_id;
  end if;
  delete from public.shipments as shipment where shipment.id = scheduled_row.id;
  received_shipment_id := public.bulk_create_shipment(receipt_input);
  update public.shipments as shipment
  set timeline = scheduled_row.timeline || shipment.timeline,
      documents = scheduled_row.documents,
      import_id = scheduled_row.import_id,
      workflow_status = 'received',
      actual_arrival_date = current_date
  where shipment.id = received_shipment_id;
  if scheduled_row.import_id is not null then
    update public.shipment_imports as manifest
    set status = 'received', shipment_id = received_shipment_id, updated_at = now()
    where manifest.id = scheduled_row.import_id;
  end if;
  update public.app_notifications as notification
  set is_read = true
  where notification.entity_id = p_shipment_id
    and notification.type in ('ShipmentArrivalDue', 'ShipmentDelayed');
  return received_shipment_id;
end
$$;

revoke all on function public.bulk_update_manifest_items(text, jsonb) from public, anon;
revoke all on function public.receive_scheduled_shipment(text) from public, anon;
grant execute on function public.bulk_update_manifest_items(text, jsonb) to authenticated;
grant execute on function public.receive_scheduled_shipment(text) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
