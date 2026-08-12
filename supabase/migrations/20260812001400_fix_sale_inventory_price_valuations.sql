begin;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(
    'public.complete_sale(text,text,text,text,jsonb,numeric,numeric,numeric,date,numeric,text,text,jsonb,text,date)'::regprocedure
  ) into definition;

  patched := replace(
    definition,
    'select a.quantity, a.price_valuation into current_quantity, list_valuation',
    'select a.quantity, case when p_mode = ''Wholesale'' then a.wholesale_price_valuation else a.retail_price_valuation end into current_quantity, list_valuation'
  );
  patched := replace(
    patched,
    'select a.full_packages, a.loose_rounds, a.units_per_package, a.price_valuation',
    'select a.full_packages, a.loose_rounds, a.units_per_package, case when p_mode = ''Wholesale'' then a.wholesale_price_valuation else a.retail_price_valuation end'
  );

  if patched = definition
     or position('select a.quantity, a.price_valuation' in patched) > 0
     or position('a.units_per_package, a.price_valuation' in patched) > 0 then
    raise exception 'complete_sale inventory valuation patch did not match the installed function';
  end if;

  execute patched;
end
$$;

revoke all on function public.complete_sale(text, text, text, text, jsonb, numeric, numeric, numeric, date, numeric, text, text, jsonb, text, date) from public, anon;
grant execute on function public.complete_sale(text, text, text, text, jsonb, numeric, numeric, numeric, date, numeric, text, text, jsonb, text, date) to authenticated;

commit;
