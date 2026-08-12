-- User IDs must not be derived from the renderer's currently visible rows: a
-- deactivated account still reserves its primary key. Generate the durable ID
-- on the server and report actual name/email conflicts before creating Auth.

do $$
declare
  function_definition text;
  corrected_definition text;
  conflict_checks text := $checks$
    if exists (
      select 1 from public.users existing
      where lower(btrim(existing.name)) = lower(btrim(clean_name))
    ) then
      raise exception using errcode = '23505', message = 'The name is already used by another account';
    end if;
    if clean_email is not null and exists (
      select 1 from public.users existing
      where lower(existing.email) = lower(clean_email)
    ) then
      raise exception using errcode = '23505', message = 'The email is already used by another account';
    end if;
  $checks$;
begin
  select pg_get_functiondef('public.admin_users_action(jsonb)'::regprocedure)
  into function_definition;

  corrected_definition := replace(
    function_definition,
    'target_id text := COALESCE(user_payload ->> ''id''::text, p_request ->> ''userId''::text);',
    'target_id text := ''U-'' || gen_random_uuid()::text;'
  );
  if corrected_definition = function_definition then
    -- pg_get_functiondef output differs slightly across supported PG versions.
    corrected_definition := replace(
      function_definition,
      'target_id text := coalesce(user_payload ->> ''id'', p_request ->> ''userId'');',
      'target_id text := ''U-'' || gen_random_uuid()::text;'
    );
  end if;
  if corrected_definition = function_definition then
    raise exception 'Expected target_id declaration was not found';
  end if;

  function_definition := corrected_definition;
  corrected_definition := replace(
    function_definition,
    '    login_email := COALESCE(clean_email,',
    conflict_checks || E'\n    login_email := COALESCE(clean_email,'
  );
  if corrected_definition = function_definition then
    corrected_definition := replace(
      function_definition,
      '    login_email := coalesce(clean_email,',
      conflict_checks || E'\n    login_email := coalesce(clean_email,'
    );
  end if;
  if corrected_definition = function_definition then
    raise exception 'Expected login_email assignment was not found';
  end if;

  execute corrected_definition;
end
$$;

revoke all on function public.admin_users_action(jsonb) from public, anon;
grant execute on function public.admin_users_action(jsonb) to authenticated;
notify pgrst, 'reload schema';
