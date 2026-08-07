export const SCHEMA_VERSION = 2;

export const CREATE_TABLES_SQL = `
-- ============ PRAGMA & WAL ============
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;         
PRAGMA synchronous = NORMAL;

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
  reason        TEXT
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
  total_cost_valuation    TEXT
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
  total_valuation     TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS payment_records (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  date           TEXT NOT NULL,
  amount         REAL NOT NULL,
  method         TEXT NOT NULL DEFAULT 'Cash'
    CHECK (method IN ('Cash','Card','Bank Transfer','Check','Other')),
  employee       TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payment_records(invoice_id);

CREATE TABLE IF NOT EXISTS accessories (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT '',
  quantity         INTEGER NOT NULL DEFAULT 0,
  safety_threshold INTEGER NOT NULL DEFAULT 10,
  price            REAL NOT NULL DEFAULT 0,
  date_added       TEXT NOT NULL,
  warehouse        TEXT NOT NULL DEFAULT '', 
  shelf            TEXT NOT NULL DEFAULT '',
  bin              TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ammunition (
  id               TEXT PRIMARY KEY,
  caliber          TEXT NOT NULL,
  package_type     TEXT NOT NULL DEFAULT 'Box'
    CHECK (package_type IN ('Carton','Box','Case','Custom')),
  units_per_package INTEGER NOT NULL DEFAULT 1,
  full_packages    INTEGER NOT NULL DEFAULT 0,
  loose_rounds     INTEGER NOT NULL DEFAULT 0,
  safety_threshold INTEGER NOT NULL DEFAULT 100,
  price            REAL NOT NULL DEFAULT 0,
  date_added       TEXT NOT NULL,
  warehouse        TEXT NOT NULL DEFAULT '',  
  shelf            TEXT NOT NULL DEFAULT '',
  bin              TEXT NOT NULL DEFAULT ''
);

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
  role          TEXT NOT NULL DEFAULT 'Read-Only'
    CHECK (role IN ('Admin','Manager','Sales','Inventory','Accountant','Read-Only')),
  permissions   TEXT NOT NULL DEFAULT '{}',
  password_set  INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS system_settings (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  currency_symbol         TEXT NOT NULL DEFAULT '$',
  currency_code           TEXT NOT NULL DEFAULT 'USD',
  supported_currencies    TEXT NOT NULL DEFAULT '["USD","SAR","EUR"]',
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
  filter_state TEXT NOT NULL DEFAULT '{}'
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
  ('AED', 'UAE Dirham', 'AED', 2, 1, 3.67, datetime('now')),
  ('EUR', 'Euro', 'EUR', 2, 1, 0.92, datetime('now')),
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

INSERT OR IGNORE INTO users (id, username, name, role, permissions, password_set, password_hash) VALUES
  ('U001', 'admin', 'Admin User', 'Admin',
   '{"canImportExcel":true,"canExportData":true,"canViewReports":true,"canManageUsers":true,"canRegisterPayments":true,"canVoidInvoices":true,"canExtendDueDates":true,"canDeleteRecords":true}',
   1, 'admin123');
`;

export const SEED_DEMO_DATA_SQL = `
-- Demo data is still bootstrapped in TypeScript using generateMockData().
-- The function must be updated to use the new FK columns instead of text fields.
`;