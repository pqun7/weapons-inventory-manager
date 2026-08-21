-- Notification read/dismiss state belongs to the signed-in application user.
-- The notification itself remains immutable and visible to other recipients.
create table if not exists public.notification_user_state (
  notification_id text not null references public.app_notifications(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists idx_notification_user_state_user
  on public.notification_user_state(user_id, dismissed_at, updated_at desc);

alter table public.notification_user_state enable row level security;
revoke all on public.notification_user_state from public, anon, authenticated;
grant select, insert, update, delete on public.notification_user_state to authenticated;

drop policy if exists own_notification_state_read on public.notification_user_state;
create policy own_notification_state_read on public.notification_user_state
for select to authenticated
using (user_id = public.current_app_user_id());

drop policy if exists own_notification_state_insert on public.notification_user_state;
create policy own_notification_state_insert on public.notification_user_state
for insert to authenticated
with check (
  user_id = public.current_app_user_id()
  and exists (
    select 1 from public.app_notifications as notification
    where notification.id = notification_id
      and (notification.user_id is null or notification.user_id = public.current_app_user_id())
  )
);

drop policy if exists own_notification_state_update on public.notification_user_state;
create policy own_notification_state_update on public.notification_user_state
for update to authenticated
using (user_id = public.current_app_user_id())
with check (user_id = public.current_app_user_id());

drop policy if exists own_notification_state_delete on public.notification_user_state;
create policy own_notification_state_delete on public.notification_user_state
for delete to authenticated
using (user_id = public.current_app_user_id());

create or replace function public.set_notification_user_state(
  p_notification_ids text[],
  p_dismissed boolean default false
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id text := public.current_app_user_id();
  affected integer := 0;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'authenticated application user is required';
  end if;
  if p_notification_ids is null or cardinality(p_notification_ids) > 1000 then
    raise exception using errcode = '22023', message = 'notification selection is invalid';
  end if;

  insert into public.notification_user_state(
    notification_id, user_id, read_at, dismissed_at, updated_at
  )
  select notification.id, actor_id, now(), case when p_dismissed then now() else null end, now()
  from public.app_notifications as notification
  where notification.id = any(p_notification_ids)
    and (notification.user_id is null or notification.user_id = actor_id)
  on conflict(notification_id, user_id) do update set
    read_at = excluded.read_at,
    dismissed_at = excluded.dismissed_at,
    updated_at = excluded.updated_at;

  get diagnostics affected = row_count;
  return affected;
end
$$;

revoke all on function public.set_notification_user_state(text[], boolean) from public, anon;
grant execute on function public.set_notification_user_state(text[], boolean) to authenticated;

update public.app_installation
set schema_version = '20260817000300'
where singleton = true;

notify pgrst, 'reload schema';
