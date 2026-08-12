-- Keep all triggers enabled during restores. Application triggers explicitly
-- become no-ops in restore mode, while PostgreSQL constraint triggers continue
-- validating the snapshot throughout the transaction.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor_id text;
  actor_name text;
  before_row jsonb;
  after_row jsonb;
  row_id text;
begin
  if current_setting('weapon_store.restore_mode', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select u.id, u.name into actor_id, actor_name
  from public.users u where u.auth_user_id = auth.uid() limit 1;
  actor_id := coalesce(actor_id, 'SYSTEM');
  actor_name := coalesce(actor_name, 'System');
  before_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  after_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  if tg_table_name = 'users' then
    before_row := before_row - 'login_email' - 'activation_token_hash';
    after_row := after_row - 'login_email' - 'activation_token_hash';
  elsif tg_table_name = 'app_backups' then
    before_row := before_row - 'payload';
    after_row := after_row - 'payload';
  end if;
  row_id := coalesce(after_row ->> 'id', before_row ->> 'id', after_row ->> 'iso_code', before_row ->> 'iso_code', '');
  insert into public.audit_logs(
    id, timestamp, date, user_id, user_name, action_type, event_action,
    description, metadata, table_name, record_id, old_values, new_values
  ) values (
    gen_random_uuid()::text, now(), current_date, actor_id, actor_name,
    initcap(lower(tg_op)), tg_op,
    format('%s %s on %I', actor_name, lower(tg_op), tg_table_name),
    jsonb_build_object('table', tg_table_name, 'record_id', row_id),
    tg_table_name, row_id, before_row, after_row
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace function public.audit_customer_created()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if current_setting('weapon_store.restore_mode', true) = 'on' then return new; end if;
  perform public.write_audit_event('Intake', 'Customer created', jsonb_build_object(
    'entityType', 'Customer', 'entityId', new.id, 'entityName', new.name,
    'newValues', jsonb_build_object('name', new.name, 'phone', new.phone, 'email', new.email, 'address', new.address, 'isWholesaleBuyer', new.is_wholesale_buyer)
  ));
  return new;
end
$$;

create or replace function public.apply_receipt_current_cost()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  old_cost numeric; old_retail numeric; old_wholesale numeric; retail_mode text;
  wholesale_mode text; item_name text; settings_row public.system_settings%rowtype;
  currency_row public.currencies%rowtype; snapshot jsonb; new_retail numeric; new_wholesale numeric;
begin
  if current_setting('weapon_store.restore_mode', true) = 'on' then return new; end if;
  if new.transaction_type <> 'receipt' or new.unit_amount is null then return new; end if;
  select * into settings_row from public.system_settings where id = 1;
  select * into currency_row from public.currencies where iso_code = new.currency;
  snapshot := new.valuation;
  if new.item_type = 'accessory' then
    select price, retail_price, wholesale_price, retail_price_mode, wholesale_price_mode, name
    into old_cost, old_retail, old_wholesale, retail_mode, wholesale_mode, item_name
    from public.accessories where id = new.item_id for update;
  elsif new.item_type = 'ammunition' then
    select price, retail_price, wholesale_price, retail_price_mode, wholesale_price_mode, caliber
    into old_cost, old_retail, old_wholesale, retail_mode, wholesale_mode, item_name
    from public.ammunition where id = new.item_id for update;
  else
    return new;
  end if;
  if item_name is null then raise exception using errcode = 'P0002', message = 'inventory product not found'; end if;
  new_retail := case when retail_mode = 'auto' then round(least(new.unit_amount * (1 + settings_row.maximum_markup_percent / 100), new.unit_amount / (1 - settings_row.target_retail_margin_percent / 100)), currency_row.decimal_precision) else old_retail end;
  new_wholesale := case when wholesale_mode = 'auto' then round(least(new.unit_amount * (1 + settings_row.maximum_markup_percent / 100), new.unit_amount / (1 - settings_row.target_wholesale_margin_percent / 100)), currency_row.decimal_precision) else old_wholesale end;
  if new_retail < new.unit_amount or new_wholesale < new.unit_amount then raise exception using errcode = '23514', message = 'manual selling price is below the new final cost; update pricing before receiving stock'; end if;
  if new.item_type = 'accessory' then
    update public.accessories set price = new.unit_amount, price_currency = new.currency, price_valuation = snapshot,
      retail_price = new_retail, wholesale_price = new_wholesale,
      retail_price_valuation = public.money_valuation(new_retail, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      wholesale_price_valuation = public.money_valuation(new_wholesale, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource') where id = new.item_id;
  else
    update public.ammunition set price = new.unit_amount, price_currency = new.currency, price_valuation = snapshot,
      retail_price = new_retail, wholesale_price = new_wholesale,
      retail_price_valuation = public.money_valuation(new_retail, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource'),
      wholesale_price_valuation = public.money_valuation(new_wholesale, new.currency, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource') where id = new.item_id;
  end if;
  insert into public.inventory_cost_snapshots (product_type, product_id, shipment_id, shipment_item_id, original_amount, original_currency_code, original_exchange_rate, original_base_amount, product_costs_base_amount, shipment_costs_base_amount, final_landed_base_amount, base_currency_code, exchange_rate_date, rate_source, finalized_at, finalized_by)
  values (new.item_type, new.item_id, new.shipment_id, null, new.unit_amount, new.currency, (snapshot ->> 'exchangeRate')::numeric, (snapshot ->> 'accountingAmount')::numeric, 0, 0, (snapshot ->> 'accountingAmount')::numeric, snapshot ->> 'accountingCurrency', (snapshot ->> 'exchangeRateDate')::timestamptz, snapshot ->> 'rateSource', now(), new.created_by)
  on conflict (product_type, product_id) do update set shipment_id = excluded.shipment_id, shipment_item_id = null, original_amount = excluded.original_amount, original_currency_code = excluded.original_currency_code, original_exchange_rate = excluded.original_exchange_rate, original_base_amount = excluded.original_base_amount, product_costs_base_amount = 0, shipment_costs_base_amount = 0, final_landed_base_amount = excluded.final_landed_base_amount, base_currency_code = excluded.base_currency_code, exchange_rate_date = excluded.exchange_rate_date, rate_source = excluded.rate_source, finalized_at = now(), finalized_by = excluded.finalized_by;
  perform public.write_audit_event('StockAdjustment', 'Stock received and current cost updated', jsonb_build_object('entityType', initcap(new.item_type), 'entityId', new.item_id, 'entityName', item_name, 'reason', nullif(new.notes, ''), 'previousValues', jsonb_build_object('finalCost', old_cost, 'retailPrice', old_retail, 'wholesalePrice', old_wholesale), 'newValues', jsonb_build_object('finalCost', new.unit_amount, 'retailPrice', new_retail, 'wholesalePrice', new_wholesale, 'currency', new.currency), 'shipmentId', new.shipment_id, 'quantity', new.quantity_delta));
  return new;
end
$$;

create or replace function public.restore_system_backup(p_backup_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.users; selected_backup public.app_backups; safety_backup_id uuid;
  tables_payload jsonb; table_name text; restore_tables text[] := public.system_backup_tables();
  reverse_index integer; previous_auth_user_ids uuid[]; auth_record record;
begin
  select * into actor from public.users where auth_user_id = auth.uid() and is_active limit 1;
  if actor.id is null or actor.role <> 'Admin'::public.app_role then
    raise exception using errcode = '42501', message = 'Administrator role is required to restore the system';
  end if;
  select * into selected_backup from public.app_backups where id = p_backup_id for update;
  if selected_backup.id is null or selected_backup.scope <> 'system' or selected_backup.status <> 'completed' then
    raise exception using errcode = '22023', message = 'A completed system backup is required';
  end if;
  if coalesce((selected_backup.payload ->> 'format_version')::integer, 0) <> 1 then
    raise exception using errcode = '22023', message = 'Unsupported backup format';
  end if;
  perform pg_advisory_xact_lock(hashtext('weapon-store-system-restore'));
  safety_backup_id := public.create_system_backup('Automatic safety backup before restore ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'));
  update public.app_backups set status = 'restoring', error_message = null where id = p_backup_id;
  tables_payload := selected_backup.payload -> 'tables';
  select coalesce(array_agg(auth_user_id), '{}'::uuid[]) into previous_auth_user_ids
  from public.users where auth_user_id is not null;
  perform set_config('weapon_store.restore_mode', 'on', true);
  for reverse_index in reverse coalesce(array_upper(restore_tables, 1), 0)..coalesce(array_lower(restore_tables, 1), 1) loop
    table_name := restore_tables[reverse_index];
    if tables_payload ? table_name and to_regclass(format('public.%I', table_name)) is not null then
      execute format('delete from public.%I', table_name);
    end if;
  end loop;
  foreach table_name in array restore_tables loop
    if tables_payload ? table_name and to_regclass(format('public.%I', table_name)) is not null then
      execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', table_name, table_name)
      using tables_payload -> table_name;
    end if;
  end loop;
  for auth_record in
    select * from jsonb_to_recordset(selected_backup.payload -> 'auth_users') as restored_auth(
      id uuid, email varchar, encrypted_password varchar, email_confirmed_at timestamptz,
      raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean,
      banned_until timestamptz, deleted_at timestamptz)
  loop
    update auth.users set email = auth_record.email, encrypted_password = auth_record.encrypted_password,
      email_confirmed_at = auth_record.email_confirmed_at, raw_app_meta_data = auth_record.raw_app_meta_data,
      raw_user_meta_data = auth_record.raw_user_meta_data, is_super_admin = auth_record.is_super_admin,
      banned_until = auth_record.banned_until, deleted_at = auth_record.deleted_at, updated_at = now()
    where id = auth_record.id;
  end loop;
  update auth.users current_auth set banned_until = now() + interval '100 years', updated_at = now()
  where current_auth.id = any(previous_auth_user_ids) and not exists (
    select 1 from jsonb_array_elements(selected_backup.payload -> 'auth_users') restored
    where (restored ->> 'id')::uuid = current_auth.id);
  perform set_config('weapon_store.restore_mode', 'off', true);
  update public.app_backups set status = 'completed', restored_at = now(),
    restored_by = (select u.id from public.users u where u.id = actor.id), error_message = null
  where id = p_backup_id;
  insert into public.audit_logs(id, timestamp, date, user_id, user_name, action_type, event_action, description, metadata, table_name, record_id)
  values (gen_random_uuid()::text, now(), current_date, actor.id, actor.name, 'Backup', 'SYSTEM_RESTORE',
    actor.name || ' restored the complete system backup', jsonb_build_object('backup_id', p_backup_id, 'safety_backup_id', safety_backup_id),
    'app_backups', p_backup_id::text);
  return safety_backup_id;
exception when others then raise;
end
$$;

revoke all on function public.restore_system_backup(uuid) from public, anon;
grant execute on function public.restore_system_backup(uuid) to authenticated;
notify pgrst, 'reload schema';
