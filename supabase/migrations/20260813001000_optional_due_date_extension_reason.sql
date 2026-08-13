begin;

create or replace function public.extend_invoice_due_date(
  p_invoice_id text,
  p_new_due_date date,
  p_reason text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  actor_id text;
  invoice_number_value text;
  invoice_voided boolean;
  invoice_balance numeric;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if not public.has_app_permission('canExtendDueDates') then
    raise exception using errcode = '42501', message = 'due-date extension permission is required';
  end if;

  select u.id
  into actor_id
  from public.users as u
  where u.auth_user_id = auth.uid() and u.is_active
  limit 1;

  select i.invoice_number, i.voided, i.balance
  into invoice_number_value, invoice_voided, invoice_balance
  from public.invoices as i
  where i.id = p_invoice_id
  for update;

  if invoice_number_value is null then
    raise exception using errcode = 'P0002', message = 'invoice not found';
  end if;
  if invoice_voided then
    raise exception using errcode = '23514', message = 'cannot extend a voided invoice';
  end if;

  update public.invoices
  set due_date = p_new_due_date,
      status = case
        when invoice_balance <= 0.01 then 'Paid'
        when p_new_due_date < current_date then 'Overdue'
        else 'Pending'
      end
  where id = p_invoice_id;

  insert into public.audit_logs (
    id, timestamp, date, user_id, action_type, description, metadata
  )
  values (
    public.next_business_id('LOG'),
    now(),
    current_date,
    actor_id,
    'DueDateExtension',
    'Due date extended for invoice ' || invoice_number_value,
    jsonb_strip_nulls(jsonb_build_object(
      'invoiceId', p_invoice_id,
      'newDueDate', p_new_due_date,
      'reason', normalized_reason
    ))
  );
end
$$;

revoke all on function public.extend_invoice_due_date(text, date, text) from public, anon;
grant execute on function public.extend_invoice_due_date(text, date, text) to authenticated;

commit;
