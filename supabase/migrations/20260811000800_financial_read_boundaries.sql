begin;

drop policy if exists financial_staff_read on public.customers;
drop policy if exists financial_staff_read on public.invoices;
drop policy if exists financial_staff_read on public.payment_records;
drop policy if exists customer_sales_read on public.customers;
drop policy if exists scoped_invoice_read on public.invoices;
drop policy if exists scoped_payment_read on public.payment_records;

create policy customer_sales_read on public.customers
for select to authenticated
using (public.can_view_financials() or public.can_sell_inventory());

create policy scoped_invoice_read on public.invoices
for select to authenticated
using (public.can_view_financials() or employee_id = public.current_app_user_id());

create policy scoped_payment_read on public.payment_records
for select to authenticated
using (
  public.can_view_financials()
  or exists (
    select 1 from public.invoices as invoice
    where invoice.id = payment_records.invoice_id
      and invoice.employee_id = public.current_app_user_id()
  )
);

commit;
