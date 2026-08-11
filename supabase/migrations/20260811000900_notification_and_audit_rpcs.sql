begin;

create unique index if not exists uq_notification_user_type_entity
on public.app_notifications(user_id, type, entity_id)
where entity_id is not null;

create or replace function public.create_app_notification(
  p_type text, p_title text, p_message text, p_entity_id text default null
)
returns text language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; notification_id text;
begin
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  if actor_id is null then raise exception using errcode = '42501', message = 'authenticated application user is required'; end if;
  if p_entity_id is not null then
    select n.id into notification_id from public.app_notifications as n
    where n.user_id = actor_id and n.type = p_type and n.entity_id = p_entity_id limit 1;
    if notification_id is not null then return notification_id; end if;
  end if;
  notification_id := public.next_business_id('NTF');
  insert into public.app_notifications (id, type, title, message, date, is_read, entity_id, user_id)
  values (notification_id, p_type, coalesce(p_title, ''), coalesce(p_message, ''), current_date, false, p_entity_id, actor_id);
  return notification_id;
end
$$;

create or replace function public.write_audit_event(p_action_type text, p_description text, p_metadata jsonb default '{}'::jsonb)
returns text language plpgsql volatile security definer set search_path = public, auth as $$
declare actor_id text; audit_id text;
begin
  select u.id into actor_id from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  if actor_id is null then raise exception using errcode = '42501', message = 'authenticated application user is required'; end if;
  if nullif(btrim(p_action_type), '') is null or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid audit event';
  end if;
  audit_id := public.next_business_id('LOG');
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (audit_id, now(), current_date, actor_id, btrim(p_action_type), coalesce(p_description, ''), coalesce(p_metadata, '{}'::jsonb));
  return audit_id;
end
$$;

revoke all on function public.create_app_notification(text, text, text, text) from public, anon;
revoke all on function public.write_audit_event(text, text, jsonb) from public, anon;
grant execute on function public.create_app_notification(text, text, text, text) to authenticated;
grant execute on function public.write_audit_event(text, text, jsonb) to authenticated;

commit;
