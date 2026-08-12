begin;

do $patch$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    $$'[]'::jsonb, 'draft'$$,
    $$'[]'::jsonb, coalesce(p_input -> 'additionalCosts', '[]'::jsonb), 'scheduled'$$
  );
  if patched = definition then raise exception 'create_shipment planned-cost values fix did not match'; end if;
  execute patched;
end
$patch$;

commit;
