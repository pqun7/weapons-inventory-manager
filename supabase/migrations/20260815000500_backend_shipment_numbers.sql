begin;

do $$
declare
  definition text;
  patched text;
  old_validation text := 'if nullif(btrim(p_input ->> ''shipmentNumber''), '''') is null then raise exception using errcode = ''22023'', message = ''shipment number is required''; end if;';
  generated_validation text := $body$
  shipment_number := nullif(trim(both from (p_input ->> 'shipmentNumber')), '');
  if shipment_number is null then
    select 'SHP-' || extract(year from current_date)::integer::text
      || lpad((coalesce(max(substring(s.shipment_number from 9)::integer), 0) + 1)::text, 4, '0')
    into shipment_number
    from public.shipments as s
    where s.shipment_number ~ ('^SHP-' || extract(year from current_date)::integer::text || '[0-9]{4}$');
  end if;$body$;
begin
  select pg_get_functiondef('public.create_shipment(jsonb)'::regprocedure) into definition;
  patched := replace(definition, 'shipment_id text;', 'shipment_id text;' || E'\n  shipment_number text;');
  patched := replace(patched, old_validation, generated_validation);
  patched := replace(patched, 'btrim(p_input ->> ''shipmentNumber'')', 'shipment_number');
  if patched = definition or position(old_validation in patched) > 0 then
    raise exception 'create_shipment number generation patch did not match the installed function';
  end if;
  execute patched;
end
$$;

revoke all on function public.create_shipment(jsonb) from public, anon;
grant execute on function public.create_shipment(jsonb) to authenticated;

commit;
