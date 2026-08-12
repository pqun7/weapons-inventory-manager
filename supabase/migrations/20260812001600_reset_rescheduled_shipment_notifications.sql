begin;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.reschedule_shipment(text,date,text)'::regprocedure) into definition;
  patched := replace(
    definition,
    'update public.app_notifications as n set is_read = true',
    'delete from public.app_notifications as n'
  );
  if patched = definition then
    raise exception 'reschedule_shipment notification reset patch did not match the installed function';
  end if;
  execute patched;
end
$$;

revoke all on function public.reschedule_shipment(text, date, text) from public, anon;
grant execute on function public.reschedule_shipment(text, date, text) to authenticated;

commit;
