-- DELETE has no NEW row, while the established audit schema requires
-- new_values to be non-null. Store an empty object and preserve old_values.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor_id text;
  actor_name text;
  before_row jsonb;
  after_row jsonb;
  row_id text;
begin
  if current_setting('weapon_store.restore_mode', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select u.id, u.name into actor_id, actor_name
  from public.users u where u.auth_user_id = auth.uid() limit 1;
  actor_id := coalesce(actor_id, 'SYSTEM');
  actor_name := coalesce(actor_name, 'System');
  before_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  after_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  if tg_table_name = 'users' then
    before_row := before_row - 'login_email' - 'activation_token_hash';
    after_row := after_row - 'login_email' - 'activation_token_hash';
  elsif tg_table_name = 'app_backups' then
    before_row := before_row - 'payload';
    after_row := after_row - 'payload';
  end if;
  row_id := coalesce(after_row ->> 'id', before_row ->> 'id', after_row ->> 'iso_code', before_row ->> 'iso_code', '');
  insert into public.audit_logs(
    id, timestamp, date, user_id, user_name, action_type, event_action,
    description, metadata, table_name, record_id, old_values, new_values
  ) values (
    gen_random_uuid()::text, now(), current_date, actor_id, actor_name,
    initcap(lower(tg_op)), tg_op,
    format('%s %s on %I', actor_name, lower(tg_op), tg_table_name),
    jsonb_build_object('table', tg_table_name, 'record_id', row_id),
    tg_table_name, row_id, before_row, coalesce(after_row, '{}'::jsonb)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

notify pgrst, 'reload schema';
