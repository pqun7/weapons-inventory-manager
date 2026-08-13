begin;

create or replace function public.enrich_audit_event_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  inferred_type text;
  inferred_id text;
begin
  if new.user_name is null or btrim(new.user_name) = '' then
    select u.name into new.user_name from public.users u where u.id = new.user_id;
  end if;

  inferred_type := coalesce(
    nullif(safe_metadata ->> 'entityType', ''),
    case
      when safe_metadata ? 'invoiceId' then 'Invoice'
      when safe_metadata ? 'shipmentId' then 'Shipment'
      when safe_metadata ? 'weaponId' then 'Weapon'
      when safe_metadata ? 'customerId' then 'Customer'
      when safe_metadata ? 'supplierId' then 'Supplier'
      when safe_metadata ? 'importId' then 'ShipmentImport'
      when safe_metadata ? 'itemId' then initcap(nullif(safe_metadata ->> 'itemType', ''))
    end
  );
  inferred_id := coalesce(
    nullif(safe_metadata ->> 'entityId', ''),
    nullif(safe_metadata ->> 'invoiceId', ''),
    nullif(safe_metadata ->> 'shipmentId', ''),
    nullif(safe_metadata ->> 'weaponId', ''),
    nullif(safe_metadata ->> 'customerId', ''),
    nullif(safe_metadata ->> 'supplierId', ''),
    nullif(safe_metadata ->> 'importId', ''),
    nullif(safe_metadata ->> 'itemId', '')
  );

  new.entity_type := coalesce(nullif(btrim(new.entity_type), ''), inferred_type);
  new.entity_id := coalesce(nullif(btrim(new.entity_id), ''), inferred_id);
  new.entity_name := coalesce(
    nullif(btrim(new.entity_name), ''),
    nullif(safe_metadata ->> 'entityName', ''),
    nullif(safe_metadata ->> 'shipmentNumber', ''),
    nullif(safe_metadata ->> 'invoiceNumber', ''),
    nullif(safe_metadata ->> 'itemName', ''),
    nullif(safe_metadata ->> 'customerName', ''),
    nullif(safe_metadata ->> 'supplierName', '')
  );

  if new.entity_name is null and new.entity_id is not null then
    case lower(coalesce(new.entity_type, ''))
      when 'shipment' then
        select s.shipment_number into new.entity_name from public.shipments s where s.id = new.entity_id;
      when 'invoice' then
        select i.invoice_number into new.entity_name from public.invoices i where i.id = new.entity_id;
      when 'weapon' then
        select w.serial_number into new.entity_name from public.weapons w where w.id = new.entity_id;
      when 'customer' then
        select c.name into new.entity_name from public.customers c where c.id = new.entity_id;
      when 'supplier' then
        select s.name into new.entity_name from public.suppliers s where s.id = new.entity_id;
      when 'shipmentimport' then
        select si.file_name into new.entity_name from public.shipment_imports si where si.id = new.entity_id;
      else null;
    end case;
  end if;

  return new;
end
$$;

drop trigger if exists audit_logs_enrich_context on public.audit_logs;
create trigger audit_logs_enrich_context
before insert or update on public.audit_logs
for each row execute function public.enrich_audit_event_context();

-- Backfill existing visible records while preserving their original descriptions.
update public.audit_logs
set metadata = metadata
where is_visible
  and (user_name is null or entity_type is null or entity_id is null or entity_name is null);

commit;
