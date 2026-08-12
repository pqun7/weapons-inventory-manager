begin;

alter table public.user_preferences
  add column if not exists inventory_visible_columns jsonb;

alter table public.user_preferences
  drop constraint if exists user_preferences_inventory_visible_columns_check;
alter table public.user_preferences
  add constraint user_preferences_inventory_visible_columns_check
  check (inventory_visible_columns is null or jsonb_typeof(inventory_visible_columns) = 'array');

do $$
declare
  function_definition text;
  original_definition text;
begin
  original_definition := pg_get_functiondef('public.bulk_intake_weapons(jsonb)'::regprocedure);
  function_definition := original_definition;

  function_definition := regexp_replace(
    function_definition,
    E'if not exists \\(select 1 from public\\.storage_locations as sl where sl\\.id = p_input ->> ''storageLocationId''\\) then\\s+raise exception using errcode = ''23503'', message = ''storage location not found''; end if;',
    E'if nullif(p_input ->> ''storageLocationId'', '''') is not null and not exists (select 1 from public.storage_locations as sl where sl.id = p_input ->> ''storageLocationId'') then\n    raise exception using errcode = ''23503'', message = ''storage location not found''; end if;',
    'g'
  );
  function_definition := regexp_replace(
    function_definition,
    E'if not exists \\(select 1 from public\\.suppliers as s where s\\.id = p_input ->> ''supplierId''\\) then\\s+raise exception using errcode = ''23503'', message = ''supplier not found''; end if;',
    E'if nullif(p_input ->> ''supplierId'', '''') is not null and not exists (select 1 from public.suppliers as s where s.id = p_input ->> ''supplierId'') then\n    raise exception using errcode = ''23503'', message = ''supplier not found''; end if;',
    'g'
  );
  function_definition := replace(
    function_definition,
    'p_input ->> ''storageLocationId'', p_input ->> ''supplierId'', nullif(p_input ->> ''shipmentId'', '''')',
    'nullif(p_input ->> ''storageLocationId'', ''''), nullif(p_input ->> ''supplierId'', ''''), nullif(p_input ->> ''shipmentId'', '''')'
  );

  if function_definition = original_definition
    or position('nullif(p_input ->> ''storageLocationId'', '''')' in function_definition) = 0
    or position('nullif(p_input ->> ''supplierId'', '''')' in function_definition) = 0 then
    raise exception 'bulk_intake_weapons definition did not match the expected version';
  end if;
  execute function_definition;
end
$$;

comment on column public.user_preferences.inventory_visible_columns is
  'Ordered inventory column keys visible for this authenticated application user.';

commit;
