begin;

alter table public.business_id_counters enable row level security;
revoke all on public.business_id_counters from authenticated, anon;

create policy own_notifications_insert on public.app_notifications
for insert to authenticated
with check (user_id = public.current_app_user_id());

do $$
declare table_name text;
begin
  foreach table_name in array array['weapons', 'accessories', 'ammunition', 'shipments', 'invoices', 'payment_records'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables as published
      where published.pubname = 'supabase_realtime'
        and published.schemaname = 'public'
        and published.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;

commit;
