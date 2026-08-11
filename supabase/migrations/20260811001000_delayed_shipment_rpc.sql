begin;

create or replace function public.flag_overdue_shipments()
returns integer language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; actor_name text; shipment_row record; changed_count integer := 0;
begin
  if not public.can_manage_shipments() then raise exception using errcode = '42501', message = 'shipment permission is required'; end if;
  select u.id, u.name into actor_id, actor_name from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  for shipment_row in
    select s.id, s.shipment_number from public.shipments as s
    where s.status not in ('Arrived', 'Cancelled', 'Delayed') and s.expected_arrival_date < current_date
    for update
  loop
    update public.shipments as s set status = 'Delayed',
      timeline = s.timeline || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'timestamp', now(), 'status', 'Delayed',
        'userId', actor_id, 'userName', actor_name, 'notes', 'Auto-flagged as delayed',
        'eventType', 'DelayedAlert'))
    where s.id = shipment_row.id;
    perform public.create_app_notification(
      'ShipmentDelayed', 'Shipment Delayed',
      'Shipment ' || shipment_row.shipment_number || ' is past its expected arrival date', shipment_row.id
    );
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end
$$;

revoke all on function public.flag_overdue_shipments() from public, anon;
grant execute on function public.flag_overdue_shipments() to authenticated;

commit;
