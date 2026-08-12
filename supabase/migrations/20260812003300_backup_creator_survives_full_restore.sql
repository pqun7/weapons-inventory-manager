-- Backup history lives outside restored application snapshots. Keep its immutable
-- created_by_name even when a restored snapshot no longer contains that user.

alter table public.app_backups
  alter column created_by drop not null;

alter table public.app_backups
  drop constraint if exists app_backups_created_by_fkey;

alter table public.app_backups
  add constraint app_backups_created_by_fkey
  foreign key (created_by) references public.users(id) on delete set null;

notify pgrst, 'reload schema';
