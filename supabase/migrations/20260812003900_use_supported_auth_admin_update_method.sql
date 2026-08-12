-- GoTrue's admin user endpoint updates identities with PUT. PATCH returns 405.

do $$
declare
  signature regprocedure;
  function_definition text;
  corrected_definition text;
begin
  foreach signature in array array[
    'public.admin_users_action(jsonb)'::regprocedure,
    'public.claim_account(text,text,text)'::regprocedure
  ] loop
    select pg_get_functiondef(signature) into function_definition;
    corrected_definition := replace(function_definition, '''PATCH''', '''PUT''');
    if corrected_definition = function_definition then
      raise exception 'Expected PATCH method was not found in %', signature;
    end if;
    execute corrected_definition;
  end loop;
end
$$;

notify pgrst, 'reload schema';
