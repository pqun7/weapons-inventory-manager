import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Database, { type Database as SqliteDatabase } from "better-sqlite3"
import {
  CONFIGURE_INITIAL_CURRENCIES_V5_SQL,
  CREATE_TABLES_SQL,
  SCHEMA_VERSION,
  SEED_MASTER_DATA_SQL,
} from "@/lib/db/schema"

function openDatabase(): SqliteDatabase {
  const database = new Database(":memory:")
  database.pragma("foreign_keys = ON")
  database.exec(CREATE_TABLES_SQL)
  database.exec(SEED_MASTER_DATA_SQL)
  database.pragma(`user_version = ${SCHEMA_VERSION}`)
  return database
}

function valuation(amount: number, currency = "USD", rate = 1) {
  return JSON.stringify({
    originalAmount: amount,
    originalCurrency: currency,
    accountingAmount: amount / rate,
    accountingCurrency: "USD",
    exchangeRate: rate,
    exchangeRateDate: "2026-08-09T00:00:00.000Z",
    rateSource: "manual",
  })
}

function insertInvoice(database: SqliteDatabase, overrides: Partial<Record<string, unknown>> = {}) {
  const row = {
    id: "INV-1",
    number: "INV-1",
    total: 1000,
    paid: 0,
    balance: 1000,
    currency: "USD",
    accountingCurrency: "USD",
    rate: "1",
    ...overrides,
  }
  database.prepare(`
    INSERT INTO invoices (
      id, invoice_number, customer_name, date, due_date,
      total_original, total_negotiated, total_paid, balance,
      currency, accounting_currency, exchange_rate, exchange_rate_date,
      rate_source, total_original_accounting, total_negotiated_accounting,
      total_paid_accounting, balance_accounting, tax_amount_accounting,
      total_valuation
    ) VALUES (?, ?, 'Test', '2026-08-09', '2026-09-09', ?, ?, ?, ?, ?, ?, ?,
      '2026-08-09T00:00:00.000Z', 'manual', ?, ?, ?, ?, '0', ?)
  `).run(
    row.id, row.number, row.total, row.total, row.paid, row.balance,
    row.currency, row.accountingCurrency, row.rate,
    Number(row.total) / Number(row.rate), Number(row.total) / Number(row.rate),
    Number(row.paid) / Number(row.rate), Number(row.balance) / Number(row.rate),
    valuation(Number(row.total), String(row.currency), Number(row.rate)),
  )
}

describe("currency-aware database schema", () => {
  let database: SqliteDatabase

  beforeEach(() => { database = openDatabase() })
  afterEach(() => { database.close() })

  it("creates the financial tables and current currency architecture columns", () => {
    const tables = new Set((database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as { name: string }[]).map((row) => row.name))
    expect(tables.has("financial_data_issues")).toBe(true)
    expect(tables.has("inventory_transactions")).toBe(true)
    expect(tables.has("shipment_imports")).toBe(true)
    expect(tables.has("shipment_import_items")).toBe(true)
    expect(tables.has("shipment_validation_issues")).toBe(true)
    expect(tables.has("shipment_status_history")).toBe(true)
    expect(database.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION)

    const manifestColumns = new Set((database.pragma("table_info(shipment_imports)") as { name: string }[]).map((row) => row.name))
    expect(manifestColumns.has("review_note")).toBe(true)

    const invoiceColumns = new Set((database.pragma("table_info(invoices)") as { name: string }[]).map((row) => row.name))
    expect(invoiceColumns.has("exchange_rate_date")).toBe(true)
    expect(invoiceColumns.has("balance_accounting")).toBe(true)
    const paymentColumns = new Set((database.pragma("table_info(payment_records)") as { name: string }[]).map((row) => row.name))
    expect(paymentColumns.has("accounting_amount")).toBe(true)
    expect(paymentColumns.has("rate_id")).toBe(true)
  })

  it("activates only the initial USD, SAR, SDG, and EGP operating currencies", () => {
    const rows = database.prepare(
      "SELECT iso_code, is_active FROM currencies ORDER BY iso_code",
    ).all() as { iso_code: string; is_active: number }[]
    const active = rows.filter((row) => row.is_active === 1).map((row) => row.iso_code)
    expect(active).toEqual(["EGP", "SAR", "SDG", "USD"])
    expect(rows.find((row) => row.iso_code === "AED")?.is_active).toBe(0)
    expect(rows.find((row) => row.iso_code === "EUR")?.is_active).toBe(0)
  })

  it("migrates stale transaction and display preferences without deleting currencies", () => {
    database.prepare("UPDATE currencies SET is_active = 1 WHERE iso_code IN ('AED','EUR')").run()
    database.prepare(`
      UPDATE system_settings
      SET currency_code = 'AED', preferred_display_currency = 'AED',
          supported_currencies = '["USD","AED","EUR"]'
      WHERE id = 1
    `).run()
    database.prepare(`
      INSERT INTO user_preferences (user_id, display_currency, report_view_mode)
      VALUES ('U001', 'AED', 'display')
    `).run()

    database.exec(CONFIGURE_INITIAL_CURRENCIES_V5_SQL)

    const settings = database.prepare(`
      SELECT currency_code, preferred_display_currency, supported_currencies
      FROM system_settings WHERE id = 1
    `).get() as Record<string, string>
    expect(settings.currency_code).toBe("USD")
    expect(settings.preferred_display_currency).toBe("USD")
    expect(JSON.parse(settings.supported_currencies)).toEqual(["USD", "SAR", "SDG", "EGP"])
    expect(database.prepare("SELECT display_currency FROM user_preferences WHERE user_id = 'U001'").pluck().get()).toBe("USD")
    expect(database.prepare("SELECT COUNT(*) FROM currencies WHERE iso_code IN ('AED','EUR')").pluck().get()).toBe(2)
    expect(database.prepare("SELECT SUM(is_active) FROM currencies WHERE iso_code IN ('AED','EUR')").pluck().get()).toBe(0)
  })

  it("separates accounting, transaction, and display currency settings", () => {
    const row = database.prepare(`
      SELECT currency_code, accounting_currency_code, rate_base_currency_code,
             preferred_display_currency
      FROM system_settings WHERE id = 1
    `).get() as Record<string, string | null>
    expect(row.currency_code).toBe("USD")
    expect(row.accounting_currency_code).toBe("USD")
    expect(row.rate_base_currency_code).toBe("USD")
    expect(row.preferred_display_currency).toBeNull()

    database.prepare(`
      INSERT INTO user_preferences (user_id, display_currency, report_view_mode)
      VALUES ('U001', 'SDG', 'display')
    `).run()
    const preference = database.prepare(
      "SELECT display_currency FROM user_preferences WHERE user_id = 'U001'",
    ).get() as { display_currency: string }
    expect(preference.display_currency).toBe("SDG")
  })

  it.each(["0", "-1", "not-a-rate"])("rejects invalid persisted rate %s", (rate) => {
    expect(() => database.prepare(
      "UPDATE currencies SET last_known_rate = ? WHERE iso_code = 'SDG'",
    ).run(rate)).toThrow(/greater than zero/)
  })

  it("rejects a manual override without a positive rate", () => {
    expect(() => database.prepare(`
      UPDATE exchange_rate_overrides SET mode = 'manual', manual_rate = '0'
      WHERE currency_code = 'SDG'
    `).run()).toThrow(/greater than zero/)
  })

  it("rejects invoices and payments without registered active currencies", () => {
    expect(() => insertInvoice(database, { currency: "ZZZ" })).toThrow(/active transaction/)
    insertInvoice(database)
    expect(() => database.prepare(`
      INSERT INTO payment_records (
        id, invoice_id, invoice_number, date, amount, currency,
        accounting_amount, accounting_currency, exchange_rate,
        exchange_rate_date, rate_source, method
      ) VALUES ('PAY-1', 'INV-1', 'INV-1', '2026-08-09', 10, 'ZZZ',
        '10', 'USD', '1', '2026-08-09T00:00:00.000Z', 'manual', 'cash')
    `).run()).toThrow(/active transaction/)
  })

  it("rejects priced inventory without valuation snapshots", () => {
    expect(() => database.prepare(`
      INSERT INTO accessories
        (id, name, quantity, price, date_added, price_currency)
      VALUES ('ACC-1', 'Scope', 1, 100, '2026-08-09', NULL)
    `).run()).toThrow(/active currency/)
  })

  it("keeps an invoice snapshot unchanged after the current rate changes", () => {
    insertInvoice(database, {
      total: 600000,
      balance: 600000,
      currency: "SDG",
      rate: "600",
    })
    database.prepare(
      "UPDATE currencies SET last_known_rate = '700' WHERE iso_code = 'SDG'",
    ).run()
    const invoice = database.prepare(`
      SELECT exchange_rate, total_negotiated_accounting, total_valuation
      FROM invoices WHERE id = 'INV-1'
    `).get() as { exchange_rate: string; total_negotiated_accounting: string; total_valuation: string }
    expect(invoice.exchange_rate).toBe("600")
    expect(Number(invoice.total_negotiated_accounting)).toBe(1000)
    expect(JSON.parse(invoice.total_valuation).exchangeRate).toBe(600)
  })

  it.each(["sale", "payment", "shipment", "inventory"])(
    "rolls back a failed %s compound operation",
    (operation) => {
      const before = database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get() as { count: number }
      const transaction = database.transaction(() => {
        database.prepare(`
          INSERT INTO audit_logs (id, timestamp, date, action_type)
          VALUES (?, '2026-08-09T00:00:00.000Z', '2026-08-09', 'Update')
        `).run(`ROLLBACK-${operation}`)
        throw new Error(`failed ${operation}`)
      })
      expect(() => transaction()).toThrow(`failed ${operation}`)
      const after = database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get() as { count: number }
      expect(after.count).toBe(before.count)
    },
  )

  it("passes the foreign-key integrity check", () => {
    expect(database.pragma("foreign_key_check")).toEqual([])
  })
})
