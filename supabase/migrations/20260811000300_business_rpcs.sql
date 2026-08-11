begin;

create table public.business_id_counters (
  prefix text primary key,
  last_value bigint not null check (last_value >= 0)
);
alter table public.business_id_counters enable row level security;
create policy admin_counter_access on public.business_id_counters
for all to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

create or replace function public.next_business_id(prefix_value text, pad_length integer default 5)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  next_value bigint;
begin
  if prefix_value !~ '^[A-Z]{1,8}$' or pad_length not between 3 and 12 then
    raise exception using errcode = '22023', message = 'invalid business ID format';
  end if;

  insert into public.business_id_counters(prefix, last_value)
  values (prefix_value, 1)
  on conflict (prefix) do update
    set last_value = public.business_id_counters.last_value + 1
  returning last_value into next_value;

  return prefix_value || lpad(next_value::text, pad_length, '0');
end
$$;

create or replace function public.currency_snapshot(transaction_currency text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_currency varchar(3) := upper(btrim(transaction_currency));
  accounting_currency varchar(3);
  base_currency varchar(3);
  transaction_rate numeric(24, 10);
  accounting_rate numeric(24, 10);
  cross_rate numeric(24, 10);
  transaction_date timestamptz;
  accounting_date timestamptz;
  transaction_source text;
  accounting_source text;
  transaction_precision smallint;
begin
  select s.accounting_currency_code, s.rate_base_currency_code
  into accounting_currency, base_currency
  from public.system_settings as s
  where s.id = 1;

  if accounting_currency is null then
    raise exception using errcode = '23514', message = 'system currency settings are missing';
  end if;

  select c.decimal_precision,
         case when o.mode = 'manual' then o.manual_rate else c.last_known_rate end,
         case when normalized_currency = base_currency then now()
              when o.mode = 'manual' then o.updated_at else c.last_rate_updated_at end,
         case when normalized_currency = base_currency then 'default'
              when o.mode = 'manual' then 'manual' else 'cache' end
  into transaction_precision, transaction_rate, transaction_date, transaction_source
  from public.currencies as c
  left join public.exchange_rate_overrides as o on o.currency_code = c.iso_code
  where c.iso_code = normalized_currency and c.is_active;

  if transaction_rate is null or transaction_date is null then
    raise exception using errcode = '23514', message = 'transaction currency is inactive or has no trustworthy rate';
  end if;

  select case when o.mode = 'manual' then o.manual_rate else c.last_known_rate end,
         case when accounting_currency = base_currency then now()
              when o.mode = 'manual' then o.updated_at else c.last_rate_updated_at end,
         case when accounting_currency = base_currency then 'default'
              when o.mode = 'manual' then 'manual' else 'cache' end
  into accounting_rate, accounting_date, accounting_source
  from public.currencies as c
  left join public.exchange_rate_overrides as o on o.currency_code = c.iso_code
  where c.iso_code = accounting_currency and c.is_active;

  if accounting_rate is null or accounting_date is null then
    raise exception using errcode = '23514', message = 'accounting currency is inactive or has no trustworthy rate';
  end if;

  cross_rate := case
    when normalized_currency = accounting_currency then 1
    else transaction_rate / accounting_rate
  end;

  return jsonb_build_object(
    'transactionCurrency', normalized_currency,
    'accountingCurrency', accounting_currency,
    'exchangeRate', cross_rate,
    'exchangeRateDate', least(transaction_date, accounting_date),
    'rateSource', case
      when normalized_currency = accounting_currency then 'default'
      when transaction_source = 'manual' or accounting_source = 'manual' then 'manual'
      else 'cache'
    end,
    'transactionPrecision', transaction_precision
  );
end
$$;

create or replace function public.money_valuation(
  original_amount numeric,
  transaction_currency text,
  accounting_currency text,
  exchange_rate numeric,
  exchange_rate_date timestamptz,
  rate_source text
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'originalAmount', original_amount,
    'originalCurrency', transaction_currency,
    'accountingAmount', round(original_amount / exchange_rate, 4),
    'accountingCurrency', accounting_currency,
    'exchangeRate', exchange_rate,
    'exchangeRateDate', exchange_rate_date,
    'rateSource', rate_source
  )
$$;

create or replace function public.complete_sale(
  p_customer_id text,
  p_customer_name text,
  p_mode text,
  p_invoice_number text,
  p_line_items jsonb,
  p_total_original numeric,
  p_total_negotiated numeric,
  p_tax_amount numeric,
  p_due_date date,
  p_paid_amount numeric default 0,
  p_payment_method text default 'cash',
  p_currency text default null,
  p_attachments jsonb default '[]'::jsonb,
  p_notes text default '',
  p_sale_date date default current_date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  actor_name text;
  transaction_currency varchar(3);
  accounting_currency varchar(3);
  exchange_rate numeric(24, 10);
  exchange_rate_date timestamptz;
  rate_source text;
  transaction_precision integer;
  tax_percent numeric(7, 4);
  item jsonb;
  item_type text;
  item_id text;
  item_name text;
  item_quantity integer;
  requested_unit_price numeric(20, 4);
  authoritative_unit_price numeric(20, 4);
  list_valuation jsonb;
  current_status text;
  current_quantity integer;
  current_packages integer;
  current_loose integer;
  units_per_package integer;
  remaining_rounds integer;
  authoritative_original numeric(20, 4) := 0;
  requested_lines_total numeric(20, 4) := 0;
  canonical_items jsonb := '[]'::jsonb;
  weapon_ids jsonb := '[]'::jsonb;
  grand_total numeric(20, 4);
  balance_amount numeric(20, 4);
  invoice_status text;
  invoice_id text;
  payment_id text;
  inventory_transaction_id text;
  audit_id text;
  notification_id text;
begin
  if not public.can_sell_inventory() then
    raise exception using errcode = '42501', message = 'sale permission is required';
  end if;

  select u.id, u.name into actor_id, actor_name
  from public.users as u
  where u.auth_user_id = auth.uid() and u.is_active
  limit 1;

  if actor_id is null then
    raise exception using errcode = '42501', message = 'authenticated application user is required';
  end if;
  if nullif(btrim(p_invoice_number), '') is null then
    raise exception using errcode = '22023', message = 'invoice number is required';
  end if;
  if exists (select 1 from public.invoices as i where i.invoice_number = btrim(p_invoice_number)) then
    raise exception using errcode = '23505', message = 'invoice number already exists';
  end if;
  if not exists (select 1 from public.customers as c where c.id = p_customer_id) then
    raise exception using errcode = '23503', message = 'customer not found';
  end if;
  if p_mode not in ('Retail', 'Wholesale') then
    raise exception using errcode = '22023', message = 'invalid sale mode';
  end if;
  if jsonb_typeof(p_line_items) <> 'array' or jsonb_array_length(p_line_items) = 0 then
    raise exception using errcode = '22023', message = 'select at least one sale item';
  end if;
  if p_total_negotiated <= 0 or p_paid_amount < 0 or p_tax_amount < 0 then
    raise exception using errcode = '22023', message = 'invalid sale amount';
  end if;

  select coalesce(upper(btrim(p_currency)), s.currency_code), s.tax_percent
  into transaction_currency, tax_percent
  from public.system_settings as s
  where s.id = 1;

  select snapshot ->> 'accountingCurrency',
         (snapshot ->> 'exchangeRate')::numeric,
         (snapshot ->> 'exchangeRateDate')::timestamptz,
         snapshot ->> 'rateSource',
         (snapshot ->> 'transactionPrecision')::integer
  into accounting_currency, exchange_rate, exchange_rate_date, rate_source, transaction_precision
  from (select public.currency_snapshot(transaction_currency) as snapshot) as currency_data;

  for item in select value from jsonb_array_elements(p_line_items) loop
    item_type := item ->> 'itemType';
    item_id := item ->> 'itemId';
    item_name := coalesce(item ->> 'name', item_id);
    item_quantity := (item ->> 'quantity')::integer;
    requested_unit_price := (item ->> 'unitPrice')::numeric;

    if item_type not in ('weapon', 'accessory', 'ammunition')
       or nullif(item_id, '') is null
       or item_quantity <= 0
       or requested_unit_price < 0 then
      raise exception using errcode = '22023', message = 'invalid sale line item';
    end if;

    if item_type = 'weapon' then
      if item_quantity <> 1 then
        raise exception using errcode = '22023', message = 'serialized weapon quantity must be one';
      end if;
      select w.status,
             case when p_mode = 'Wholesale' then w.wholesale_price_valuation else w.retail_price_valuation end
      into current_status, list_valuation
      from public.weapons as w
      where w.id = item_id and w.deleted_at is null
      for update;
      if current_status is null then
        raise exception using errcode = 'P0002', message = 'weapon not found';
      end if;
      if current_status <> 'Available' then
        raise exception using errcode = '23514', message = format('weapon %s is not available for sale', item_id);
      end if;
      weapon_ids := weapon_ids || jsonb_build_array(item_id);
    elsif item_type = 'accessory' then
      select a.quantity, a.price_valuation into current_quantity, list_valuation
      from public.accessories as a where a.id = item_id for update;
      if current_quantity is null then
        raise exception using errcode = 'P0002', message = 'accessory not found';
      end if;
      if current_quantity < item_quantity then
        raise exception using errcode = '23514', message = format('insufficient accessory stock for %s', item_id);
      end if;
    else
      select a.full_packages, a.loose_rounds, a.units_per_package, a.price_valuation
      into current_packages, current_loose, units_per_package, list_valuation
      from public.ammunition as a where a.id = item_id for update;
      if units_per_package is null then
        raise exception using errcode = 'P0002', message = 'ammunition not found';
      end if;
      if (current_packages * units_per_package + current_loose) < item_quantity then
        raise exception using errcode = '23514', message = format('insufficient ammunition stock for %s', item_id);
      end if;
    end if;

    if list_valuation is null or (list_valuation ->> 'accountingAmount') is null then
      raise exception using errcode = '23514', message = format('item %s has no trustworthy price valuation', item_id);
    end if;
    if list_valuation ->> 'accountingCurrency' <> accounting_currency then
      raise exception using errcode = '23514', message = format('item %s uses a different accounting currency', item_id);
    end if;

    authoritative_unit_price := round(((list_valuation ->> 'accountingAmount')::numeric * exchange_rate), transaction_precision);
    if requested_unit_price - authoritative_unit_price > 0.01 then
      raise exception using errcode = '23514', message = format('unit price exceeds authoritative list price for %s', item_id);
    end if;

    authoritative_original := authoritative_original + authoritative_unit_price * item_quantity;
    requested_lines_total := requested_lines_total + requested_unit_price * item_quantity;
    canonical_items := canonical_items || jsonb_build_array(
      jsonb_build_object(
        'itemType', item_type,
        'itemId', item_id,
        'name', item_name,
        'quantity', item_quantity,
        'unitPrice', requested_unit_price,
        'total', round(requested_unit_price * item_quantity, transaction_precision)
      )
    );
  end loop;

  if abs(authoritative_original - p_total_original) > 0.01 then
    raise exception using errcode = '23514', message = 'original total does not match authoritative inventory prices';
  end if;
  if p_total_negotiated - requested_lines_total > 0.01 then
    raise exception using errcode = '23514', message = 'negotiated subtotal exceeds sale line totals';
  end if;
  if abs(round(p_total_negotiated * tax_percent / 100, transaction_precision) - p_tax_amount) > 0.01 then
    raise exception using errcode = '23514', message = 'tax amount does not match configured tax rate';
  end if;

  grand_total := round(p_total_negotiated + p_tax_amount, transaction_precision);
  if p_paid_amount - grand_total > 0.01 then
    raise exception using errcode = '23514', message = 'amount paid cannot exceed invoice total';
  end if;
  balance_amount := greatest(0, grand_total - p_paid_amount);
  if balance_amount > 0.01 and p_due_date is null then
    raise exception using errcode = '23514', message = 'due date is required for unpaid balance';
  end if;

  invoice_status := case
    when balance_amount <= 0.01 then 'Paid'
    when p_due_date < current_date then 'Overdue'
    else 'Pending'
  end;
  invoice_id := public.next_business_id('INV');

  for item in select value from jsonb_array_elements(canonical_items) loop
    item_type := item ->> 'itemType';
    item_id := item ->> 'itemId';
    item_quantity := (item ->> 'quantity')::integer;
    requested_unit_price := (item ->> 'unitPrice')::numeric;

    if item_type = 'weapon' then
      update public.weapons as w
      set status = 'Sold',
          actual_final_price = requested_unit_price,
          actual_final_price_valuation = public.money_valuation(requested_unit_price, transaction_currency, accounting_currency, exchange_rate, exchange_rate_date, rate_source),
          sale_price_valuation = public.money_valuation(requested_unit_price, transaction_currency, accounting_currency, exchange_rate, exchange_rate_date, rate_source),
          movement_history = w.movement_history || jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid()::text,
            'timestamp', now(),
            'fromStatus', 'Available',
            'toStatus', 'Sold',
            'userId', actor_id,
            'userName', actor_name,
            'reason', 'Sold via invoice ' || btrim(p_invoice_number)
          ))
      where w.id = item_id;
    elsif item_type = 'accessory' then
      update public.accessories as a set quantity = a.quantity - item_quantity where a.id = item_id;
    else
      select a.full_packages * a.units_per_package + a.loose_rounds - item_quantity, a.units_per_package
      into remaining_rounds, units_per_package
      from public.ammunition as a where a.id = item_id;
      update public.ammunition as a
      set full_packages = remaining_rounds / units_per_package,
          loose_rounds = remaining_rounds % units_per_package
      where a.id = item_id;
    end if;

    inventory_transaction_id := public.next_business_id('ITX');
    insert into public.inventory_transactions (
      id, item_type, item_id, transaction_type, quantity_delta, unit_amount,
      currency, valuation, shipment_id, notes, created_by, created_at
    ) values (
      inventory_transaction_id, item_type, item_id, 'sale', -item_quantity, requested_unit_price,
      transaction_currency,
      public.money_valuation(requested_unit_price, transaction_currency, accounting_currency, exchange_rate, exchange_rate_date, rate_source),
      null, 'Invoice ' || btrim(p_invoice_number), actor_id, now()
    );
  end loop;

  insert into public.invoices (
    id, invoice_number, type, customer_id, supplier_id, customer_name, date, due_date,
    total_original, total_negotiated, total_paid, balance, status, weapon_ids, line_items,
    sale_mode, employee_id, employee_name, attachments, shipment_id, notes, voided,
    tax_amount, total_valuation, currency, accounting_currency, exchange_rate,
    exchange_rate_date, rate_source, total_original_accounting,
    total_negotiated_accounting, total_paid_accounting, balance_accounting,
    tax_amount_accounting
  ) values (
    invoice_id, btrim(p_invoice_number), 'Sale', p_customer_id, null, btrim(p_customer_name),
    p_sale_date, coalesce(p_due_date, p_sale_date), authoritative_original, p_total_negotiated,
    p_paid_amount, balance_amount, invoice_status, weapon_ids, canonical_items, p_mode,
    actor_id, actor_name, coalesce(p_attachments, '[]'::jsonb), null, coalesce(p_notes, ''), false,
    p_tax_amount,
    public.money_valuation(grand_total, transaction_currency, accounting_currency, exchange_rate, exchange_rate_date, rate_source),
    transaction_currency, accounting_currency, exchange_rate, exchange_rate_date, rate_source,
    round(authoritative_original / exchange_rate, 4),
    round(p_total_negotiated / exchange_rate, 4),
    round(p_paid_amount / exchange_rate, 4),
    round(balance_amount / exchange_rate, 4),
    round(p_tax_amount / exchange_rate, 4)
  );

  if p_paid_amount > 0.01 then
    if p_payment_method not in ('cash', 'card', 'bank_transfer', 'check', 'other') then
      raise exception using errcode = '22023', message = 'invalid payment method';
    end if;
    payment_id := public.next_business_id('PAY');
    insert into public.payment_records (
      id, invoice_id, invoice_number, date, amount, currency, accounting_amount,
      accounting_currency, exchange_rate, exchange_rate_date, rate_source, rate_id,
      method, employee, notes
    ) values (
      payment_id, invoice_id, btrim(p_invoice_number), p_sale_date, p_paid_amount,
      transaction_currency, round(p_paid_amount / exchange_rate, 4), accounting_currency,
      exchange_rate, exchange_rate_date, rate_source, null, p_payment_method, actor_name,
      coalesce(nullif(btrim(p_notes), ''), 'Payment at sale')
    );
  end if;

  audit_id := public.next_business_id('LOG');
  insert into public.audit_logs (
    id, timestamp, date, user_id, action_type, description, metadata
  ) values (
    audit_id, now(), current_date, actor_id, 'Sale',
    format('Sale completed - Invoice %s - %s', btrim(p_invoice_number), btrim(p_customer_name)),
    jsonb_build_object('invoiceId', invoice_id, 'invoiceNumber', btrim(p_invoice_number), 'total', grand_total, 'currency', transaction_currency)
  );

  return jsonb_build_object('invoiceId', invoice_id, 'invoiceNumber', btrim(p_invoice_number));
end
$$;

create or replace function public.register_payment(
  p_invoice_id text,
  p_amount numeric,
  p_currency text,
  p_method text,
  p_notes text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  actor_name text;
  invoice_row record;
  snapshot jsonb;
  payment_currency varchar(3);
  payment_accounting_amount numeric(20, 4);
  applied_invoice_amount numeric(20, 4);
  new_balance numeric(20, 4);
  new_accounting_balance numeric(20, 4);
  payment_id text;
  audit_id text;
  notification_id text;
begin
  if not public.has_app_permission('canRegisterPayments') then
    raise exception using errcode = '42501', message = 'payment permission is required';
  end if;
  if p_amount <= 0 or p_method not in ('cash', 'card', 'bank_transfer', 'check', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment';
  end if;

  select u.id, u.name into actor_id, actor_name
  from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;

  select i.id, i.invoice_number, i.currency, i.accounting_currency, i.exchange_rate,
         i.balance, i.balance_accounting, i.total_paid, i.total_paid_accounting,
         i.due_date, i.voided
  into invoice_row
  from public.invoices as i
  where i.id = p_invoice_id
  for update;

  if invoice_row.id is null then
    raise exception using errcode = 'P0002', message = 'invoice not found';
  end if;
  if invoice_row.voided then
    raise exception using errcode = '23514', message = 'cannot pay a voided invoice';
  end if;
  if invoice_row.balance <= 0 then
    raise exception using errcode = '23514', message = 'invoice is already fully paid';
  end if;

  payment_currency := coalesce(upper(nullif(btrim(p_currency), '')), invoice_row.currency);
  snapshot := public.currency_snapshot(payment_currency);
  if snapshot ->> 'accountingCurrency' <> invoice_row.accounting_currency then
    raise exception using errcode = '23514', message = 'payment and invoice accounting currencies do not match';
  end if;

  payment_accounting_amount := round(p_amount / (snapshot ->> 'exchangeRate')::numeric, 4);
  if payment_accounting_amount - invoice_row.balance_accounting > 0.0001 then
    raise exception using errcode = '23514', message = 'payment amount exceeds remaining invoice balance';
  end if;
  applied_invoice_amount := round(payment_accounting_amount * invoice_row.exchange_rate, 4);
  new_accounting_balance := greatest(0, invoice_row.balance_accounting - payment_accounting_amount);
  new_balance := greatest(0, invoice_row.balance - applied_invoice_amount);

  payment_id := public.next_business_id('PAY');
  insert into public.payment_records (
    id, invoice_id, invoice_number, date, amount, currency, accounting_amount,
    accounting_currency, exchange_rate, exchange_rate_date, rate_source, rate_id,
    method, employee, notes
  ) values (
    payment_id, invoice_row.id, invoice_row.invoice_number, current_date, p_amount,
    payment_currency, payment_accounting_amount, invoice_row.accounting_currency,
    (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz,
    snapshot ->> 'rateSource', null, p_method, actor_name, coalesce(p_notes, '')
  );

  update public.invoices as i
  set total_paid = i.total_paid + applied_invoice_amount,
      balance = case when new_accounting_balance <= 0.0001 then 0 else new_balance end,
      total_paid_accounting = i.total_paid_accounting + payment_accounting_amount,
      balance_accounting = case when new_accounting_balance <= 0.0001 then 0 else new_accounting_balance end,
      status = case
        when new_accounting_balance <= 0.0001 then 'Paid'
        when i.due_date < current_date then 'Overdue'
        else 'Pending'
      end
  where i.id = invoice_row.id;

  audit_id := public.next_business_id('LOG');
  insert into public.audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
  values (
    audit_id, now(), current_date, actor_id, 'Payment',
    'Payment registered for invoice ' || invoice_row.invoice_number,
    jsonb_build_object('paymentId', payment_id, 'invoiceId', invoice_row.id, 'amount', p_amount, 'currency', payment_currency, 'newBalance', new_balance)
  );

  if new_accounting_balance <= 0.0001 then
    notification_id := public.next_business_id('NTF');
    insert into public.app_notifications (id, type, title, message, date, is_read, entity_id, user_id)
    values (notification_id, 'System', 'Debt Fully Settled', 'Invoice ' || invoice_row.invoice_number || ' has been fully paid', current_date, false, invoice_row.id, actor_id);
  end if;

  return jsonb_build_object('newBalance', case when new_accounting_balance <= 0.0001 then 0 else new_balance end, 'accountingBalance', new_accounting_balance);
end
$$;

create or replace function public.update_weapon_status(
  p_weapon_id text,
  p_status text,
  p_reason text default ''
)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  actor_name text;
  previous_status text;
begin
  if not public.can_change_inventory() then
    raise exception using errcode = '42501', message = 'inventory permission is required';
  end if;
  if p_status not in ('Available', 'Reserved') then
    raise exception using errcode = '23514', message = 'sold and returned statuses require their dedicated financial workflows';
  end if;
  select u.id, u.name into actor_id, actor_name
  from public.users as u where u.auth_user_id = auth.uid() and u.is_active limit 1;
  select w.status into previous_status from public.weapons as w where w.id = p_weapon_id for update;
  if previous_status is null then raise exception using errcode = 'P0002', message = 'weapon not found'; end if;
  if previous_status = 'Sold' then raise exception using errcode = '23514', message = 'a sold weapon requires the return workflow'; end if;
  update public.weapons as w
  set status = p_status,
      movement_history = w.movement_history || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'timestamp', now(),
        'fromStatus', previous_status,
        'toStatus', p_status,
        'userId', actor_id,
        'userName', actor_name,
        'reason', coalesce(p_reason, '')
      ))
  where w.id = p_weapon_id;
end
$$;

revoke all on function public.next_business_id(text, integer) from public, anon, authenticated;
revoke all on function public.currency_snapshot(text) from public, anon;
revoke all on function public.money_valuation(numeric, text, text, numeric, timestamptz, text) from public, anon, authenticated;
revoke all on function public.complete_sale(text, text, text, text, jsonb, numeric, numeric, numeric, date, numeric, text, text, jsonb, text, date) from public, anon;
revoke all on function public.register_payment(text, numeric, text, text, text) from public, anon;
revoke all on function public.update_weapon_status(text, text, text) from public, anon;
grant execute on function public.currency_snapshot(text) to authenticated;
grant execute on function public.complete_sale(text, text, text, text, jsonb, numeric, numeric, numeric, date, numeric, text, text, jsonb, text, date) to authenticated;
grant execute on function public.register_payment(text, numeric, text, text, text) to authenticated;
grant execute on function public.update_weapon_status(text, text, text) to authenticated;

grant insert, update, delete on all tables in schema public to authenticated;

create policy staff_customer_insert on public.customers
for insert to authenticated with check (public.can_sell_inventory());
create policy staff_customer_update on public.customers
for update to authenticated using (public.can_sell_inventory()) with check (public.can_sell_inventory());

create policy shipment_supplier_insert on public.suppliers
for insert to authenticated with check (public.can_manage_shipments());
create policy shipment_supplier_update on public.suppliers
for update to authenticated using (public.can_manage_shipments()) with check (public.can_manage_shipments());

create policy inventory_weapon_insert on public.weapons
for insert to authenticated
with check (public.can_change_inventory() and status in ('Available', 'Returned') and deleted_at is null);
create policy inventory_accessory_insert on public.accessories
for insert to authenticated with check (public.can_change_inventory());
create policy inventory_accessory_update on public.accessories
for update to authenticated using (public.can_change_inventory()) with check (public.can_change_inventory());
create policy inventory_ammunition_insert on public.ammunition
for insert to authenticated with check (public.can_change_inventory());
create policy inventory_ammunition_update on public.ammunition
for update to authenticated using (public.can_change_inventory()) with check (public.can_change_inventory());

create policy own_audit_insert on public.audit_logs
for insert to authenticated
with check (user_id = public.current_app_user_id());
create policy staff_notification_insert on public.app_notifications
for insert to authenticated
with check (public.current_app_user_id() is not null and (user_id is null or user_id = public.current_app_user_id()));

commit;
