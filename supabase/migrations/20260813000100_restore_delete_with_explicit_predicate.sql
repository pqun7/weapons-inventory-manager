-- Supabase enables the safeupdate guard for API sessions. A full snapshot
-- restore intentionally clears each included table, so express that intent with
-- an explicit predicate instead of an unqualified DELETE.

do $$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef('public.restore_system_backup(uuid)'::regprocedure)
  into function_definition;

  corrected_definition := replace(
    function_definition,
    'delete from public.%I''',
    'delete from public.%I where true'''
  );

  if corrected_definition = function_definition then
    raise exception 'Expected restore table DELETE statement was not found';
  end if;

  execute corrected_definition;
end
$$;

notify pgrst, 'reload schema';
