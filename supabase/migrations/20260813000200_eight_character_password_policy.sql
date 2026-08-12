-- First-login passwords require at least eight characters while retaining the
-- existing upper-case, lower-case, and numeric composition requirements.

do $$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef('public.claim_account(text,text,text)'::regprocedure)
  into function_definition;
  corrected_definition := replace(function_definition, 'length(p_password) < 12', 'length(p_password) < 8');
  corrected_definition := replace(
    corrected_definition,
    'Use at least 12 characters with upper-case, lower-case, and a number',
    'Use at least 8 characters with upper-case, lower-case, and a number'
  );
  if corrected_definition = function_definition then
    raise exception 'Expected 12-character password policy was not found';
  end if;
  execute corrected_definition;
end
$$;

notify pgrst, 'reload schema';
