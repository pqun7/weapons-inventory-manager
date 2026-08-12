begin;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.bulk_create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    'line_id := coalesce(nullif(line ->> ''id'', ''''), public.next_business_id(''SLI''));',
    'line_id := public.next_business_id(''SLI'');'
  );
  if patched = definition then
    raise exception 'bulk_create_shipment line identifier patch did not match the installed function';
  end if;
  execute patched;
end
$$;

revoke all on function public.bulk_create_shipment(jsonb) from public, anon;
grant execute on function public.bulk_create_shipment(jsonb) to authenticated;

commit;
