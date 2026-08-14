begin;

-- PostgreSQL does not implicitly narrow an integer literal when resolving a
-- function call. The audit function deliberately stores importance as a
-- smallint, so make the generated intake call explicit.
do $$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef('public.bulk_intake_weapons(jsonb)'::regprocedure)
  into function_definition;

  corrected_definition := replace(
    function_definition,
    E'    added_count,\n    3\n  );',
    E'    added_count,\n    3::smallint\n  );'
  );
  if corrected_definition = function_definition then
    raise exception 'bulk_intake_weapons audit importance marker was not found';
  end if;
  execute corrected_definition;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
