begin;

create or replace function public.business_id_exists(p_prefix text, p_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return case p_prefix
    when 'INV' then exists (select 1 from public.invoices as invoice where invoice.id = p_id)
    when 'ITX' then exists (select 1 from public.inventory_transactions as transaction where transaction.id = p_id)
    when 'PAY' then exists (select 1 from public.payment_records as payment where payment.id = p_id)
    when 'LOG' then exists (select 1 from public.audit_logs as audit where audit.id = p_id)
    when 'NTF' then exists (select 1 from public.app_notifications as notification where notification.id = p_id)
    when 'W' then exists (select 1 from public.weapons as weapon where weapon.id = p_id)
    when 'ACC' then exists (select 1 from public.accessories as accessory where accessory.id = p_id)
    when 'AMM' then exists (select 1 from public.ammunition as ammunition where ammunition.id = p_id)
    when 'SHP' then exists (select 1 from public.shipments as shipment where shipment.id = p_id)
    when 'PC' then exists (select 1 from public.product_costs as product_cost where product_cost.id = p_id)
    when 'SLI' then exists (select 1 from public.shipment_items as shipment_item where shipment_item.id = p_id)
    when 'SC' then exists (select 1 from public.shipment_costs as shipment_cost where shipment_cost.id = p_id)
    when 'SCA' then exists (select 1 from public.shipment_cost_allocations as allocation where allocation.id = p_id)
    else null
  end;
end
$$;

commit;
