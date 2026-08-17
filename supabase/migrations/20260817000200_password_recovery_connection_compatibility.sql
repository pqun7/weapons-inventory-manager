begin;

-- Existing devices retain the last verified public connection metadata. The
-- password-recovery migration changes the required remote contract, so publish
-- that compatibility version after every preceding migration has succeeded.
update public.app_installation
set schema_version = '20260817000200'
where singleton;

notify pgrst, 'reload schema';
commit;
