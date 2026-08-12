-- The generated bootstrap password must stay below the Auth bcrypt byte limit.
-- It is never shown or used by the operator; the user replaces it on first login.

do $$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef('public.admin_users_action(jsonb)'::regprocedure)
  into function_definition;
  corrected_definition := replace(
    function_definition,
    'encode(gen_random_bytes(48), ''hex'')',
    'encode(gen_random_bytes(24), ''hex'')'
  );
  if corrected_definition = function_definition then
    raise exception 'Expected bootstrap password expression was not found';
  end if;
  execute corrected_definition;
end
$$;

notify pgrst, 'reload schema';
