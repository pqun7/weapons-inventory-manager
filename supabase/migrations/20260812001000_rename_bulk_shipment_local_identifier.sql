begin;

do $patch$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.bulk_create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(definition, 'shipment_id text;', 'created_shipment_id text;');
  patched := replace(patched, 'shipment_id := public.create_shipment', 'created_shipment_id := public.create_shipment');
  patched := replace(patched, $$'shipmentId', shipment_id$$, $$'shipmentId', created_shipment_id$$);
  patched := replace(patched, 'where w.shipment_id = bulk_create_shipment.shipment_id', 'where w.shipment_id = created_shipment_id');
  patched := replace(patched, 'line_id, shipment_id, line ->>', 'line_id, created_shipment_id, line ->>');
  patched := replace(patched, 'perform public.apply_shipment_costs(shipment_id,', 'perform public.apply_shipment_costs(created_shipment_id,');
  patched := replace(patched, 'where s.id = bulk_create_shipment.shipment_id', 'where s.id = created_shipment_id');
  patched := replace(patched, 'return shipment_id;', 'return created_shipment_id;');
  if patched = definition then raise exception 'bulk_create_shipment local identifier rename did not match'; end if;
  execute patched;
end
$patch$;

commit;
