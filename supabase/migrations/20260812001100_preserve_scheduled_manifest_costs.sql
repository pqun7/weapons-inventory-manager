begin;

do $patch$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.confirm_manifest_review(jsonb)'::regprocedure) into definition;
  patched := replace(
    definition,
    $$'lineItems', bulk_input -> 'lineItems'))$$,
    $$'lineItems', bulk_input -> 'lineItems', 'additionalCosts', bulk_input -> 'additionalCosts'))$$
  );
  if patched = definition then raise exception 'scheduled manifest cost propagation patch did not match'; end if;
  execute patched;
end
$patch$;

commit;
