begin;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(
    'public.complete_sale(text,text,text,text,jsonb,numeric,numeric,numeric,date,numeric,text,text,jsonb,text,date)'::regprocedure
  ) into definition;

  patched := replace(definition, '  units_per_package integer;', '  ammunition_package_size integer;');
  patched := replace(patched, 'into current_packages, current_loose, units_per_package, list_valuation', 'into current_packages, current_loose, ammunition_package_size, list_valuation');
  patched := replace(patched, 'if units_per_package is null then', 'if ammunition_package_size is null then');
  patched := replace(patched, 'current_packages * units_per_package + current_loose', 'current_packages * ammunition_package_size + current_loose');
  patched := replace(patched, 'into remaining_rounds, units_per_package', 'into remaining_rounds, ammunition_package_size');
  patched := replace(patched, 'remaining_rounds / units_per_package', 'remaining_rounds / ammunition_package_size');
  patched := replace(patched, 'remaining_rounds % units_per_package', 'remaining_rounds % ammunition_package_size');

  if patched = definition or position('units_per_package integer;' in patched) > 0 then
    raise exception 'complete_sale ammunition variable patch did not match the installed function';
  end if;

  execute patched;
end
$$;

revoke all on function public.complete_sale(text, text, text, text, jsonb, numeric, numeric, numeric, date, numeric, text, text, jsonb, text, date) from public, anon;
grant execute on function public.complete_sale(text, text, text, text, jsonb, numeric, numeric, numeric, date, numeric, text, text, jsonb, text, date) to authenticated;

commit;
