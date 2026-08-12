begin;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    'shipment_id := public.next_business_id(''SHP'');',
    'shipment_id := coalesce(nullif(btrim(p_input ->> ''id''), ''''), public.next_business_id(''SHP''));'
  );
  if patched = definition then
    raise exception 'create_shipment identity patch did not match the installed function';
  end if;
  execute patched;

  select pg_get_functiondef('public.receive_scheduled_shipment(text)'::regprocedure) into definition;
  patched := replace(
    definition,
    '''shipmentNumber'', scheduled_row.shipment_number,',
    '''id'', scheduled_row.id, ''shipmentNumber'', scheduled_row.shipment_number,'
  );
  patched := replace(
    patched,
    'update public.app_notifications as n',
    'update public.shipments as s set timeline = scheduled_row.timeline || s.timeline, documents = scheduled_row.documents where s.id = received_shipment_id; update public.app_notifications as n'
  );
  if patched = definition then
    raise exception 'receive_scheduled_shipment identity patch did not match the installed function';
  end if;
  execute patched;

  select pg_get_functiondef('public.confirm_manifest_arrival(text)'::regprocedure) into definition;
  patched := replace(
    definition,
    'bulk_input := public.manifest_bulk_input(p_import_id, confirmation);',
    'bulk_input := public.manifest_bulk_input(p_import_id, confirmation); bulk_input := jsonb_set(bulk_input, ''{shipment,id}'', to_jsonb(old_shipment.id), true);'
  );
  if patched = definition then
    raise exception 'confirm_manifest_arrival identity patch did not match the installed function';
  end if;
  execute patched;
end
$$;

revoke all on function public.create_shipment(jsonb) from public, anon;
revoke all on function public.receive_scheduled_shipment(text) from public, anon;
revoke all on function public.confirm_manifest_arrival(text) from public, anon;
grant execute on function public.create_shipment(jsonb) to authenticated;
grant execute on function public.receive_scheduled_shipment(text) to authenticated;
grant execute on function public.confirm_manifest_arrival(text) to authenticated;

commit;
