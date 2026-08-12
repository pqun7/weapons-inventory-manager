begin;

create or replace function public.classify_audit_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.event_action in ('INSERT', 'UPDATE', 'DELETE') and new.table_name is not null then
    new.is_visible := false;
    new.importance := 0;
  end if;
  if new.action_type = 'Login'
     or new.description ~* '(auto[ -]?sav(e|ed|ing)|manifest items?.*updated during review|background|heartbeat|draft saved)' then
    new.is_visible := false;
    new.importance := 0;
  end if;
  return new;
end
$$;

update public.audit_logs
set is_visible = false, importance = 0
where action_type = 'Login'
   or description ~* '(auto[ -]?sav(e|ed|ing)|manifest items?.*updated during review|background|heartbeat|draft saved)';

notify pgrst, 'reload schema';

commit;
