begin;

-- PostgREST may keep the previous function catalog after a new RPC is created.
-- This notification makes delete_manifest_items immediately discoverable by
-- Supabase clients using the public API schema cache.
select pg_notify('pgrst', 'reload schema');

commit;
