begin;

do $$
declare
  definition text := pg_get_functiondef('public.bulk_intake_weapons(jsonb)'::regprocedure);
  loop_marker text := 'for serial_value in select value #>> ''{}'' from jsonb_array_elements(p_input -> ''serialNumbers'') loop';
  validation_block text := $validation$
  if exists (
    select 1
    from (
      select upper(btrim(serial_item.value #>> '{}')) as normalized_value, count(*) as input_count
      from jsonb_array_elements(p_input -> 'serialNumbers') as serial_item(value)
      group by upper(btrim(serial_item.value #>> '{}'))
    ) as submitted
    left join public.weapons as existing
      on upper(existing.serial_number) = submitted.normalized_value
    where submitted.normalized_value = '' or submitted.input_count > 1 or existing.id is not null
  ) then
    raise exception using errcode = '23505', message = 'duplicate serial detected; no weapons were added';
  end if;

  for serial_value in select value #>> '{}' from jsonb_array_elements(p_input -> 'serialNumbers') loop$validation$;
begin
  if position(loop_marker in definition) = 0 then
    raise exception 'bulk_intake_weapons loop marker was not found';
  end if;
  definition := replace(definition, loop_marker, validation_block);
  execute definition;
end
$$;

commit;
