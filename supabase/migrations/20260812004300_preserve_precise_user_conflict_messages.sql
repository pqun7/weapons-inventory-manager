-- Business conflict checks use an application exception so the final
-- unique-violation cleanup handler does not replace their precise message.

do $$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef('public.admin_users_action(jsonb)'::regprocedure)
  into function_definition;
  corrected_definition := replace(
    function_definition,
    'raise exception using errcode = ''23505'', message = ''The name is already used by another account'';',
    'raise exception using errcode = ''P0001'', message = ''The name is already used by another account'';'
  );
  corrected_definition := replace(
    corrected_definition,
    'raise exception using errcode = ''23505'', message = ''The email is already used by another account'';',
    'raise exception using errcode = ''P0001'', message = ''The email is already used by another account'';'
  );
  if corrected_definition = function_definition then
    raise exception 'Expected precise conflict checks were not found';
  end if;
  execute corrected_definition;
end
$$;

notify pgrst, 'reload schema';
