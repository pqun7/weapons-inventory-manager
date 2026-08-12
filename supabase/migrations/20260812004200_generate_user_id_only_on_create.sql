-- Update/delete/reset must use the requested target. Only account creation gets
-- a new durable server-generated identifier.

do $$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef('public.admin_users_action(jsonb)'::regprocedure)
  into function_definition;
  corrected_definition := replace(
    function_definition,
    'target_id text := ''U-'' || gen_random_uuid()::text;',
    'target_id text := coalesce(user_payload ->> ''id'', p_request ->> ''userId'');'
  );
  if corrected_definition = function_definition then
    raise exception 'Expected server-generated target_id declaration was not found';
  end if;
  function_definition := corrected_definition;
  corrected_definition := replace(
    function_definition,
    '  if action_name = ''create'' then',
    E'  if action_name = ''create'' then\n    target_id := ''U-'' || gen_random_uuid()::text;'
  );
  if corrected_definition = function_definition then
    raise exception 'Expected create branch was not found';
  end if;
  execute corrected_definition;
end
$$;

notify pgrst, 'reload schema';
