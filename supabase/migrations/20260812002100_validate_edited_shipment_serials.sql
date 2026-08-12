begin;

do $$
declare
  definition text;
  patched text;
  marker text := '  select coalesce(sum((line.value ->> ''quantity'')::integer), 0) into next_total';
  validation text := $validation$
  if exists (
    select 1
    from jsonb_array_elements(next_lines) as line(value)
    cross join lateral jsonb_array_elements_text(coalesce(line.value -> 'serialNumbers', '[]'::jsonb)) as serial(value)
    where line.value ->> 'productType' = 'weapon'
    group by upper(btrim(serial.value))
    having count(*) > 1
  ) then raise exception using errcode = '23505', message = 'duplicate serial number inside shipment'; end if;
  if exists (
    select 1
    from jsonb_array_elements(next_lines) as line(value)
    cross join lateral jsonb_array_elements_text(coalesce(line.value -> 'serialNumbers', '[]'::jsonb)) as serial(value)
    join public.weapons as w on upper(w.serial_number) = upper(btrim(serial.value)) and w.deleted_at is null
    where line.value ->> 'productType' = 'weapon'
  ) then raise exception using errcode = '23505', message = 'shipment contains an existing weapon serial number'; end if;
  $validation$;
begin
  select pg_get_functiondef('public.update_scheduled_shipment(text,jsonb)'::regprocedure) into definition;
  patched := replace(definition, marker, validation || marker);
  if patched = definition then
    raise exception 'update_scheduled_shipment serial validation patch did not match';
  end if;
  execute patched;
end
$$;

revoke all on function public.update_scheduled_shipment(text, jsonb) from public, anon;
grant execute on function public.update_scheduled_shipment(text, jsonb) to authenticated;

commit;
