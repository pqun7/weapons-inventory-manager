/*
# Multi-Currency Architecture — Core Tables

1. New Tables
- `currencies`: Master registry of all supported currencies (ISO code as PK, name, symbol, decimal precision, active flag, last known rate, last rate updated timestamp)
- `exchange_rate_history`: Immutable historical record of every exchange rate fetched/synced/overridden (currency code, rate against USD, source type, fetched_at)
- `exchange_rate_overrides`: Admin-defined manual rate overrides per currency (currency code, manual_rate, mode: automatic/manual, updated_by, updated_at, reason)
- `exchange_rate_audit_log`: Audit trail of every manual rate change (currency code, old_rate, new_rate, changed_by, changed_at, reason)

2. Security
- Enable RLS on all tables
- Single-tenant app (no sign-in) — allow anon + authenticated CRUD on all tables
- All data is intentionally shared/public

3. Seed Data
- Seeds 6 default currencies: USD, SDG, SAR, AED, EUR, EGP with approximate baseline rates
- Seeds default override rows (all set to 'automatic' mode)
*/

-- ── Currencies master table ──
CREATE TABLE IF NOT EXISTS currencies (
  iso_code VARCHAR(3) PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimal_precision SMALLINT NOT NULL DEFAULT 2,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_known_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  last_rate_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_currencies" ON currencies;
CREATE POLICY "anon_select_currencies" ON currencies FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_currencies" ON currencies;
CREATE POLICY "anon_insert_currencies" ON currencies FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_currencies" ON currencies;
CREATE POLICY "anon_update_currencies" ON currencies FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_currencies" ON currencies;
CREATE POLICY "anon_delete_currencies" ON currencies FOR DELETE
  TO anon, authenticated USING (true);

-- ── Exchange rate history (immutable) ──
CREATE TABLE IF NOT EXISTS exchange_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code VARCHAR(3) NOT NULL REFERENCES currencies(iso_code),
  rate NUMERIC(18,8) NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erh_currency_code ON exchange_rate_history(currency_code);
CREATE INDEX IF NOT EXISTS idx_erh_fetched_at ON exchange_rate_history(fetched_at DESC);

ALTER TABLE exchange_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_erh" ON exchange_rate_history;
CREATE POLICY "anon_select_erh" ON exchange_rate_history FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_erh" ON exchange_rate_history;
CREATE POLICY "anon_insert_erh" ON exchange_rate_history FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_erh" ON exchange_rate_history;
CREATE POLICY "anon_delete_erh" ON exchange_rate_history FOR DELETE
  TO anon, authenticated USING (true);

-- ── Exchange rate overrides (manual/admin settings) ──
CREATE TABLE IF NOT EXISTS exchange_rate_overrides (
  currency_code VARCHAR(3) PRIMARY KEY REFERENCES currencies(iso_code),
  mode TEXT NOT NULL DEFAULT 'automatic' CHECK (mode IN ('automatic', 'manual')),
  manual_rate NUMERIC(18,8),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);

ALTER TABLE exchange_rate_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ero" ON exchange_rate_overrides;
CREATE POLICY "anon_select_ero" ON exchange_rate_overrides FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_ero" ON exchange_rate_overrides;
CREATE POLICY "anon_insert_ero" ON exchange_rate_overrides FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_ero" ON exchange_rate_overrides;
CREATE POLICY "anon_update_ero" ON exchange_rate_overrides FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_ero" ON exchange_rate_overrides;
CREATE POLICY "anon_delete_ero" ON exchange_rate_overrides FOR DELETE
  TO anon, authenticated USING (true);

-- ── Exchange rate audit log ──
CREATE TABLE IF NOT EXISTS exchange_rate_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code VARCHAR(3) NOT NULL REFERENCES currencies(iso_code),
  old_rate NUMERIC(18,8),
  new_rate NUMERIC(18,8),
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_aud_currency ON exchange_rate_audit_log(currency_code);
CREATE INDEX IF NOT EXISTS idx_aud_changed_at ON exchange_rate_audit_log(changed_at DESC);

ALTER TABLE exchange_rate_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_aud" ON exchange_rate_audit_log;
CREATE POLICY "anon_select_aud" ON exchange_rate_audit_log FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_aud" ON exchange_rate_audit_log;
CREATE POLICY "anon_insert_aud" ON exchange_rate_audit_log FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_aud" ON exchange_rate_audit_log;
CREATE POLICY "anon_delete_aud" ON exchange_rate_audit_log FOR DELETE
  TO anon, authenticated USING (true);

-- ── Seed default currencies ──
INSERT INTO currencies (iso_code, name, symbol, decimal_precision, is_active, last_known_rate, last_rate_updated_at) VALUES
  ('USD', 'US Dollar', '$', 2, true, 1.0, now()),
  ('SDG', 'Sudanese Pound', 'SDG', 2, true, 600.0, now()),
  ('SAR', 'Saudi Riyal', 'ر.س', 2, true, 3.75, now()),
  ('AED', 'UAE Dirham', 'د.إ', 2, true, 3.67, now()),
  ('EUR', 'Euro', '€', 2, true, 0.92, now()),
  ('EGP', 'Egyptian Pound', 'E£', 2, true, 48.5, now())
ON CONFLICT (iso_code) DO NOTHING;

-- ── Seed default overrides (all automatic) ──
INSERT INTO exchange_rate_overrides (currency_code, mode) VALUES
  ('USD', 'automatic'),
  ('SDG', 'automatic'),
  ('SAR', 'automatic'),
  ('AED', 'automatic'),
  ('EUR', 'automatic'),
  ('EGP', 'automatic')
ON CONFLICT (currency_code) DO NOTHING;
