-- The application now has one backup workflow: complete server-side system
-- snapshots. Employees may be granted creation permission, but never restore.

revoke all on function public.create_personal_backup(text) from public, anon, authenticated;
revoke all on function public.restore_personal_backup(uuid) from public, anon, authenticated;
drop function if exists public.create_personal_backup(text);
drop function if exists public.restore_personal_backup(uuid);

notify pgrst, 'reload schema';
