begin;

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

  if not found then
    raise exception using errcode = 'P0002', message = 'shipment not found';
  end if;
  if scheduled_row.workflow_status = 'received' or scheduled_row.status = 'Arrived' then
    raise exception using errcode = '23514', message = 'shipment has already been received';
  end if;
  if scheduled_row.status = 'Cancelled' then
    raise exception using errcode = '23514', message = 'cancelled shipment cannot be received';
  end if;
  if scheduled_row.import_id is not null then
    return public.confirm_manifest_arrival(scheduled_row.import_id);
  end if;
  if jsonb_typeof(scheduled_row.line_items) <> 'array' or jsonb_array_length(scheduled_row.line_items) = 0 then
    raise exception using errcode = '23514', message = 'shipment has no saved line items to receive';
  end if;

  receipt_input := jsonb_build_object(
    'shipment', jsonb_build_object(
      'shipmentNumber', scheduled_row.shipment_number,
      'supplierId', scheduled_row.supplier_id,
      'shipmentDate', scheduled_row.shipment_date,
      'expectedArrivalDate', scheduled_row.expected_arrival_date,
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

  delete from public.shipments as s where s.id = scheduled_row.id;
  received_shipment_id := public.bulk_create_shipment(receipt_input);
  update public.app_notifications as n
  set is_read = true
  where n.entity_id = p_shipment_id and n.type in ('ShipmentArrivalDue', 'ShipmentDelayed');
  return received_shipment_id;
end
$$;

create or replace function public.reschedule_shipment(
  p_shipment_id text,
  p_expected_arrival_date date,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  shipment_row public.shipments%rowtype;
  actor_id text;
  actor_name text;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment reschedule permission is required';
  end if;
  if p_expected_arrival_date <= current_date then
    raise exception using errcode = '22023', message = 'new expected arrival date must be in the future';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'a delay reason is required';
  end if;

  select s.* into shipment_row from public.shipments as s where s.id = p_shipment_id for update;
  if not found or shipment_row.workflow_status = 'received' or shipment_row.status in ('Arrived', 'Cancelled') then
    raise exception using errcode = '23514', message = 'only pending or delayed shipments can be rescheduled';
  end if;
  if shipment_row.import_id is not null then
    perform public.reschedule_manifest(shipment_row.import_id, p_expected_arrival_date, p_reason);
    update public.shipments as s set status = 'In Transit' where s.id = p_shipment_id;
    return;
  end if;

  select u.id, u.name into actor_id, actor_name
  from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  update public.shipments as s
  set expected_arrival_date = p_expected_arrival_date,
      status = 'In Transit',
      workflow_status = 'scheduled',
      delay_reason = btrim(p_reason),
      last_arrival_prompt_at = null,
      timeline = s.timeline || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'timestamp', now(), 'status', 'In Transit',
        'userId', actor_id, 'userName', actor_name, 'notes', btrim(p_reason),
        'eventType', 'Rescheduled'
      ))
  where s.id = p_shipment_id;
  update public.app_notifications as n set is_read = true
  where n.entity_id = p_shipment_id and n.type in ('ShipmentArrivalDue', 'ShipmentDelayed');
end
$$;

create or replace function public.flag_overdue_shipments()
returns integer
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  actor_name text;
  shipment_row record;
  admin_row record;
  notification_id text;
  changed_count integer := 0;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment permission is required';
  end if;
  select u.id, u.name into actor_id, actor_name
  from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;

  for shipment_row in
    select s.id, s.shipment_number, s.expected_arrival_date, s.status
    from public.shipments as s
    where s.workflow_status = 'scheduled'
      and s.status not in ('Arrived', 'Cancelled')
      and s.expected_arrival_date <= current_date
    for update
  loop
    if shipment_row.expected_arrival_date < current_date and shipment_row.status <> 'Delayed' then
      update public.shipments as s
      set status = 'Delayed',
          timeline = s.timeline || jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid()::text, 'timestamp', now(), 'status', 'Delayed',
            'userId', actor_id, 'userName', actor_name, 'notes', 'Auto-flagged as delayed',
            'eventType', 'DelayedAlert'
          ))
      where s.id = shipment_row.id;
      changed_count := changed_count + 1;
    end if;

    for admin_row in select u.id from public.users as u where u.role = 'Admin' and u.is_active loop
      if not exists (
        select 1 from public.app_notifications as n
        where n.user_id = admin_row.id
          and n.entity_id = shipment_row.id
          and n.type = case when shipment_row.expected_arrival_date < current_date then 'ShipmentDelayed' else 'ShipmentArrivalDue' end
      ) then
        notification_id := public.next_business_id('NTF');
        insert into public.app_notifications (id, type, title, message, date, is_read, entity_id, user_id)
        values (
          notification_id,
          case when shipment_row.expected_arrival_date < current_date then 'ShipmentDelayed' else 'ShipmentArrivalDue' end,
          case when shipment_row.expected_arrival_date < current_date then 'Shipment Delayed' else 'Shipment Expected Today' end,
          case when shipment_row.expected_arrival_date < current_date
            then 'Shipment ' || shipment_row.shipment_number || ' is past its expected arrival date'
            else 'Shipment ' || shipment_row.shipment_number || ' is expected to arrive today'
          end,
          current_date, false, shipment_row.id, admin_row.id
        );
      end if;
    end loop;
  end loop;
  return changed_count;
end
$$;

revoke all on function public.receive_scheduled_shipment(text) from public, anon;
revoke all on function public.reschedule_shipment(text, date, text) from public, anon;
revoke all on function public.flag_overdue_shipments() from public, anon;
grant execute on function public.receive_scheduled_shipment(text) to authenticated;
grant execute on function public.reschedule_shipment(text, date, text) to authenticated;
grant execute on function public.flag_overdue_shipments() to authenticated;

commit;
