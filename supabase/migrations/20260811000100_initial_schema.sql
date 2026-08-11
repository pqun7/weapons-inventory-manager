begin;

create extension if not exists pgcrypto with schema extensions;

create table public.weapon_types (
  id text primary key,
  label text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.weapon_subtypes (
  id text primary key,
  weapon_type_id text not null references public.weapon_types(id) on delete restrict,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (weapon_type_id, label),
  unique (weapon_type_id, id)
);

create table public.calibers (
  id text primary key,
  label text not null unique,
  created_at timestamptz not null default now()
);

create table public.subtype_calibers (
  subtype_id text not null references public.weapon_subtypes(id) on delete restrict,
  caliber_id text not null references public.calibers(id) on delete restrict,
  primary key (subtype_id, caliber_id)
);

create table public.brands (
  id text primary key,
  label text not null unique,
  created_at timestamptz not null default now()
);

create table public.models (
  id text primary key,
  label text not null,
  brand_id text not null references public.brands(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (label, brand_id),
  unique (brand_id, id)
);

create table public.warehouses (
  id text primary key,
  label text not null unique,
  created_at timestamptz not null default now()
);

create table public.storage_locations (
  id text primary key,
  warehouse_id text not null references public.warehouses(id) on delete restrict,
  shelf text not null,
  bin text not null default '',
  created_at timestamptz not null default now(),
  unique (warehouse_id, shelf, bin)
);

create table public.currencies (
  iso_code varchar(3) primary key check (iso_code ~ '^[A-Z]{3}$'),
  name text not null,
  symbol text not null,
  decimal_precision smallint not null default 2 check (decimal_precision between 0 and 4),
  is_active boolean not null default true,
  last_known_rate numeric(24, 10) not null default 1 check (last_known_rate > 0),
  last_rate_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.exchange_rate_history (
  id text primary key,
  currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  rate numeric(24, 10) not null check (rate > 0),
  source text not null default 'api' check (source in ('manual', 'api', 'cache', 'default')),
  fetched_at timestamptz not null default now()
);

create table public.exchange_rate_overrides (
  currency_code varchar(3) primary key references public.currencies(iso_code) on delete restrict,
  mode text not null default 'automatic' check (mode in ('automatic', 'manual')),
  manual_rate numeric(24, 10),
  updated_by text,
  updated_at timestamptz not null default now(),
  reason text,
  check (mode <> 'manual' or (manual_rate is not null and manual_rate > 0))
);

create table public.exchange_rate_audit_log (
  id text primary key,
  currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  old_rate numeric(24, 10),
  new_rate numeric(24, 10),
  changed_by text,
  changed_at timestamptz not null default now(),
  reason text,
  source text not null default 'manual' check (source in ('manual', 'api', 'cache', 'default'))
);

create table public.users (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  username text not null unique,
  name text not null,
  role text not null default 'Read-Only' check (role in ('Admin', 'Employee', 'Manager', 'Sales', 'Inventory', 'Accountant', 'Read-Only')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  password_set boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suppliers (
  id text primary key,
  name text not null,
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  date_added date not null
);

create table public.customers (
  id text primary key,
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  is_wholesale_buyer boolean not null default false,
  wholesale_discount_percent numeric(7, 4) not null default 0 check (wholesale_discount_percent between 0 and 100),
  date_added date not null
);

create table public.shipments (
  id text primary key,
  shipment_number text not null unique,
  supplier_id text references public.suppliers(id) on delete restrict,
  shipment_date date not null,
  expected_arrival_date date not null,
  total_expected_items integer not null default 0 check (total_expected_items >= 0),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  notes text not null default '',
  status text not null default 'Pending' check (status in ('Pending', 'In Transit', 'Delayed', 'Arrived', 'Cancelled', 'Partial')),
  timeline jsonb not null default '[]'::jsonb check (jsonb_typeof(timeline) = 'array'),
  purchase_order_number text,
  invoice_number text,
  shipping_carrier text,
  container_number text,
  currency varchar(3) references public.currencies(iso_code) on delete restrict,
  purchase_date date,
  actual_arrival_date date,
  line_items jsonb not null default '[]'::jsonb check (jsonb_typeof(line_items) = 'array'),
  documents jsonb not null default '[]'::jsonb check (jsonb_typeof(documents) = 'array'),
  total_cost_valuation jsonb,
  workflow_status text not null default 'draft' check (workflow_status in ('draft', 'processing', 'pending_review', 'scheduled', 'arrived', 'received', 'failed', 'cancelled')),
  import_id text,
  arrival_note text,
  delay_reason text,
  last_arrival_prompt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.weapons (
  id text primary key,
  serial_number text not null unique,
  weapon_type_id text not null,
  weapon_subtype_id text not null,
  brand_id text not null,
  model_id text not null,
  caliber_id text not null,
  storage_location_id text references public.storage_locations(id) on delete set null,
  supplier_id text references public.suppliers(id) on delete set null,
  shipment_id text references public.shipments(id) on delete set null,
  condition text not null default 'Excellent' check (condition in ('Excellent', 'Good', 'Fair', 'Poor')),
  status text not null default 'Available' check (status in ('Available', 'Reserved', 'Sold', 'Returned')),
  purchase_price numeric(20, 4) not null default 0 check (purchase_price >= 0),
  retail_price numeric(20, 4) not null default 0 check (retail_price >= 0),
  wholesale_price numeric(20, 4) not null default 0 check (wholesale_price >= 0),
  actual_final_price numeric(20, 4) check (actual_final_price is null or actual_final_price >= 0),
  date_added date not null,
  batch_id text,
  notes text not null default '',
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  movement_history jsonb not null default '[]'::jsonb check (jsonb_typeof(movement_history) = 'array'),
  purchase_price_valuation jsonb not null,
  retail_price_valuation jsonb not null,
  wholesale_price_valuation jsonb not null,
  actual_final_price_valuation jsonb,
  sale_price_valuation jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (weapon_type_id, weapon_subtype_id) references public.weapon_subtypes(weapon_type_id, id) on delete restrict,
  foreign key (weapon_subtype_id, caliber_id) references public.subtype_calibers(subtype_id, caliber_id) on delete restrict,
  foreign key (brand_id, model_id) references public.models(brand_id, id) on delete restrict
);

create table public.invoices (
  id text primary key,
  invoice_number text not null unique,
  type text not null default 'Sale' check (type in ('Sale', 'Purchase')),
  customer_id text references public.customers(id) on delete restrict,
  supplier_id text references public.suppliers(id) on delete restrict,
  customer_name text not null default '',
  date date not null,
  due_date date not null,
  total_original numeric(20, 4) not null default 0 check (total_original >= 0),
  total_negotiated numeric(20, 4) not null default 0 check (total_negotiated >= 0),
  total_paid numeric(20, 4) not null default 0 check (total_paid >= 0),
  balance numeric(20, 4) not null default 0 check (balance >= 0),
  status text not null default 'Pending' check (status in ('Pending', 'Overdue', 'Paid', 'Void')),
  weapon_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(weapon_ids) = 'array'),
  line_items jsonb not null default '[]'::jsonb check (jsonb_typeof(line_items) = 'array'),
  sale_mode text not null default 'Retail' check (sale_mode in ('Retail', 'Wholesale')),
  employee_id text not null references public.users(id) on delete restrict,
  employee_name text not null default '',
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  shipment_id text references public.shipments(id) on delete set null,
  notes text not null default '',
  voided boolean not null default false,
  tax_amount numeric(20, 4) not null default 0 check (tax_amount >= 0),
  total_valuation jsonb,
  currency varchar(3) not null references public.currencies(iso_code) on delete restrict,
  accounting_currency varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate numeric(24, 10) not null check (exchange_rate > 0),
  exchange_rate_date timestamptz not null,
  rate_source text not null check (rate_source in ('manual', 'api', 'cache', 'default')),
  total_original_accounting numeric(20, 4) not null check (total_original_accounting >= 0),
  total_negotiated_accounting numeric(20, 4) not null check (total_negotiated_accounting >= 0),
  total_paid_accounting numeric(20, 4) not null check (total_paid_accounting >= 0),
  balance_accounting numeric(20, 4) not null check (balance_accounting >= 0),
  tax_amount_accounting numeric(20, 4) not null check (tax_amount_accounting >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((type = 'Sale' and customer_id is not null) or (type = 'Purchase' and supplier_id is not null))
);

create table public.payment_records (
  id text primary key,
  invoice_id text not null references public.invoices(id) on delete restrict,
  invoice_number text not null,
  date date not null,
  amount numeric(20, 4) not null check (amount > 0),
  currency varchar(3) not null references public.currencies(iso_code) on delete restrict,
  accounting_amount numeric(20, 4) not null check (accounting_amount > 0),
  accounting_currency varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate numeric(24, 10) not null check (exchange_rate > 0),
  exchange_rate_date timestamptz not null,
  rate_source text not null check (rate_source in ('manual', 'api', 'cache', 'default')),
  rate_id text,
  method text not null default 'cash' check (method in ('cash', 'card', 'bank_transfer', 'check', 'other')),
  employee text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.accessories (
  id text primary key,
  name text not null,
  type text not null default '',
  quantity integer not null default 0 check (quantity >= 0),
  safety_threshold integer not null default 10 check (safety_threshold >= 0),
  price numeric(20, 4) not null default 0 check (price >= 0),
  price_currency varchar(3) not null references public.currencies(iso_code) on delete restrict,
  price_valuation jsonb not null,
  date_added date not null,
  warehouse text not null default '',
  shelf text not null default '',
  bin text not null default '',
  updated_at timestamptz not null default now()
);

create table public.ammunition (
  id text primary key,
  name text not null default '',
  caliber text not null,
  package_type text not null default 'Box' check (package_type in ('Carton', 'Box', 'Case', 'Custom')),
  units_per_package integer not null default 1 check (units_per_package > 0),
  full_packages integer not null default 0 check (full_packages >= 0),
  loose_rounds integer not null default 0 check (loose_rounds >= 0),
  safety_threshold integer not null default 100 check (safety_threshold >= 0),
  price numeric(20, 4) not null default 0 check (price >= 0),
  price_currency varchar(3) not null references public.currencies(iso_code) on delete restrict,
  price_valuation jsonb not null,
  date_added date not null,
  warehouse text not null default '',
  shelf text not null default '',
  bin text not null default '',
  updated_at timestamptz not null default now()
);

create table public.ammunition_weapon_compatibility (
  ammunition_id text not null references public.ammunition(id) on delete cascade,
  weapon_id text not null references public.weapons(id) on delete restrict,
  primary key (ammunition_id, weapon_id)
);

create table public.accessory_weapon_compatibility (
  accessory_id text not null references public.accessories(id) on delete cascade,
  weapon_id text not null references public.weapons(id) on delete restrict,
  primary key (accessory_id, weapon_id)
);

create table public.audit_logs (
  id text primary key,
  timestamp timestamptz not null,
  date date not null,
  user_id text not null,
  action_type text not null default 'Update',
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table public.app_notifications (
  id text primary key,
  type text not null default 'System',
  title text not null default '',
  message text not null default '',
  date date not null,
  is_read boolean not null default false,
  entity_id text,
  user_id text references public.users(id) on delete cascade
);

create table public.system_settings (
  id smallint primary key default 1 check (id = 1),
  currency_symbol text not null default '$',
  currency_code varchar(3) not null default 'USD' references public.currencies(iso_code) on delete restrict,
  accounting_currency_code varchar(3) not null default 'USD' references public.currencies(iso_code) on delete restrict,
  rate_base_currency_code varchar(3) not null default 'USD' references public.currencies(iso_code) on delete restrict,
  supported_currencies jsonb not null default '["USD", "SAR", "SDG", "EGP"]'::jsonb check (jsonb_typeof(supported_currencies) = 'array'),
  currency_frequency jsonb not null default '{}'::jsonb check (jsonb_typeof(currency_frequency) = 'object'),
  tax_percent numeric(7, 4) not null default 0 check (tax_percent between 0 and 100),
  invoice_header text not null default 'WEAPON STORE MANAGEMENT SYSTEM',
  invoice_footer text not null default 'All sales are final. Items sold as-is.',
  store_logo text not null default '',
  thermal_printer_width integer not null default 80 check (thermal_printer_width > 0),
  label_format text not null default 'Standard',
  hourly_snapshot boolean not null default true,
  daily_closing_prompt boolean not null default true,
  weekly_verification boolean not null default false,
  min_profit_margin_percent numeric(7, 4) not null default 5 check (min_profit_margin_percent between 0 and 100),
  preferred_display_currency varchar(3) references public.currencies(iso_code) on delete restrict,
  show_demo_data boolean not null default false,
  app_language text not null default 'en' check (app_language in ('en', 'ar')),
  date_format text not null default 'YYYY-MM-DD',
  number_format text not null default 'en-US',
  company_name text not null default '',
  company_address text not null default '',
  company_phone text not null default '',
  company_email text not null default '',
  company_tax_id text not null default '',
  theme text not null default 'system' check (theme in ('dark', 'light', 'system')),
  updated_at timestamptz not null default now()
);

create table public.saved_filters (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  name text not null,
  entity_type text not null,
  filter_state jsonb not null default '{}'::jsonb check (jsonb_typeof(filter_state) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, name)
);

create table public.user_preferences (
  user_id text primary key references public.users(id) on delete cascade,
  display_currency varchar(3) references public.currencies(iso_code) on delete restrict,
  report_view_mode text not null default 'accounting' check (report_view_mode in ('original', 'accounting', 'display')),
  language text check (language is null or language in ('en', 'ar')),
  date_format text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_data_issues (
  id text primary key,
  entity_type text not null,
  entity_id text not null,
  field_name text not null,
  issue_code text not null,
  details text not null default '',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (entity_type, entity_id, field_name, issue_code)
);

create table public.inventory_transactions (
  id text primary key,
  item_type text not null check (item_type in ('weapon', 'accessory', 'ammunition')),
  item_id text not null,
  transaction_type text not null check (transaction_type in ('receipt', 'adjustment', 'sale', 'return')),
  quantity_delta integer not null check (quantity_delta <> 0),
  unit_amount numeric(20, 4) check (unit_amount is null or unit_amount >= 0),
  currency varchar(3) references public.currencies(iso_code) on delete restrict,
  valuation jsonb,
  shipment_id text references public.shipments(id) on delete set null,
  notes text not null default '',
  created_by text not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((unit_amount is null and currency is null and valuation is null) or (unit_amount is not null and currency is not null and valuation is not null))
);

create table public.shipment_items (
  id text primary key,
  shipment_id text not null references public.shipments(id) on delete cascade,
  product_type text not null check (product_type in ('weapon', 'accessory', 'ammunition')),
  description text not null default '',
  quantity numeric(20, 4) not null check (quantity > 0),
  unit_purchase_amount numeric(20, 4) not null check (unit_purchase_amount >= 0),
  currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate numeric(24, 10) not null check (exchange_rate > 0),
  unit_purchase_base_amount numeric(20, 4) not null check (unit_purchase_base_amount >= 0),
  base_currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate_date timestamptz not null,
  rate_source text not null check (rate_source in ('manual', 'api', 'cache', 'default')),
  product_ids_json jsonb not null default '[]'::jsonb check (jsonb_typeof(product_ids_json) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipment_id, id)
);

create table public.product_costs (
  id text primary key,
  product_type text not null check (product_type in ('weapon', 'accessory', 'ammunition')),
  product_id text not null,
  name text not null check (length(btrim(name)) > 0),
  calculation_type text not null check (calculation_type in ('fixed', 'percentage')),
  input_amount numeric(20, 4) not null check (input_amount >= 0),
  percentage_rate numeric(12, 6) check (percentage_rate is null or percentage_rate >= 0),
  calculation_base text not null check (calculation_base = 'original_purchase_cost'),
  calculated_amount numeric(20, 4) not null check (calculated_amount >= 0),
  currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate numeric(24, 10) not null check (exchange_rate > 0),
  base_amount numeric(20, 4) not null check (base_amount >= 0),
  base_currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate_date timestamptz not null,
  rate_source text not null check (rate_source in ('manual', 'api', 'cache', 'default')),
  source text not null default 'product_level' check (source = 'product_level'),
  created_by text not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipment_costs (
  id text primary key,
  shipment_id text not null references public.shipments(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  calculation_type text not null check (calculation_type in ('fixed', 'percentage')),
  input_amount numeric(20, 4) not null check (input_amount >= 0),
  percentage_rate numeric(12, 6) check (percentage_rate is null or percentage_rate >= 0),
  calculation_base text not null check (calculation_base = 'original_purchase_cost'),
  calculated_amount numeric(20, 4) not null check (calculated_amount >= 0),
  currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate numeric(24, 10) not null check (exchange_rate > 0),
  base_amount numeric(20, 4) not null check (base_amount >= 0),
  base_currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate_date timestamptz not null,
  rate_source text not null check (rate_source in ('manual', 'api', 'cache', 'default')),
  source text not null default 'shipment_level' check (source = 'shipment_level'),
  scope text not null check (scope in ('entire_shipment', 'selected_products', 'single_product', 'manual')),
  allocation_method text not null check (allocation_method in ('by_value', 'by_quantity', 'equal', 'manual')),
  basis_revision integer not null default 1 check (basis_revision > 0),
  created_by text not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipment_cost_scope_items (
  cost_id text not null references public.shipment_costs(id) on delete cascade,
  shipment_item_id text not null references public.shipment_items(id) on delete cascade,
  primary key (cost_id, shipment_item_id)
);

create table public.shipment_cost_allocations (
  id text primary key,
  shipment_id text not null references public.shipments(id) on delete cascade,
  shipment_item_id text not null references public.shipment_items(id) on delete cascade,
  cost_id text not null references public.shipment_costs(id) on delete cascade,
  automatic_amount numeric(20, 4) not null check (automatic_amount >= 0),
  final_amount numeric(20, 4) not null check (final_amount >= 0),
  manual_override boolean not null default false,
  difference numeric(20, 4) not null,
  currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate numeric(24, 10) not null check (exchange_rate > 0),
  automatic_base_amount numeric(20, 4) not null check (automatic_base_amount >= 0),
  final_base_amount numeric(20, 4) not null check (final_base_amount >= 0),
  base_currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  allocation_method text not null check (allocation_method in ('by_value', 'by_quantity', 'equal', 'manual')),
  basis_revision integer not null default 1 check (basis_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cost_id, shipment_item_id)
);

create table public.inventory_cost_snapshots (
  product_type text not null check (product_type in ('weapon', 'accessory', 'ammunition')),
  product_id text not null,
  shipment_id text references public.shipments(id) on delete set null,
  shipment_item_id text references public.shipment_items(id) on delete set null,
  original_amount numeric(20, 4) not null check (original_amount >= 0),
  original_currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  original_exchange_rate numeric(24, 10) not null check (original_exchange_rate > 0),
  original_base_amount numeric(20, 4) not null check (original_base_amount >= 0),
  product_costs_base_amount numeric(20, 4) not null check (product_costs_base_amount >= 0),
  shipment_costs_base_amount numeric(20, 4) not null check (shipment_costs_base_amount >= 0),
  final_landed_base_amount numeric(20, 4) not null check (final_landed_base_amount >= 0),
  base_currency_code varchar(3) not null references public.currencies(iso_code) on delete restrict,
  exchange_rate_date timestamptz not null,
  rate_source text not null check (rate_source in ('manual', 'api', 'cache', 'default')),
  finalized_at timestamptz not null default now(),
  finalized_by text not null references public.users(id) on delete restrict,
  primary key (product_type, product_id)
);

create table public.shipment_imports (
  id text primary key,
  shipment_id text references public.shipments(id) on delete set null,
  status text not null check (status in ('draft', 'processing', 'pending_review', 'scheduled', 'arrived', 'received', 'failed', 'cancelled')),
  file_name text not null,
  file_type text not null,
  file_size integer not null check (file_size > 0),
  file_hash text not null,
  raw_extraction_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  shipment_number text,
  supplier_name text,
  supplier_id text references public.suppliers(id) on delete set null,
  supplier_reference text,
  invoice_number text,
  manifest_number text,
  shipment_date date,
  expected_arrival_date date,
  origin text,
  destination text,
  currency varchar(3) references public.currencies(iso_code) on delete restrict,
  review_note text,
  prompt_version text,
  schema_version text not null default '1.0',
  ai_provider text,
  ai_model text,
  ai_request_id text,
  ai_processing_ms integer check (ai_processing_ms is null or ai_processing_ms >= 0),
  ai_requested_at timestamptz,
  validation_summary jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_by text not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  confirmed_at timestamptz
);

create table public.shipment_documents (
  id text primary key,
  import_id text not null references public.shipment_imports(id) on delete cascade,
  shipment_id text references public.shipments(id) on delete set null,
  file_name text not null,
  mime_type text not null,
  file_size integer not null check (file_size > 0),
  file_hash text not null,
  content_blob bytea not null,
  uploaded_by text not null references public.users(id) on delete restrict,
  uploaded_at timestamptz not null default now()
);

create table public.shipment_import_items (
  id text primary key,
  import_id text not null references public.shipment_imports(id) on delete cascade,
  row_index integer not null,
  product_type text check (product_type is null or product_type in ('weapon', 'ammunition', 'accessory')),
  product_name text,
  category text,
  weapon_type text,
  manufacturer text,
  model text,
  caliber text,
  sku text,
  product_code text,
  serial_number text,
  serial_numbers_json jsonb not null default '[]'::jsonb check (jsonb_typeof(serial_numbers_json) = 'array'),
  quantity integer,
  unit_price numeric(20, 4),
  total_price numeric(20, 4),
  currency varchar(3) references public.currencies(iso_code) on delete restrict,
  country_of_origin text,
  weapon_type_id text references public.weapon_types(id) on delete restrict,
  weapon_subtype_id text references public.weapon_subtypes(id) on delete restrict,
  brand_id text references public.brands(id) on delete restrict,
  model_id text references public.models(id) on delete restrict,
  caliber_id text references public.calibers(id) on delete restrict,
  storage_location_id text references public.storage_locations(id) on delete set null,
  confidence_json jsonb not null default '{}'::jsonb,
  source_json jsonb not null default '{}'::jsonb,
  raw_data_json jsonb not null default '{}'::jsonb,
  status text not null default 'needs_review' check (status in ('valid', 'needs_review', 'invalid', 'duplicate', 'conflict')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, row_index)
);

create table public.shipment_validation_issues (
  id text primary key,
  import_id text not null references public.shipment_imports(id) on delete cascade,
  item_id text references public.shipment_import_items(id) on delete cascade,
  field_name text,
  code text not null,
  severity text not null check (severity in ('warning', 'error', 'conflict')),
  message text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.shipment_item_changes (
  id text primary key,
  import_id text not null references public.shipment_imports(id) on delete cascade,
  item_id text references public.shipment_import_items(id) on delete set null,
  field_name text not null,
  old_value text,
  new_value text,
  source text not null default 'user' check (source in ('user', 'system', 'ai')),
  changed_by text not null references public.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table public.shipment_status_history (
  id text primary key,
  import_id text not null references public.shipment_imports(id) on delete cascade,
  shipment_id text references public.shipments(id) on delete set null,
  from_status text,
  to_status text not null,
  note text not null default '',
  changed_by text not null,
  changed_at timestamptz not null default now()
);

alter table public.shipments
  add constraint shipments_import_id_fkey foreign key (import_id) references public.shipment_imports(id) on delete set null deferrable initially deferred;

create table public.migration_runs (
  id uuid primary key default gen_random_uuid(),
  source_sha256 text not null,
  source_schema_version integer not null,
  status text not null check (status in ('running', 'failed', 'verified')),
  source_counts jsonb not null default '{}'::jsonb,
  target_counts jsonb not null default '{}'::jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (source_sha256)
);

create index idx_weapons_status_created_at on public.weapons(status, created_at desc) where deleted_at is null;
create index idx_weapons_type_subtype_caliber on public.weapons(weapon_type_id, weapon_subtype_id, caliber_id) where deleted_at is null;
create index idx_weapons_location on public.weapons(storage_location_id) where storage_location_id is not null and deleted_at is null;
create index idx_weapons_supplier on public.weapons(supplier_id) where supplier_id is not null and deleted_at is null;
create index idx_weapons_shipment on public.weapons(shipment_id) where shipment_id is not null;
create index idx_shipments_supplier_status on public.shipments(supplier_id, status);
create index idx_shipments_expected_arrival on public.shipments(expected_arrival_date, status);
create index idx_invoices_customer_created on public.invoices(customer_id, date desc) where customer_id is not null;
create index idx_invoices_status_due on public.invoices(status, due_date) where not voided;
create index idx_payments_invoice_date on public.payment_records(invoice_id, date desc);
create index idx_storage_locations_warehouse on public.storage_locations(warehouse_id);
create index idx_inventory_transactions_item on public.inventory_transactions(item_type, item_id, created_at desc);
create index idx_shipment_items_shipment on public.shipment_items(shipment_id, id);
create index idx_product_costs_product on public.product_costs(product_type, product_id, created_at desc);
create index idx_shipment_costs_shipment on public.shipment_costs(shipment_id, created_at desc);
create index idx_cost_allocations_item on public.shipment_cost_allocations(shipment_item_id, cost_id);
create index idx_inventory_cost_shipment on public.inventory_cost_snapshots(shipment_id, shipment_item_id);
create index idx_shipment_imports_hash on public.shipment_imports(file_hash, status);
create index idx_shipment_imports_status on public.shipment_imports(status, expected_arrival_date);
create index idx_shipment_import_items_serial on public.shipment_import_items(serial_number) where serial_number is not null;
create index idx_shipment_validation_import on public.shipment_validation_issues(import_id, severity);
create index idx_shipment_status_history_import on public.shipment_status_history(import_id, changed_at desc);
create index idx_audit_logs_created on public.audit_logs(timestamp desc);
create index idx_notifications_user_read on public.app_notifications(user_id, is_read, date desc);

commit;
