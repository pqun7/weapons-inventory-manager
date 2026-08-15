export const SCHEMA_VERSION = 13;

export const CONFIGURE_INITIAL_CURRENCIES_V5_SQL = `
UPDATE currencies
SET is_active = CASE
  WHEN iso_code IN ('USD','SAR','SDG','EGP') THEN 1
  WHEN iso_code = (SELECT accounting_currency_code FROM system_settings WHERE id = 1) THEN 1
  ELSE 0
END;

UPDATE system_settings
SET supported_currencies = '["USD","SAR","SDG","EGP"]',
    currency_code = CASE
      WHEN currency_code IN ('USD','SAR','SDG','EGP') THEN currency_code
      ELSE 'USD'
    END,
    preferred_display_currency = CASE
      WHEN preferred_display_currency IN ('USD','SAR','SDG','EGP') THEN preferred_display_currency
      ELSE 'USD'
    END
WHERE id = 1;

UPDATE user_preferences
SET display_currency = 'USD'
WHERE display_currency IS NOT NULL
  AND display_currency NOT IN ('USD','SAR','SDG','EGP');
`;

export const CREATE_TABLES_SQL = `
-- Connection-level PRAGMAs are configured by electron/database.ts.
-- This file is intentionally limited to schema objects, indexes, and seed data.

-- ============ Master Data Tables ============

CREATE TABLE IF NOT EXISTS weapon_types (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS weapon_subtypes (
  id              TEXT PRIMARY KEY,
  weapon_type_id  TEXT NOT NULL REFERENCES weapon_types(id) ON DELETE RESTRICT,
  label           TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (weapon_type_id, label),
  UNIQUE (weapon_type_id, id) 
) STRICT;

CREATE TABLE IF NOT EXISTS calibers (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS subtype_calibers (
  subtype_id TEXT NOT NULL REFERENCES weapon_subtypes(id) ON DELETE RESTRICT,
  caliber_id TEXT NOT NULL REFERENCES calibers(id) ON DELETE RESTRICT,
  PRIMARY KEY (subtype_id, caliber_id)
) STRICT;

CREATE TABLE IF NOT EXISTS brands (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS models (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  brand_id   TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (label, brand_id)
) STRICT;

CREATE TABLE IF NOT EXISTS warehouses (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS storage_locations (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  shelf        TEXT NOT NULL,
  bin          TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (warehouse_id, shelf, bin)
) STRICT;

-- ============ Currency Tables (unchanged) ============

CREATE TABLE IF NOT EXISTS currencies (
  iso_code             TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  decimal_precision    INTEGER NOT NULL DEFAULT 2 CHECK (decimal_precision BETWEEN 0 AND 4),
  is_active            INTEGER NOT NULL DEFAULT 1,
  last_known_rate      TEXT NOT NULL DEFAULT '1',
  last_rate_updated_at TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exchange_rate_history (
  id            TEXT PRIMARY KEY,
  currency_code TEXT NOT NULL REFERENCES currencies(iso_code),
  rate          TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'api',
  fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exchange_rate_overrides (
  currency_code TEXT PRIMARY KEY REFERENCES currencies(iso_code),
  mode          TEXT NOT NULL DEFAULT 'automatic' CHECK (mode IN ('automatic', 'manual')),
  manual_rate   TEXT,
  updated_by    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reason        TEXT
);

CREATE TABLE IF NOT EXISTS exchange_rate_audit_log (
  id            TEXT PRIMARY KEY,
  currency_code TEXT NOT NULL REFERENCES currencies(iso_code),
  old_rate      TEXT,
  new_rate      TEXT,
  changed_by    TEXT,
  changed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reason        TEXT,
  source        TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','api','cache','default'))
);

-- ============ Business Tables (suppliers, customers, shipments, etc.) ============

CREATE TABLE IF NOT EXISTS suppliers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  date_added     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  phone                       TEXT NOT NULL DEFAULT '',
  email                       TEXT NOT NULL DEFAULT '',
  address                     TEXT NOT NULL DEFAULT '',
  is_wholesale_buyer          INTEGER NOT NULL DEFAULT 0,
  wholesale_discount_percent  REAL NOT NULL DEFAULT 0,
  date_added                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id                      TEXT PRIMARY KEY,
  shipment_number         TEXT NOT NULL UNIQUE,
  supplier_id             TEXT NOT NULL DEFAULT '',
  shipment_date           TEXT NOT NULL,
  expected_arrival_date   TEXT NOT NULL,
  total_expected_items    INTEGER NOT NULL DEFAULT 0,
  attachments             TEXT NOT NULL DEFAULT '[]',
  notes                   TEXT NOT NULL DEFAULT '',
  status                  TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','In Transit','Delayed','Arrived','Cancelled','Partial')),
  timeline                TEXT NOT NULL DEFAULT '[]',
  purchase_order_number   TEXT,
  invoice_number          TEXT,
  shipping_carrier        TEXT,
  container_number        TEXT,
  currency                TEXT,
  purchase_date           TEXT,
  actual_arrival_date     TEXT,
  line_items              TEXT NOT NULL DEFAULT '[]',
  documents               TEXT NOT NULL DEFAULT '[]',
  total_cost_valuation    TEXT,
  workflow_status         TEXT NOT NULL DEFAULT 'draft',
  import_id               TEXT,
  arrival_note            TEXT,
  delay_reason            TEXT,
  last_arrival_prompt_at  TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
);

-- ============ Weapons Table (FULLY NORMALISED) ============

CREATE TABLE IF NOT EXISTS weapons (
  id                    TEXT PRIMARY KEY,
  serial_number         TEXT NOT NULL UNIQUE,
  weapon_type_id        TEXT NOT NULL,
  weapon_subtype_id     TEXT NOT NULL,
  brand_id              TEXT NOT NULL,
  model_id              TEXT NOT NULL,
  caliber_id            TEXT NOT NULL,
  storage_location_id   TEXT,
  supplier_id           TEXT,
  shipment_id           TEXT,
  condition             TEXT NOT NULL DEFAULT 'Excellent'
    CHECK (condition IN ('Excellent','Good','Fair','Poor')),
  status                TEXT NOT NULL DEFAULT 'Available'
    CHECK (status IN ('Available','Reserved','Sold','Returned')),
  purchase_price        REAL NOT NULL DEFAULT 0,
  retail_price          REAL NOT NULL DEFAULT 0,
  wholesale_price       REAL NOT NULL DEFAULT 0,
  actual_final_price    REAL,
  date_added            TEXT NOT NULL,
  batch_id              TEXT,
  notes                 TEXT NOT NULL DEFAULT '',
  images                TEXT NOT NULL DEFAULT '[]',
  movement_history      TEXT NOT NULL DEFAULT '[]',
  purchase_price_valuation TEXT,
  retail_price_valuation  TEXT,
  wholesale_price_valuation TEXT,
  actual_final_price_valuation TEXT,
  sale_price_valuation    TEXT,
  deleted_at            TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),

  -- Composite foreign keys enforce business rules across tables
  FOREIGN KEY (weapon_type_id, weapon_subtype_id)
    REFERENCES weapon_subtypes(weapon_type_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (weapon_subtype_id, caliber_id)
    REFERENCES subtype_calibers(subtype_id, caliber_id) ON DELETE RESTRICT,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT,
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE RESTRICT,
  FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL
) STRICT;

-- ============ Indexes (optimised for inventory searches) ============

CREATE INDEX IF NOT EXISTS idx_weapons_serial ON weapons(serial_number);
CREATE INDEX IF NOT EXISTS idx_weapons_status ON weapons(status);
CREATE INDEX IF NOT EXISTS idx_weapons_condition ON weapons(condition);
CREATE INDEX IF NOT EXISTS idx_weapons_date_added ON weapons(date_added);
CREATE INDEX IF NOT EXISTS idx_weapons_created_at ON weapons(created_at);

CREATE INDEX IF NOT EXISTS idx_weapons_type ON weapons(weapon_type_id);
CREATE INDEX IF NOT EXISTS idx_weapons_subtype ON weapons(weapon_subtype_id);
CREATE INDEX IF NOT EXISTS idx_weapons_brand ON weapons(brand_id);
CREATE INDEX IF NOT EXISTS idx_weapons_model ON weapons(model_id);
CREATE INDEX IF NOT EXISTS idx_weapons_caliber ON weapons(caliber_id);
CREATE INDEX IF NOT EXISTS idx_weapons_location ON weapons(storage_location_id);
CREATE INDEX IF NOT EXISTS idx_weapons_supplier ON weapons(supplier_id);
CREATE INDEX IF NOT EXISTS idx_weapons_shipment ON weapons(shipment_id);

CREATE INDEX IF NOT EXISTS idx_weapons_type_status ON weapons(weapon_type_id, status);
CREATE INDEX IF NOT EXISTS idx_weapons_subtype_status ON weapons(weapon_subtype_id, status);
CREATE INDEX IF NOT EXISTS idx_weapons_brand_status ON weapons(brand_id, status);

CREATE INDEX IF NOT EXISTS idx_storage_warehouse ON storage_locations(warehouse_id);

-- ============ Invoices, Payments, Accessories, Ammo, Audit, etc. (unchanged) ============

CREATE TABLE IF NOT EXISTS invoices (
  id                  TEXT PRIMARY KEY,
  invoice_number      TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL DEFAULT 'Sale'
    CHECK (type IN ('Sale','Purchase')),
  customer_id         TEXT,
  supplier_id         TEXT,
  customer_name       TEXT NOT NULL DEFAULT '',
  date                TEXT NOT NULL,
  due_date            TEXT NOT NULL,
  total_original      REAL NOT NULL DEFAULT 0,
  total_negotiated    REAL NOT NULL DEFAULT 0,
  total_paid          REAL NOT NULL DEFAULT 0,
  balance             REAL NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Overdue','Paid','Void')),
  weapon_ids          TEXT NOT NULL DEFAULT '[]',
  line_items          TEXT NOT NULL DEFAULT '[]',
  sale_mode           TEXT NOT NULL DEFAULT 'Retail',
  employee_id         TEXT NOT NULL DEFAULT '',
  employee_name       TEXT NOT NULL DEFAULT '',
  attachments         TEXT NOT NULL DEFAULT '[]',
  shipment_id         TEXT,
  notes               TEXT NOT NULL DEFAULT '',
  voided              INTEGER NOT NULL DEFAULT 0,
  tax_amount          REAL NOT NULL DEFAULT 0,
  total_valuation     TEXT,
  currency            TEXT,
  accounting_currency TEXT,
  exchange_rate       TEXT,
  exchange_rate_date  TEXT,
  rate_source         TEXT,
  total_original_accounting   TEXT,
  total_negotiated_accounting TEXT,
  total_paid_accounting       TEXT,
  balance_accounting          TEXT,
  tax_amount_accounting       TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS payment_records (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  date           TEXT NOT NULL,
  amount         REAL NOT NULL,
  currency       TEXT,
  accounting_amount TEXT,
  accounting_currency TEXT,
  exchange_rate  TEXT,
  exchange_rate_date TEXT,
  rate_source    TEXT,
  rate_id        TEXT,
  method         TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash','card','bank_transfer','check','other')),
  employee       TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payment_records(invoice_id);

CREATE TABLE IF NOT EXISTS accessories (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT '',
  quantity         INTEGER NOT NULL DEFAULT 0,
  safety_threshold INTEGER NOT NULL DEFAULT 10,
  price            REAL NOT NULL DEFAULT 0,
  price_currency   TEXT,
  price_valuation  TEXT,
  date_added       TEXT NOT NULL,
  warehouse        TEXT NOT NULL DEFAULT '', 
  shelf            TEXT NOT NULL DEFAULT '',
  bin              TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ammunition (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT '',   -- new column
  caliber           TEXT NOT NULL,
  package_type      TEXT NOT NULL DEFAULT 'Box'
    CHECK (package_type IN ('Carton','Box','Case','Custom')),
  units_per_package INTEGER NOT NULL DEFAULT 1,
  full_packages     INTEGER NOT NULL DEFAULT 0,
  loose_rounds      INTEGER NOT NULL DEFAULT 0,
  safety_threshold  INTEGER NOT NULL DEFAULT 100,
  price             REAL NOT NULL DEFAULT 0,
  price_currency    TEXT,
  price_valuation   TEXT,
  date_added        TEXT NOT NULL,
  warehouse         TEXT NOT NULL DEFAULT '',
  shelf             TEXT NOT NULL DEFAULT '',
  bin               TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE IF NOT EXISTS ammunition_weapon_compatibility (
  ammunition_id TEXT NOT NULL REFERENCES ammunition(id) ON DELETE CASCADE,
  weapon_id     TEXT NOT NULL REFERENCES weapons(id) ON DELETE RESTRICT,
  PRIMARY KEY (ammunition_id, weapon_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_awc_ammo ON ammunition_weapon_compatibility(ammunition_id);
CREATE INDEX IF NOT EXISTS idx_awc_weapon ON ammunition_weapon_compatibility(weapon_id);

CREATE TABLE IF NOT EXISTS accessory_weapon_compatibility (
  accessory_id TEXT NOT NULL REFERENCES accessories(id) ON DELETE CASCADE,
  weapon_id    TEXT NOT NULL REFERENCES weapons(id) ON DELETE RESTRICT,
  PRIMARY KEY (accessory_id, weapon_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accwc_acc ON accessory_weapon_compatibility(accessory_id);
CREATE INDEX IF NOT EXISTS idx_accwc_weapon ON accessory_weapon_compatibility(weapon_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  timestamp    TEXT NOT NULL,
  date         TEXT NOT NULL,
  user_id      TEXT NOT NULL DEFAULT '',
  action_type  TEXT NOT NULL DEFAULT 'Update',
  description  TEXT NOT NULL DEFAULT '',
  metadata     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS app_notifications (
  id        TEXT PRIMARY KEY,
  type      TEXT NOT NULL DEFAULT 'System',
  title     TEXT NOT NULL DEFAULT '',
  message   TEXT NOT NULL DEFAULT '',
  date      TEXT NOT NULL,
  is_read   INTEGER NOT NULL DEFAULT 0,
  entity_id TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Employee'
    CHECK (role IN ('Admin','Employee')),
  permissions   TEXT NOT NULL DEFAULT '{}',
  password_set  INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS system_settings (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  currency_symbol         TEXT NOT NULL DEFAULT '$',
  currency_code           TEXT NOT NULL DEFAULT 'USD',
  accounting_currency_code TEXT NOT NULL DEFAULT 'USD',
  rate_base_currency_code  TEXT NOT NULL DEFAULT 'USD',
  supported_currencies    TEXT NOT NULL DEFAULT '["USD","SAR","SDG","EGP"]',
  currency_frequency      TEXT NOT NULL DEFAULT '{}',
  tax_percent             REAL NOT NULL DEFAULT 0,
  invoice_header          TEXT NOT NULL DEFAULT 'WEAPON STORE MANAGEMENT SYSTEM',
  invoice_footer          TEXT NOT NULL DEFAULT 'All sales are final. Items sold as-is. Store license #WS-2024-001.',
  store_logo              TEXT NOT NULL DEFAULT '',
  thermal_printer_width   INTEGER NOT NULL DEFAULT 80,
  label_format            TEXT NOT NULL DEFAULT 'Standard',
  hourly_snapshot         INTEGER NOT NULL DEFAULT 1,
  daily_closing_prompt    INTEGER NOT NULL DEFAULT 1,
  weekly_verification     INTEGER NOT NULL DEFAULT 0,
  min_profit_margin_percent REAL NOT NULL DEFAULT 5,
  target_retail_margin_percent REAL NOT NULL DEFAULT 30,
  target_wholesale_margin_percent REAL NOT NULL DEFAULT 20,
  maximum_markup_percent REAL NOT NULL DEFAULT 200,
  psychological_pricing INTEGER NOT NULL DEFAULT 0,
  preferred_display_currency TEXT,
  show_demo_data          INTEGER NOT NULL DEFAULT 1,
  app_language            TEXT NOT NULL DEFAULT 'en',
  date_format             TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
  number_format           TEXT NOT NULL DEFAULT 'en-US',
  company_name            TEXT NOT NULL DEFAULT '',
  company_address         TEXT NOT NULL DEFAULT '',
  company_phone           TEXT NOT NULL DEFAULT '',
  company_email           TEXT NOT NULL DEFAULT '',
  company_tax_id          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS saved_filters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  filter_state TEXT NOT NULL DEFAULT '{}',
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_currency TEXT,
  report_view_mode TEXT NOT NULL DEFAULT 'accounting',
  language         TEXT,
  date_format      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS financial_data_issues (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  field_name  TEXT NOT NULL,
  issue_code  TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE (entity_type, entity_id, field_name, issue_code)
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id               TEXT PRIMARY KEY,
  item_type        TEXT NOT NULL CHECK (item_type IN ('weapon','accessory','ammunition')),
  item_id          TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('receipt','adjustment','sale','return')),
  quantity_delta   INTEGER NOT NULL,
  unit_amount      TEXT,
  currency         TEXT,
  valuation        TEXT,
  shipment_id      TEXT,
  notes            TEXT NOT NULL DEFAULT '',
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item
  ON inventory_transactions(item_type, item_id, created_at);

-- ============ Product and landed cost accounting (V8) ============

-- Normalized shipment items are the stable allocation target. The existing
-- shipments.line_items JSON remains a historical display snapshot only.
CREATE TABLE IF NOT EXISTS shipment_items (
  id                         TEXT PRIMARY KEY,
  shipment_id                TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_type               TEXT NOT NULL,
  description                TEXT NOT NULL DEFAULT '',
  quantity                   TEXT NOT NULL CHECK (CAST(quantity AS REAL) > 0),
  unit_purchase_amount       TEXT NOT NULL CHECK (CAST(unit_purchase_amount AS REAL) >= 0),
  currency_code              TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  exchange_rate              TEXT NOT NULL CHECK (CAST(exchange_rate AS REAL) > 0),
  unit_purchase_base_amount  TEXT NOT NULL CHECK (CAST(unit_purchase_base_amount AS REAL) >= 0),
  base_currency_code         TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  exchange_rate_date         TEXT NOT NULL,
  rate_source                TEXT NOT NULL CHECK (rate_source IN ('manual','api','cache','default')),
  product_ids_json           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(product_ids_json) = 1),
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shipment_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items(shipment_id, id);

CREATE TABLE IF NOT EXISTS product_costs (
  id                    TEXT PRIMARY KEY,
  product_type          TEXT NOT NULL,
  product_id            TEXT NOT NULL,
  name                  TEXT NOT NULL CHECK (length(trim(name)) > 0),
  calculation_type      TEXT NOT NULL CHECK (calculation_type IN ('fixed','percentage')),
  input_amount          TEXT NOT NULL CHECK (CAST(input_amount AS REAL) >= 0),
  percentage_rate       TEXT CHECK (percentage_rate IS NULL OR CAST(percentage_rate AS REAL) >= 0),
  calculation_base      TEXT NOT NULL CHECK (calculation_base IN ('original_purchase_cost')),
  calculated_amount     TEXT NOT NULL CHECK (CAST(calculated_amount AS REAL) >= 0),
  currency_code         TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  exchange_rate         TEXT NOT NULL CHECK (CAST(exchange_rate AS REAL) > 0),
  base_amount           TEXT NOT NULL CHECK (CAST(base_amount AS REAL) >= 0),
  base_currency_code    TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  exchange_rate_date    TEXT NOT NULL,
  rate_source           TEXT NOT NULL CHECK (rate_source IN ('manual','api','cache','default')),
  source                TEXT NOT NULL DEFAULT 'product_level' CHECK (source = 'product_level'),
  created_by            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_product_costs_product ON product_costs(product_type, product_id, created_at);

CREATE TABLE IF NOT EXISTS shipment_costs (
  id                    TEXT PRIMARY KEY,
  shipment_id           TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL CHECK (length(trim(name)) > 0),
  calculation_type      TEXT NOT NULL CHECK (calculation_type IN ('fixed','percentage')),
  input_amount          TEXT NOT NULL CHECK (CAST(input_amount AS REAL) >= 0),
  percentage_rate       TEXT CHECK (percentage_rate IS NULL OR CAST(percentage_rate AS REAL) >= 0),
  calculation_base      TEXT NOT NULL CHECK (calculation_base IN ('original_purchase_cost')),
  calculated_amount     TEXT NOT NULL CHECK (CAST(calculated_amount AS REAL) >= 0),
  currency_code         TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  exchange_rate         TEXT NOT NULL CHECK (CAST(exchange_rate AS REAL) > 0),
  base_amount           TEXT NOT NULL CHECK (CAST(base_amount AS REAL) >= 0),
  base_currency_code    TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  exchange_rate_date    TEXT NOT NULL,
  rate_source           TEXT NOT NULL CHECK (rate_source IN ('manual','api','cache','default')),
  source                TEXT NOT NULL DEFAULT 'shipment_level' CHECK (source = 'shipment_level'),
  scope                 TEXT NOT NULL CHECK (scope IN ('entire_shipment','selected_products','single_product','manual')),
  allocation_method     TEXT NOT NULL CHECK (allocation_method IN ('by_value','by_quantity','equal','manual')),
  basis_revision        INTEGER NOT NULL DEFAULT 1 CHECK (basis_revision > 0),
  created_by            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_shipment_costs_shipment ON shipment_costs(shipment_id, created_at);

CREATE TABLE IF NOT EXISTS shipment_cost_scope_items (
  cost_id             TEXT NOT NULL REFERENCES shipment_costs(id) ON DELETE CASCADE,
  shipment_item_id    TEXT NOT NULL REFERENCES shipment_items(id) ON DELETE CASCADE,
  PRIMARY KEY (cost_id, shipment_item_id)
) STRICT;

CREATE TABLE IF NOT EXISTS shipment_cost_allocations (
  id                       TEXT PRIMARY KEY,
  shipment_id              TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  shipment_item_id         TEXT NOT NULL REFERENCES shipment_items(id) ON DELETE CASCADE,
  cost_id                  TEXT NOT NULL REFERENCES shipment_costs(id) ON DELETE CASCADE,
  automatic_amount         TEXT NOT NULL CHECK (CAST(automatic_amount AS REAL) >= 0),
  final_amount             TEXT NOT NULL CHECK (CAST(final_amount AS REAL) >= 0),
  manual_override          INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0,1)),
  difference               TEXT NOT NULL,
  currency_code            TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  exchange_rate            TEXT NOT NULL CHECK (CAST(exchange_rate AS REAL) > 0),
  automatic_base_amount    TEXT NOT NULL CHECK (CAST(automatic_base_amount AS REAL) >= 0),
  final_base_amount        TEXT NOT NULL CHECK (CAST(final_base_amount AS REAL) >= 0),
  base_currency_code       TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  allocation_method        TEXT NOT NULL CHECK (allocation_method IN ('by_value','by_quantity','equal','manual')),
  basis_revision           INTEGER NOT NULL DEFAULT 1 CHECK (basis_revision > 0),
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cost_id, shipment_item_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_cost_allocations_item ON shipment_cost_allocations(shipment_item_id, cost_id);

CREATE TABLE IF NOT EXISTS inventory_cost_snapshots (
  product_type                  TEXT NOT NULL,
  product_id                    TEXT NOT NULL,
  shipment_id                  TEXT REFERENCES shipments(id) ON DELETE SET NULL,
  shipment_item_id             TEXT REFERENCES shipment_items(id) ON DELETE SET NULL,
  original_amount              TEXT NOT NULL CHECK (CAST(original_amount AS REAL) >= 0),
  original_currency_code       TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  original_exchange_rate       TEXT NOT NULL CHECK (CAST(original_exchange_rate AS REAL) > 0),
  original_base_amount         TEXT NOT NULL CHECK (CAST(original_base_amount AS REAL) >= 0),
  product_costs_base_amount    TEXT NOT NULL CHECK (CAST(product_costs_base_amount AS REAL) >= 0),
  shipment_costs_base_amount   TEXT NOT NULL CHECK (CAST(shipment_costs_base_amount AS REAL) >= 0),
  final_landed_base_amount     TEXT NOT NULL CHECK (CAST(final_landed_base_amount AS REAL) >= 0),
  base_currency_code           TEXT NOT NULL REFERENCES currencies(iso_code) ON DELETE RESTRICT,
  exchange_rate_date           TEXT NOT NULL,
  rate_source                  TEXT NOT NULL CHECK (rate_source IN ('manual','api','cache','default')),
  finalized_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_by                 TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (product_type, product_id)
) WITHOUT ROWID, STRICT;
CREATE INDEX IF NOT EXISTS idx_inventory_cost_shipment ON inventory_cost_snapshots(shipment_id, shipment_item_id);

-- ============ Shipment Manifest Import (V6) ============

CREATE TABLE IF NOT EXISTS shipment_imports (
  id                    TEXT PRIMARY KEY,
  shipment_id           TEXT REFERENCES shipments(id) ON DELETE SET NULL,
  status                TEXT NOT NULL CHECK (status IN ('draft','processing','pending_review','scheduled','arrived','received','failed','cancelled')),
  file_name             TEXT NOT NULL,
  file_type             TEXT NOT NULL,
  file_size             INTEGER NOT NULL CHECK (file_size > 0),
  file_hash             TEXT NOT NULL,
  raw_extraction_json   TEXT NOT NULL DEFAULT '{}',
  normalized_json       TEXT NOT NULL DEFAULT '{}',
  shipment_number       TEXT,
  supplier_name         TEXT,
  supplier_id           TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_reference    TEXT,
  invoice_number        TEXT,
  manifest_number       TEXT,
  shipment_date         TEXT,
  expected_arrival_date TEXT,
  origin                TEXT,
  destination           TEXT,
  currency              TEXT,
  review_note           TEXT,
  prompt_version        TEXT,
  schema_version        TEXT NOT NULL DEFAULT '1.0',
  ai_provider           TEXT,
  ai_model              TEXT,
  ai_request_id         TEXT,
  ai_processing_ms      INTEGER,
  ai_requested_at       TEXT,
  validation_summary    TEXT NOT NULL DEFAULT '{}',
  error_code            TEXT,
  error_message         TEXT,
  created_by            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at           TEXT,
  confirmed_at          TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_shipment_imports_hash ON shipment_imports(file_hash, status);
CREATE INDEX IF NOT EXISTS idx_shipment_imports_status ON shipment_imports(status, expected_arrival_date);

CREATE TABLE IF NOT EXISTS shipment_documents (
  id              TEXT PRIMARY KEY,
  import_id       TEXT NOT NULL REFERENCES shipment_imports(id) ON DELETE CASCADE,
  shipment_id     TEXT REFERENCES shipments(id) ON DELETE SET NULL,
  file_name       TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  file_hash       TEXT NOT NULL,
  content_blob    BLOB NOT NULL,
  uploaded_by     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS shipment_import_items (
  id                    TEXT PRIMARY KEY,
  import_id             TEXT NOT NULL REFERENCES shipment_imports(id) ON DELETE CASCADE,
  row_index             INTEGER NOT NULL,
  product_type          TEXT CHECK (product_type IN ('weapon','ammunition','accessory')),
  product_name          TEXT,
  category              TEXT,
  weapon_type           TEXT,
  manufacturer          TEXT,
  model                 TEXT,
  caliber               TEXT,
  sku                   TEXT,
  product_code          TEXT,
  serial_number         TEXT,
  serial_numbers_json   TEXT NOT NULL DEFAULT '[]',
  quantity              INTEGER,
  unit_price            REAL,
  total_price           REAL,
  currency              TEXT,
  country_of_origin     TEXT,
  weapon_type_id        TEXT REFERENCES weapon_types(id) ON DELETE RESTRICT,
  weapon_subtype_id     TEXT REFERENCES weapon_subtypes(id) ON DELETE RESTRICT,
  brand_id              TEXT REFERENCES brands(id) ON DELETE RESTRICT,
  model_id              TEXT REFERENCES models(id) ON DELETE RESTRICT,
  caliber_id            TEXT REFERENCES calibers(id) ON DELETE RESTRICT,
  storage_location_id   TEXT REFERENCES storage_locations(id) ON DELETE SET NULL,
  confidence_json       TEXT NOT NULL DEFAULT '{}',
  source_json           TEXT NOT NULL DEFAULT '{}',
  raw_data_json         TEXT NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('valid','needs_review','invalid','duplicate','conflict')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(import_id, row_index)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_shipment_import_items_import ON shipment_import_items(import_id, row_index);
CREATE INDEX IF NOT EXISTS idx_shipment_import_items_serial ON shipment_import_items(serial_number);

CREATE TABLE IF NOT EXISTS shipment_validation_issues (
  id          TEXT PRIMARY KEY,
  import_id   TEXT NOT NULL REFERENCES shipment_imports(id) ON DELETE CASCADE,
  item_id     TEXT REFERENCES shipment_import_items(id) ON DELETE CASCADE,
  field_name  TEXT,
  code        TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('warning','error','conflict')),
  message     TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_shipment_validation_import ON shipment_validation_issues(import_id, severity);

CREATE TABLE IF NOT EXISTS shipment_item_changes (
  id          TEXT PRIMARY KEY,
  import_id   TEXT NOT NULL REFERENCES shipment_imports(id) ON DELETE CASCADE,
  item_id     TEXT REFERENCES shipment_import_items(id) ON DELETE SET NULL,
  field_name  TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','system','ai')),
  changed_by  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS shipment_status_history (
  id          TEXT PRIMARY KEY,
  import_id   TEXT NOT NULL REFERENCES shipment_imports(id) ON DELETE CASCADE,
  shipment_id TEXT REFERENCES shipments(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_shipment_status_history_import ON shipment_status_history(import_id, changed_at);

CREATE TRIGGER IF NOT EXISTS trg_manifest_status_transition
BEFORE UPDATE OF status ON shipment_imports
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'draft' AND NEW.status IN ('processing','cancelled')) OR
  (OLD.status = 'processing' AND NEW.status IN ('pending_review','failed','cancelled')) OR
  (OLD.status = 'pending_review' AND NEW.status IN ('scheduled','arrived','cancelled','processing')) OR
  (OLD.status = 'scheduled' AND NEW.status IN ('arrived','cancelled')) OR
  (OLD.status = 'arrived' AND NEW.status IN ('received','scheduled','cancelled')) OR
  (OLD.status = 'failed' AND NEW.status IN ('processing','cancelled'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid shipment manifest status transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_shipment_workflow_status_insert
BEFORE INSERT ON shipments
WHEN NEW.workflow_status NOT IN ('draft','processing','pending_review','scheduled','arrived','received','failed','cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid shipment workflow status');
END;

CREATE TRIGGER IF NOT EXISTS trg_shipment_workflow_status_update
BEFORE UPDATE OF workflow_status ON shipments
WHEN NEW.workflow_status NOT IN ('draft','processing','pending_review','scheduled','arrived','received','failed','cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid shipment workflow status');
END;

-- Database guardrails for backend contracts. Historical rows remain readable
-- after a currency is deactivated; only new/changed currency identities require
-- an active registered currency.
CREATE TRIGGER IF NOT EXISTS trg_currencies_positive_rate_insert
BEFORE INSERT ON currencies
WHEN CAST(NEW.last_known_rate AS REAL) <= 0
BEGIN
  SELECT RAISE(ABORT, 'currency rate must be greater than zero');
END;
CREATE TRIGGER IF NOT EXISTS trg_currencies_positive_rate_update
BEFORE UPDATE OF last_known_rate ON currencies
WHEN CAST(NEW.last_known_rate AS REAL) <= 0
BEGIN
  SELECT RAISE(ABORT, 'currency rate must be greater than zero');
END;
CREATE TRIGGER IF NOT EXISTS trg_manual_override_positive_rate
BEFORE INSERT ON exchange_rate_overrides
WHEN NEW.mode = 'manual' AND (NEW.manual_rate IS NULL OR CAST(NEW.manual_rate AS REAL) <= 0)
BEGIN
  SELECT RAISE(ABORT, 'manual currency rate must be greater than zero');
END;
CREATE TRIGGER IF NOT EXISTS trg_manual_override_positive_rate_update
BEFORE UPDATE OF mode, manual_rate ON exchange_rate_overrides
WHEN NEW.mode = 'manual' AND (NEW.manual_rate IS NULL OR CAST(NEW.manual_rate AS REAL) <= 0)
BEGIN
  SELECT RAISE(ABORT, 'manual currency rate must be greater than zero');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_currency_insert
BEFORE INSERT ON invoices
WHEN NEW.currency IS NULL
  OR NOT EXISTS (SELECT 1 FROM currencies WHERE iso_code = NEW.currency AND is_active = 1)
  OR NEW.accounting_currency IS NULL
  OR NOT EXISTS (SELECT 1 FROM currencies WHERE iso_code = NEW.accounting_currency AND is_active = 1)
  OR NEW.exchange_rate IS NULL OR CAST(NEW.exchange_rate AS REAL) <= 0
  OR NEW.exchange_rate_date IS NULL
  OR NEW.rate_source NOT IN ('manual','api','cache','default')
  OR NEW.total_original_accounting IS NULL
  OR NEW.total_negotiated_accounting IS NULL
  OR NEW.total_paid_accounting IS NULL
  OR NEW.balance_accounting IS NULL
  OR NEW.tax_amount_accounting IS NULL
BEGIN
  SELECT RAISE(ABORT, 'invoice requires active transaction and accounting currencies');
END;
CREATE TRIGGER IF NOT EXISTS trg_weapon_valuation_insert
BEFORE INSERT ON weapons
WHEN NEW.purchase_price_valuation IS NULL
  OR NEW.retail_price_valuation IS NULL
  OR NEW.wholesale_price_valuation IS NULL
  OR json_valid(NEW.purchase_price_valuation) = 0
  OR json_valid(NEW.retail_price_valuation) = 0
  OR json_valid(NEW.wholesale_price_valuation) = 0
BEGIN
  SELECT RAISE(ABORT, 'weapon prices require valuation snapshots');
END;
CREATE TRIGGER IF NOT EXISTS trg_shipment_currency_insert
BEFORE INSERT ON shipments
WHEN NEW.currency IS NULL
  OR NOT EXISTS (SELECT 1 FROM currencies WHERE iso_code = NEW.currency AND is_active = 1)
BEGIN
  SELECT RAISE(ABORT, 'shipment requires an active transaction currency');
END;
CREATE TRIGGER IF NOT EXISTS trg_payment_currency_insert
BEFORE INSERT ON payment_records
WHEN NEW.currency IS NULL
  OR NOT EXISTS (SELECT 1 FROM currencies WHERE iso_code = NEW.currency AND is_active = 1)
  OR NEW.accounting_currency IS NULL
  OR NOT EXISTS (SELECT 1 FROM currencies WHERE iso_code = NEW.accounting_currency AND is_active = 1)
  OR NEW.accounting_amount IS NULL
  OR NEW.exchange_rate IS NULL OR CAST(NEW.exchange_rate AS REAL) <= 0
  OR NEW.exchange_rate_date IS NULL
  OR NEW.rate_source NOT IN ('manual','api','cache','default')
BEGIN
  SELECT RAISE(ABORT, 'payment requires active transaction and accounting currencies');
END;
CREATE TRIGGER IF NOT EXISTS trg_accessory_currency_insert
BEFORE INSERT ON accessories
WHEN NEW.price_currency IS NULL
  OR NOT EXISTS (SELECT 1 FROM currencies WHERE iso_code = NEW.price_currency AND is_active = 1)
  OR NEW.price_valuation IS NULL OR json_valid(NEW.price_valuation) = 0
BEGIN
  SELECT RAISE(ABORT, 'accessory price requires an active currency');
END;
CREATE TRIGGER IF NOT EXISTS trg_ammunition_currency_insert
BEFORE INSERT ON ammunition
WHEN NEW.price_currency IS NULL
  OR NOT EXISTS (SELECT 1 FROM currencies WHERE iso_code = NEW.price_currency AND is_active = 1)
  OR NEW.price_valuation IS NULL OR json_valid(NEW.price_valuation) = 0
BEGIN
  SELECT RAISE(ABORT, 'ammunition price requires an active currency');
END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_transaction_currency_insert
BEFORE INSERT ON inventory_transactions
WHEN NEW.unit_amount IS NOT NULL AND (
  NEW.currency IS NULL
  OR NOT EXISTS (SELECT 1 FROM currencies WHERE iso_code = NEW.currency AND is_active = 1)
  OR NEW.valuation IS NULL OR json_valid(NEW.valuation) = 0
)
BEGIN
  SELECT RAISE(ABORT, 'priced inventory transaction requires an active currency');
END;
`;


// ============ SEED DATA (unchanged, already using new FK references) ============
export const SEED_MASTER_DATA_SQL = `
INSERT OR IGNORE INTO weapon_types (id, label, sort_order) VALUES
  ('wt-1', 'Shotgun', 1),
  ('wt-2', 'Air rifle', 2),
  ('wt-3', 'Blank pistol', 3),
  ('wt-4', 'Pistol', 4),
  ('wt-5', 'Rifle', 5);

INSERT OR IGNORE INTO weapon_subtypes (id, weapon_type_id, label, sort_order) VALUES
  ('ws-1', 'wt-1', 'Semi-auto', 1),
  ('ws-2', 'wt-1', 'Magazine shotgun', 2),
  ('ws-3', 'wt-1', 'Folding shotgun', 3),
  ('ws-4', 'wt-1', 'Over&under', 4),
  ('ws-5', 'wt-1', 'Side by side', 5),
  ('ws-6', 'wt-1', 'Single barrel', 6),
  ('ws-7', 'wt-2', 'PCP', 1),
  ('ws-8', 'wt-2', 'Break barrel', 2),
  ('ws-9', 'wt-3', '9mm', 1),
  ('ws-10', 'wt-4', '9x19mm', 1),
  ('ws-11', 'wt-4', '7.62mm', 2),
  ('ws-12', 'wt-4', '7.65mm', 3),
  ('ws-13', 'wt-4', '380mm', 4),
  ('ws-14', 'wt-4', '.22 LR', 5),
  ('ws-15', 'wt-5', '223', 1),
  ('ws-16', 'wt-5', '30-06', 2);

INSERT OR IGNORE INTO calibers (id, label) VALUES
  ('cal-1', '12 GA'),
  ('cal-2', '20 GA'),
  ('cal-3', '.177'),
  ('cal-4', '.22'),
  ('cal-5', '.25'),
  ('cal-6', '9mm blank'),
  ('cal-7', '9x19mm'),
  ('cal-8', '7.62mm'),
  ('cal-9', '7.65mm'),
  ('cal-10', '.380 ACP'),
  ('cal-11', '.22 LR'),
  ('cal-12', '.223 Rem'),
  ('cal-13', '30-06'),
  ('cal-14', '9 mm rubber'),
  ('cal-15', 'Cal 12 shotgun cartridges'),
  ('cal-16', '9x19'),
  ('cal-17', '7.62'),
  ('cal-18', '7.65'),
  ('cal-19', '223');

INSERT OR IGNORE INTO subtype_calibers (subtype_id, caliber_id) VALUES
  ('ws-1', 'cal-1'), ('ws-1', 'cal-2'),
  ('ws-2', 'cal-1'),
  ('ws-3', 'cal-1'),
  ('ws-4', 'cal-1'), ('ws-4', 'cal-2'),
  ('ws-5', 'cal-1'),
  ('ws-6', 'cal-1'), ('ws-6', 'cal-2'),
  ('ws-7', 'cal-3'), ('ws-7', 'cal-4'), ('ws-7', 'cal-5'),
  ('ws-8', 'cal-3'), ('ws-8', 'cal-4'),
  ('ws-9', 'cal-6'),
  ('ws-10', 'cal-7'),
  ('ws-11', 'cal-8'),
  ('ws-12', 'cal-9'),
  ('ws-13', 'cal-10'),
  ('ws-14', 'cal-11'),
  ('ws-15', 'cal-12'),
  ('ws-16', 'cal-13');

INSERT OR IGNORE INTO brands (id, label) VALUES
  ('br-1', 'Glock'),
  ('br-2', 'SIG Sauer'),
  ('br-3', 'Remington'),
  ('br-4', 'Benelli'),
  ('br-5', 'Colt'),
  ('br-6', 'Ruger'),
  ('br-7', 'Benjamin'),
  ('br-8', 'Ekol'),
  ('br-9', 'Hatsan');

INSERT OR IGNORE INTO warehouses (id, label) VALUES
  ('wh-1', 'Main'),
  ('wh-2', 'Secondary'),
  ('wh-3', 'Archive');

INSERT OR IGNORE INTO currencies (iso_code, name, symbol, decimal_precision, is_active, last_known_rate, last_rate_updated_at) VALUES
  ('USD', 'US Dollar', '$', 2, 1, 1.0, datetime('now')),
  ('SDG', 'Sudanese Pound', 'SDG', 2, 1, 600.0, datetime('now')),
  ('SAR', 'Saudi Riyal', 'SAR', 2, 1, 3.75, datetime('now')),
  ('AED', 'UAE Dirham', 'AED', 2, 0, 3.67, datetime('now')),
  ('EUR', 'Euro', 'EUR', 2, 0, 0.92, datetime('now')),
  ('EGP', 'Egyptian Pound', 'E£', 2, 1, 48.5, datetime('now'));

INSERT OR IGNORE INTO exchange_rate_overrides (currency_code, mode) VALUES
  ('USD', 'automatic'),
  ('SDG', 'automatic'),
  ('SAR', 'automatic'),
  ('AED', 'automatic'),
  ('EUR', 'automatic'),
  ('EGP', 'automatic');

INSERT OR IGNORE INTO system_settings (id) VALUES (1);

INSERT OR IGNORE INTO models (id, label, brand_id) VALUES
  ('mdl-1', '870', 'br-3'),
  ('mdl-2', 'Supersport', 'br-4'),
  ('mdl-3', 'G17', 'br-1'),
  ('mdl-4', 'P320', 'br-2'),
  ('mdl-5', 'AR-15', 'br-5'),
  ('mdl-6', 'Hawkeye', 'br-6'),
  ('mdl-7', 'Trail', 'br-7'),
  ('mdl-8', 'Volga', 'br-8'),
  ('mdl-9', 'Escort', 'br-9');

INSERT OR IGNORE INTO storage_locations (id, warehouse_id, shelf, bin) VALUES
  ('loc-1', 'wh-1', 'A', 'A-1'),
  ('loc-2', 'wh-1', 'A', 'A-2'),
  ('loc-3', 'wh-1', 'B', 'B-1'),
  ('loc-4', 'wh-2', 'A', 'A-1'),
  ('loc-5', 'wh-3', 'A', 'A-1');

-- The first administrator is created explicitly during local setup. Production
-- startup never inserts a demo account or a known password.
`;

export const SEED_DEMO_DATA_SQL = `
-- Demo data is still bootstrapped in TypeScript using generateMockData().
-- The function must be updated to use the new FK columns instead of text fields.
`;
