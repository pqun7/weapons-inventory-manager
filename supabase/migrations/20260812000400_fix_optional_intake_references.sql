begin;

do $$
declare
  definition text := pg_get_functiondef('public.bulk_intake_weapons(jsonb)'::regprocedure);
begin
  definition := regexp_replace(
    definition,
    $pattern$if not exists \(\s*select 1 from public\.storage_locations as sl where sl\.id = p_input ->> 'storageLocationId'\s*\) then\s*raise exception using errcode = '23503', message = 'storage location not found';\s*end if;$pattern$,
    $replacement$if nullif(p_input ->> 'storageLocationId', '') is not null and not exists (
    select 1 from public.storage_locations as sl where sl.id = p_input ->> 'storageLocationId'
  ) then raise exception using errcode = '23503', message = 'storage location not found'; end if;$replacement$
  );
  definition := regexp_replace(
    definition,
    $pattern$if not exists \(\s*select 1 from public\.suppliers as s where s\.id = p_input ->> 'supplierId'\s*\) then\s*raise exception using errcode = '23503', message = 'supplier not found';\s*end if;$pattern$,
    $replacement$if nullif(p_input ->> 'supplierId', '') is not null and not exists (
    select 1 from public.suppliers as s where s.id = p_input ->> 'supplierId'
  ) then raise exception using errcode = '23503', message = 'supplier not found'; end if;$replacement$
  );
  if position('if not exists (select 1 from public.storage_locations' in definition) > 0
    or position('if not exists (select 1 from public.suppliers' in definition) > 0 then
    raise exception 'Failed to remove mandatory intake reference checks';
  end if;
  execute definition;
end
$$;

commit;
