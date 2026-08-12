begin;

-- A freshly reset installation has no application users. Serialize the first
-- insert so that exactly one account is promoted to the protected primary
-- administrator, regardless of whether it was created by the seed command or
-- by another trusted bootstrap path.
create or replace function public.assign_first_user_as_primary_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('armory-store-first-primary-admin'));
  if not exists (select 1 from public.users) then
    new.role := 'Admin'::public.app_role;
    new.is_primary_admin := true;
    new.is_active := true;
  end if;
  return new;
end
$$;

drop trigger if exists users_assign_first_primary_admin on public.users;
create trigger users_assign_first_primary_admin
before insert on public.users
for each row execute function public.assign_first_user_as_primary_admin();

commit;
