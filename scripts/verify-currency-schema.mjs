import Database from "better-sqlite3"
import {
  CREATE_TABLES_SQL,
  SCHEMA_VERSION,
  SEED_MASTER_DATA_SQL,
} from "../dist-electron/src/lib/db/schema.js"

const database = new Database(":memory:")
database.pragma("foreign_keys = ON")
database.exec(CREATE_TABLES_SQL)
database.exec(SEED_MASTER_DATA_SQL)

const requiredFinancialColumns = {
  invoices: [
    "currency", "accounting_currency", "exchange_rate", "exchange_rate_date",
    "rate_source", "total_original_accounting", "total_negotiated_accounting",
    "total_paid_accounting", "balance_accounting", "tax_amount_accounting",
  ],
  payment_records: [
    "currency", "accounting_amount", "accounting_currency", "exchange_rate",
    "exchange_rate_date", "rate_source", "rate_id",
  ],
  weapons: [
    "purchase_price_valuation", "retail_price_valuation",
    "wholesale_price_valuation", "actual_final_price_valuation",
    "sale_price_valuation",
  ],
  accessories: ["price_currency", "price_valuation"],
  ammunition: ["price_currency", "price_valuation"],
}

for (const [table, expected] of Object.entries(requiredFinancialColumns)) {
  const actual = new Set(database.pragma(`table_info(${table})`).map((row) => row.name))
  const missing = expected.filter((column) => !actual.has(column))
  if (missing.length > 0) throw new Error(`${table} is missing: ${missing.join(", ")}`)
}

const requiredTables = ["financial_data_issues", "inventory_transactions"]
for (const table of requiredTables) {
  const exists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table)
  if (!exists) throw new Error(`Missing table: ${table}`)
}

const foreignKeyErrors = database.pragma("foreign_key_check")
if (foreignKeyErrors.length > 0) {
  throw new Error(`Foreign-key verification failed: ${JSON.stringify(foreignKeyErrors)}`)
}

let rejectedInvalidRate = false
try {
  database.prepare("UPDATE currencies SET last_known_rate = '0' WHERE iso_code = 'SDG'").run()
} catch {
  rejectedInvalidRate = true
}
if (!rejectedInvalidRate) throw new Error("Zero exchange rate was not rejected")

const historicalValuation = JSON.stringify({
  originalAmount: 600000,
  originalCurrency: "SDG",
  accountingAmount: 1000,
  accountingCurrency: "USD",
  exchangeRate: 600,
  exchangeRateDate: "2026-08-09T00:00:00.000Z",
  rateSource: "manual",
})
database.prepare(`
  INSERT INTO invoices (
    id, invoice_number, customer_name, date, due_date,
    total_original, total_negotiated, total_paid, balance,
    currency, accounting_currency, exchange_rate, exchange_rate_date, rate_source,
    total_original_accounting, total_negotiated_accounting,
    total_paid_accounting, balance_accounting, tax_amount_accounting, total_valuation
  ) VALUES (
    'VERIFY-INV', 'VERIFY-INV', 'Verifier', '2026-08-09', '2026-09-09',
    600000, 600000, 0, 600000,
    'SDG', 'USD', '600', '2026-08-09T00:00:00.000Z', 'manual',
    '1000', '1000', '0', '1000', '0', ?
  )
`).run(historicalValuation)
database.prepare("UPDATE currencies SET last_known_rate = '700' WHERE iso_code = 'SDG'").run()
const historicalInvoice = database.prepare(`
  SELECT exchange_rate, total_negotiated_accounting, total_valuation
  FROM invoices WHERE id = 'VERIFY-INV'
`).get()
if (
  historicalInvoice.exchange_rate !== "600"
  || Number(historicalInvoice.total_negotiated_accounting) !== 1000
  || JSON.parse(historicalInvoice.total_valuation).exchangeRate !== 600
) {
  throw new Error("Historical invoice changed after the current rate was updated")
}

const auditCountBefore = database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count
const failingOperation = database.transaction(() => {
  database.prepare(`
    INSERT INTO audit_logs (id, timestamp, date, action_type)
    VALUES ('VERIFY-ROLLBACK', '2026-08-09T00:00:00.000Z', '2026-08-09', 'Update')
  `).run()
  throw new Error("intentional rollback")
})
try {
  failingOperation()
} catch (error) {
  if (!(error instanceof Error) || error.message !== "intentional rollback") throw error
}
const auditCountAfter = database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count
if (auditCountAfter !== auditCountBefore) throw new Error("Failed compound operation left partial state")

console.log(JSON.stringify({
  schemaVersion: SCHEMA_VERSION,
  financialTablesVerified: Object.keys(requiredFinancialColumns).length,
  foreignKeyErrors: foreignKeyErrors.length,
  rejectedInvalidRate,
  historicalSnapshotImmutable: true,
  atomicRollbackVerified: true,
}))
database.close()
