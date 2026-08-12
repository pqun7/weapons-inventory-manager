begin;

-- A cost row identifier received from the renderer identifies an editable draft row.
-- The same draft is intentionally applied to every product in a shipment, so it cannot
-- also serve as the globally unique primary key of public.product_costs.
do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.replace_product_costs(text,text,jsonb)'::regprocedure)
  into definition;

  patched := replace(
    definition,
    'coalesce(nullif(cost ->> ''id'', ''''), public.next_business_id(''PC'')), p_product_type,',
    'public.next_business_id(''PC''), p_product_type,'
  );

  if patched = definition then
    raise exception 'replace_product_costs identifier patch did not match the installed function';
  end if;

  execute patched;
end
$$;

revoke all on function public.replace_product_costs(text, text, jsonb) from public, anon;
grant execute on function public.replace_product_costs(text, text, jsonb) to authenticated;

commit;
