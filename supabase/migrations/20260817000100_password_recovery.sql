begin;

create table if not exists public.password_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  account_role public.app_role not null,
  status text not null check (status in ('pending','approved','completed','cancelled')),
  code_hash text,
  attempts integer not null default 0 check (attempts between 0 and 5),
  requested_at timestamptz not null default now(),
  expires_at timestamptz,
  approved_by text references public.users(id) on delete set null,
  approved_at timestamptz,
  completed_at timestamptz
);
create index if not exists password_recovery_user_time
  on public.password_recovery_requests(user_id, requested_at desc);
create index if not exists password_recovery_pending
  on public.password_recovery_requests(status, requested_at desc);

alter table public.password_recovery_requests enable row level security;
revoke all on public.password_recovery_requests from public, anon, authenticated;

create or replace function public.request_password_recovery(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  clean_identifier text := lower(btrim(p_identifier));
  account public.users;
  request_id uuid;
  recent_count integer;
  last_request timestamptz;
  admin_row record;
  email_value text;
  email_local text;
  email_domain text;
begin
  if clean_identifier = '' or length(clean_identifier) > 160 then
    raise exception using errcode = '22023', message = 'Enter a valid account identifier';
  end if;
  select * into account from public.users u where u.is_active and (
    lower(coalesce(u.username, '')) = clean_identifier or lower(coalesce(u.email, '')) = clean_identifier
    or lower(u.login_email) = clean_identifier or lower(btrim(u.name)) = clean_identifier
  ) limit 1;
  if account.id is null then
    return jsonb_build_object('requestId', gen_random_uuid(), 'channel', 'admin_approval');
  end if;
  select count(*), max(requested_at) into recent_count, last_request
  from public.password_recovery_requests
  where user_id = account.id and requested_at >= now() - interval '1 hour';
  if recent_count >= 5 then
    raise exception using errcode = 'P0001', message = 'Too many recovery requests. Try again later';
  end if;
  if last_request is not null and last_request > now() - interval '2 minutes' then
    raise exception using errcode = 'P0001', message = 'Wait two minutes before requesting another code';
  end if;

  if account.role = 'Admin'::public.app_role then
    email_value := lower(coalesce(account.login_email, ''));
    if email_value = '' or email_value like '%@local.weapon-store.invalid' then
      raise exception using errcode = 'P0001', message = 'The administrator account does not have a recovery email';
    end if;
    insert into public.password_recovery_requests(user_id, account_role, status, expires_at)
    values(account.id, account.role, 'approved', now() + interval '15 minutes') returning id into request_id;
    email_local := split_part(email_value, '@', 1);
    email_domain := split_part(email_value, '@', 2);
    return jsonb_build_object(
      'requestId', request_id, 'channel', 'email', 'recoveryEmail', email_value,
      'destinationHint', left(email_local, 2) || repeat('*', greatest(2, length(email_local) - 2)) || '@' || email_domain
    );
  end if;

  insert into public.password_recovery_requests(user_id, account_role, status)
  values(account.id, account.role, 'pending') returning id into request_id;
  for admin_row in select id from public.users where role='Admin'::public.app_role and is_active loop
    insert into public.app_notifications(id,type,title,message,date,is_read,entity_id,user_id)
    values('N-' || gen_random_uuid()::text,'System','Password recovery approval',
      account.name || ' requested a password reset. Review it in Settings → Users.',current_date,false,request_id::text,admin_row.id);
  end loop;
  return jsonb_build_object('requestId', request_id, 'channel', 'admin_approval');
end
$$;

create or replace function public.list_pending_password_recovery()
returns table(id uuid, user_id text, user_name text, requested_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then
    raise exception using errcode='42501', message='Administrator role is required';
  end if;
  return query select r.id,r.user_id,u.name,r.requested_at
  from public.password_recovery_requests r join public.users u on u.id=r.user_id
  where r.status='pending' order by r.requested_at;
end
$$;

create or replace function public.approve_password_recovery(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor_id text := public.current_app_user_id();
  target record;
  random_bytes bytea := gen_random_bytes(4);
  code text;
  expiry timestamptz := now() + interval '15 minutes';
begin
  if not public.is_app_admin() then
    raise exception using errcode='42501', message='Administrator role is required';
  end if;
  code := lpad((((get_byte(random_bytes, 0)::bigint << 24) + (get_byte(random_bytes, 1)::bigint << 16)
    + (get_byte(random_bytes, 2)::bigint << 8) + get_byte(random_bytes, 3)::bigint) % 1000000)::text, 6, '0');
  select r.user_id,u.name into target from public.password_recovery_requests r
  join public.users u on u.id=r.user_id
  where r.id=p_request_id and r.status='pending' and r.account_role='Employee'::public.app_role for update of r;
  if target.user_id is null then raise exception using errcode='P0001', message='Pending recovery request was not found'; end if;
  update public.password_recovery_requests set status='approved',code_hash=encode(digest(p_request_id::text || ':' || upper(code),'sha256'),'hex'),
    expires_at=expiry,approved_by=actor_id,approved_at=now() where id=p_request_id;
  return jsonb_build_object('requestId',p_request_id,'userId',target.user_id,'userName',target.name,'code',code,'expiresAt',expiry);
end
$$;

create or replace function public.complete_employee_password_recovery(
  p_request_id uuid, p_identifier text, p_code text, p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  clean_identifier text := lower(btrim(p_identifier));
  recovery public.password_recovery_requests;
  account public.users;
begin
  if length(p_password) < 8 or length(p_password) > 256 or p_password !~ '[a-z]' or p_password !~ '[A-Z]' or p_password !~ '[0-9]' then
    raise exception using errcode='22023', message='Use 8 to 256 characters with upper-case, lower-case, and a number';
  end if;
  select * into recovery from public.password_recovery_requests where id=p_request_id and status='approved' for update;
  if recovery.id is null or recovery.expires_at <= now() or recovery.attempts >= 5 then
    return jsonb_build_object('success',false,'error','Recovery code is invalid or expired');
  end if;
  select * into account from public.users where id=recovery.user_id and is_active;
  if account.id is null or not (
    lower(coalesce(account.username,''))=clean_identifier or lower(coalesce(account.email,''))=clean_identifier
    or lower(account.login_email)=clean_identifier or lower(btrim(account.name))=clean_identifier
  ) then return jsonb_build_object('success',false,'error','Recovery request is invalid or expired'); end if;
  if encode(digest(recovery.id::text || ':' || upper(btrim(p_code)),'sha256'),'hex') <> recovery.code_hash then
    update public.password_recovery_requests set attempts=attempts+1 where id=recovery.id;
    return jsonb_build_object('success',false,'error','Recovery code is invalid or expired');
  end if;
  perform public.auth_admin_request('PUT','/' || account.auth_user_id::text,jsonb_build_object(
    'password',p_password,'user_metadata',jsonb_build_object('app_user_id',account.id,'display_name',account.name,'requires_password_setup',false)
  ));
  update public.users set password_set=true,activation_token_hash=null,activation_expires_at=null where id=account.id;
  update public.password_recovery_requests set status='completed',completed_at=now(),code_hash=null where id=recovery.id;
  return jsonb_build_object('success',true,'loginEmail',account.login_email);
end
$$;

revoke all on function public.request_password_recovery(text) from public;
grant execute on function public.request_password_recovery(text) to anon, authenticated;
revoke all on function public.complete_employee_password_recovery(uuid,text,text,text) from public;
grant execute on function public.complete_employee_password_recovery(uuid,text,text,text) to anon, authenticated;
revoke all on function public.list_pending_password_recovery() from public, anon;
grant execute on function public.list_pending_password_recovery() to authenticated;
revoke all on function public.approve_password_recovery(uuid) from public, anon;
grant execute on function public.approve_password_recovery(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
