begin;

create table if not exists public.sale_operation_receipts (
  operation_id uuid primary key,
  request_hash text not null,
  invoice_id text not null references public.invoices(id) on delete restrict,
  invoice_number text not null,
  created_at timestamptz not null default now()
);

alter table public.sale_operation_receipts enable row level security;
revoke all on public.sale_operation_receipts from public, anon, authenticated;

create or replace function public.complete_sale_v2(
  p_operation_id uuid,
  p_customer_id text,
  p_new_customer jsonb,
  p_mode text,
  p_invoice_number text,
  p_line_items jsonb,
  p_total_original numeric,
  p_total_negotiated numeric,
  p_tax_amount numeric,
  p_due_date date,
  p_paid_amount numeric,
  p_payment_method text,
  p_currency text,
  p_attachments jsonb,
  p_notes text,
  p_sale_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  request_hash text;
  receipt public.sale_operation_receipts%rowtype;
  resolved_customer public.customers%rowtype;
  draft_name text;
  draft_email text;
  draft_phone text;
  draft_discount numeric;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'sale operation ID is required';
  end if;

  request_hash := md5(jsonb_build_object(
    'customerId', p_customer_id,
    'newCustomer', coalesce(p_new_customer, 'null'::jsonb),
    'mode', p_mode,
    'invoiceNumber', p_invoice_number,
    'lineItems', p_line_items,
    'totalOriginal', p_total_original,
    'totalNegotiated', p_total_negotiated,
    'taxAmount', p_tax_amount,
    'dueDate', p_due_date,
    'paidAmount', p_paid_amount,
    'paymentMethod', p_payment_method,
    'currency', p_currency,
    'attachments', p_attachments,
    'notes', p_notes,
    'saleDate', p_sale_date
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into receipt
  from public.sale_operation_receipts
  where operation_id = p_operation_id;

  if found then
    if receipt.request_hash <> request_hash then
      raise exception using errcode = '23505', message = 'sale operation ID was already used for a different request';
    end if;
    return jsonb_build_object('invoiceId', receipt.invoice_id, 'invoiceNumber', receipt.invoice_number);
  end if;

  if nullif(btrim(coalesce(p_customer_id, '')), '') is not null then
    select * into resolved_customer from public.customers where id = p_customer_id;
    if not found then
      raise exception using errcode = '23503', message = 'customer not found';
    end if;
  else
    if p_new_customer is null or jsonb_typeof(p_new_customer) <> 'object' then
      raise exception using errcode = '22023', message = 'customer is required';
    end if;
    draft_name := regexp_replace(btrim(coalesce(p_new_customer ->> 'name', '')), '\s+', ' ', 'g');
    draft_email := lower(btrim(coalesce(p_new_customer ->> 'email', '')));
    draft_phone := regexp_replace(coalesce(p_new_customer ->> 'phone', ''), '[^0-9]', '', 'g');
    draft_discount := coalesce((p_new_customer ->> 'wholesaleDiscountPercent')::numeric, 0);
    if draft_name = '' then
      raise exception using errcode = '22023', message = 'customer name is required';
    end if;
    if draft_discount < 0 or draft_discount > 100 then
      raise exception using errcode = '22023', message = 'wholesale discount must be between 0 and 100';
    end if;

    -- Different checkout operation IDs for the same new buyer still serialize
    -- on the buyer identity, preventing duplicate customer rows.
    perform pg_advisory_xact_lock(hashtextextended(
      case when draft_email <> '' then 'email:' || draft_email
           when draft_phone <> '' then 'phone:' || draft_phone
           else 'name:' || lower(draft_name) end,
      1
    ));

    select * into resolved_customer
    from public.customers as c
    where (draft_email <> '' and lower(btrim(c.email)) = draft_email)
       or (draft_phone <> '' and regexp_replace(c.phone, '[^0-9]', '', 'g') = draft_phone)
       or (draft_email = '' and draft_phone = '' and lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(draft_name))
    order by c.date_added, c.id
    limit 1
    for update;

    if not found then
      insert into public.customers (
        id, name, phone, email, address, is_wholesale_buyer,
        wholesale_discount_percent, date_added
      ) values (
        public.next_business_id('CUST'), draft_name,
        btrim(coalesce(p_new_customer ->> 'phone', '')), draft_email,
        btrim(coalesce(p_new_customer ->> 'address', '')),
        coalesce((p_new_customer ->> 'isWholesaleBuyer')::boolean, false),
        draft_discount, current_date
      ) returning * into resolved_customer;
    end if;
  end if;

  result := public.complete_sale(
    resolved_customer.id,
    resolved_customer.name,
    p_mode,
    p_invoice_number,
    p_line_items,
    p_total_original,
    p_total_negotiated,
    p_tax_amount,
    p_due_date,
    p_paid_amount,
    p_payment_method,
    p_currency,
    p_attachments,
    p_notes,
    p_sale_date
  );

  insert into public.sale_operation_receipts (
    operation_id, request_hash, invoice_id, invoice_number
  ) values (
    p_operation_id, request_hash, result ->> 'invoiceId', result ->> 'invoiceNumber'
  );

  return result;
end;
$$;

revoke all on function public.complete_sale_v2(uuid, text, jsonb, text, text, jsonb, numeric, numeric, numeric, date, numeric, text, text, jsonb, text, date) from public, anon;
grant execute on function public.complete_sale_v2(uuid, text, jsonb, text, text, jsonb, numeric, numeric, numeric, date, numeric, text, text, jsonb, text, date) to authenticated;

commit;
