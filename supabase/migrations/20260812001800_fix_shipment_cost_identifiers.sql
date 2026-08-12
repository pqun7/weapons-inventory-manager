begin;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.apply_shipment_costs(text,jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    'cost_id := coalesce(nullif(cost ->> ''id'', ''''), public.next_business_id(''SC''));',
    'cost_id := public.next_business_id(''SC'');'
  );
  if patched = definition then
    raise exception 'apply_shipment_costs identifier patch did not match the installed function';
  end if;
  execute patched;
end
$$;

revoke all on function public.apply_shipment_costs(text, jsonb) from public, anon;
grant execute on function public.apply_shipment_costs(text, jsonb) to authenticated;

commit;
